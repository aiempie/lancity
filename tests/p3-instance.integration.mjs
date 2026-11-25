import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

// Needs an isolated Worker with INSTANCE_ENCRYPTION_KEY set in .dev.vars and a database without instances.
const base = new URL(process.env.LANCITY_TEST_URL ?? 'http://localhost:4198')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use an isolated local Worker')
assert.ok(process.env.LANCITY_TEST_D1, 'Set LANCITY_TEST_D1 to the isolated Worker database file')

const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const api = '/api/v1/instances'
let fixtureCount = 0 // Makes usernames unique per fixture; every test signs up its own admin and other user.

function request(path, { cookie, method = 'GET', body, clientIp } = {}) {
  const headers = new Headers()
  if (cookie) headers.set('cookie', cookie)
  if (method !== 'GET') headers.set('origin', base.origin)
  if (clientIp) headers.set('cf-connecting-ip', clientIp)
  if (body !== undefined) headers.set('content-type', 'application/json')
  return fetch(new URL(path, base), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' })
}

async function signUp(suffix) {
  const username = `p3${runId}${suffix}${fixtureCount}`
  const [network, address] = randomBytes(2)
  const response = await request('/api/auth/sign-up/email', {
    method: 'POST',
    clientIp: `198.20.${network}.${address}`,
    body: { name: `P3 ${suffix}`, username, email: `${username}@example.com`, password: 'isolated-test-password' }
  })
  assert.equal(response.status, 200, await response.clone().text())
  const { user } = await response.json()
  const cookie = response
    .headers.getSetCookie()
    .map(header => header.split(';', 1)[0])
    .join('; ')
  return { id: Number(user.id), cookie, email: `${username}@example.com` }
}

function withFixture(run) {
  return async () => {
    const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM instances').get().n, 0, 'Needs a database without instances')
    fixtureCount += 1
    const admin = await signUp('admin')
    const other = await signUp('other')
    db.prepare(`INSERT INTO instances (instance_name, instance_id, last_checked_at, current_version, is_setup_done)
      VALUES ('P3 Fixture', ?, 0, 'v0.0.0', 1)`).run(`p3-${runId}`)
    const instanceId = db.prepare('SELECT id FROM instances').get().id
    db.prepare('INSERT INTO instance_admins (instance_id, user_id, role, is_verified) VALUES (?, ?, 20, 1)').run(instanceId, admin.id)
    try {
      await run({ db, admin, other })
    } finally {
      db.exec(`DELETE FROM instance_admins; DELETE FROM instances;
        DELETE FROM instance_configurations WHERE key IN ('GOOGLE_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'IS_GOOGLE_ENABLED', 'ENABLE_SMTP', 'EMAIL_HOST');
        DELETE FROM workspaces WHERE slug LIKE 'p3${runId}%'`)
      db.close()
    }
  }
}

test('instance info is public and instance admin endpoints reject other users', withFixture(async ({ admin, other }) => {
  const info = await (await request(`${api}/info`)).json()
  assert.equal(info.instance.is_setup_done, true)
  assert.equal(typeof info.config.enable_signup, 'boolean')
  assert.equal(info.instance.whitelist_emails, undefined)
  for (const [method, path] of [
    ['GET', `${api}/configurations`],
    ['GET', `${api}/workspaces`],
    ['GET', `${api}/admins/me`],
    ['GET', `${api}/workspace-slug-check?slug=x`],
    ['POST', `${api}/email-credentials-check`]
  ]) {
    assert.equal((await request(path, { ...other, method, body: method === 'POST' ? { receiver_email: 'a@example.com' } : undefined })).status, 403, path)
  }
  const me = await (await request(`${api}/admins/me`, admin)).json()
  assert.equal(me.id, admin.id)
  const session = await (await request(`${api}/admins/session`, admin)).json()
  assert.equal(session.is_authenticated, true)
  assert.equal((await (await request(`${api}/admins/session`, other)).json()).is_authenticated, false)
}))

test('secret configuration values are stored encrypted and never returned', withFixture(async ({ db, admin }) => {
  const patch = await request(`${api}/configurations`, {
    ...admin,
    method: 'PATCH',
    body: { GOOGLE_CLIENT_ID: ' id-1 ', GOOGLE_CLIENT_SECRET: 'super-secret', IS_GOOGLE_ENABLED: '1', UNKNOWN_KEY_X: 'ignored' }
  })
  assert.equal(patch.status, 200, await patch.clone().text())
  const updated = await patch.json()
  assert.deepEqual(updated.map(row => row.key).sort(), ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'IS_GOOGLE_ENABLED'])
  assert.equal(updated.find(row => row.key === 'GOOGLE_CLIENT_SECRET').value, null)
  const stored = Object.fromEntries(db.prepare("SELECT key, value, is_encrypted FROM instance_configurations WHERE key LIKE 'GOOGLE_CLIENT%'").all().map(row => [row.key, row]))
  assert.equal(stored.GOOGLE_CLIENT_ID.value, 'id-1')
  assert.equal(stored.GOOGLE_CLIENT_SECRET.is_encrypted, 1)
  assert.match(stored.GOOGLE_CLIENT_SECRET.value, /^v1:[\w-]+\.[\w-]+$/)
  assert.ok(!stored.GOOGLE_CLIENT_SECRET.value.includes('super-secret'))
  const config = await (await request('/api/v1/auth/config')).json()
  assert.equal(config.is_google_enabled, true)
  const initiate = await request('/api/auth/sign-in/social', { method: 'POST', body: { provider: 'google', callbackURL: '/' } })
  assert.equal(initiate.status, 200, await initiate.clone().text())
  const authorization = new URL((await initiate.json()).url)
  assert.equal(authorization.searchParams.get('client_id'), 'id-1')
  db.prepare("UPDATE instance_configurations SET value = '' WHERE key = 'GOOGLE_CLIENT_SECRET'").run()
  assert.equal((await (await request('/api/v1/auth/config')).json()).is_google_enabled, false)
  db.prepare("UPDATE instance_configurations SET value = 'invalid-ciphertext' WHERE key = 'GOOGLE_CLIENT_SECRET'").run()
  assert.equal((await request('/api/v1/auth/config')).status, 500)
  db.prepare("UPDATE instance_configurations SET value = ? WHERE key = 'GOOGLE_CLIENT_SECRET'").run(stored.GOOGLE_CLIENT_SECRET.value)

  const listed = await (await request(`${api}/configurations`, admin)).json()
  assert.equal(listed.find(row => row.key === 'GOOGLE_CLIENT_SECRET').isSet, true)
  assert.ok(!JSON.stringify(listed).includes('super-secret'))

  db.exec("INSERT INTO instance_configurations (key, value, category) VALUES ('EMAIL_HOST', 'smtp.example.com', 'SMTP') ON CONFLICT(key) DO UPDATE SET value = 'smtp.example.com'")
  assert.equal((await request(`${api}/configurations/disable-email-feature`, { ...admin, method: 'DELETE' })).status, 200)
  assert.equal(db.prepare("SELECT value FROM instance_configurations WHERE key = 'EMAIL_HOST'").get().value, '')
}))

test('instance workspaces: slug check, create, search and pagination', withFixture(async ({ admin }) => {
  const slug = `p3${runId}a`
  assert.deepEqual(await (await request(`${api}/workspace-slug-check?slug=${slug}`, admin)).json(), { status: true })
  assert.deepEqual(await (await request(`${api}/workspace-slug-check?slug=api`, admin)).json(), { status: false })
  assert.equal((await request(`${api}/workspace-slug-check`, admin)).status, 400)
  const created = await request(`${api}/workspaces`, { ...admin, method: 'POST', body: { name: `P3 Space ${runId}`, slug } })
  assert.equal(created.status, 201, await created.clone().text())
  assert.deepEqual(await (await request(`${api}/workspace-slug-check?slug=${slug.toUpperCase()}`, admin)).json(), { status: false })
  const duplicate = await request(`${api}/workspaces`, { ...admin, method: 'POST', body: { name: 'Again', slug: slug.toUpperCase() } })
  assert.equal(duplicate.status, 400)
  const url = await request(`${api}/workspaces`, { ...admin, method: 'POST', body: { name: 'Visit http://spam.example', slug: `${slug}b` } })
  assert.equal(url.status, 400)
  const page = await (await request(`${api}/workspaces?search=${encodeURIComponent(`P3 Space ${runId}`)}`, admin)).json()
  assert.equal(page.total_count, 1)
  assert.equal(page.results[0].slug, slug)
  assert.equal(page.results[0].total_members, 1)
  assert.equal(page.results[0].total_projects, 0)
  assert.equal((await request(`${api}/workspaces?per_page=11`, admin)).status, 400)
}))

test('admin sign-up is closed after setup and sign-in only works for admins', withFixture(async ({ admin, other }) => {
  const clientIp = '198.18.241.80'
  const signUp = await request(`${api}/admins/sign-up`, {
    method: 'POST',
    clientIp,
    body: { email: `new${runId}@example.com`, password: 'Str0ng-Passw0rd-Here!', first_name: 'New' }
  })
  assert.equal(signUp.status, 409)
  assert.equal((await signUp.json()).error.details.error_code, 5150)
  const wrong = await request(`${api}/admins/sign-in`, { method: 'POST', clientIp, body: { email: admin.email, password: 'wrong-password' } })
  assert.equal((await wrong.json()).error.details.error_code, 5175)
  const nonAdmin = await request(`${api}/admins/sign-in`, { method: 'POST', clientIp, body: { email: other.email, password: 'isolated-test-password' } })
  assert.equal(nonAdmin.status, 401)
  assert.equal((await nonAdmin.json()).error.details.error_code, 5175)
  const missing = await request(`${api}/admins/sign-in`, { method: 'POST', clientIp, body: { email: `none${runId}@example.com`, password: 'x' } })
  assert.equal((await missing.json()).error.details.error_code, 5185)
  const ok = await request(`${api}/admins/sign-in`, { method: 'POST', clientIp, body: { email: admin.email, password: 'isolated-test-password' } })
  assert.equal(ok.status, 200, await ok.clone().text())
  assert.match(ok.headers.getSetCookie().join(';'), /session_token=/)
  assert.equal((await request(`${api}/admins/sign-up-screen-visited`, { method: 'POST' })).status, 204)
}))
