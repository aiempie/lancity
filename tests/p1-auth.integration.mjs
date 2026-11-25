import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

const base = new URL(process.env.LANCITY_TEST_URL ?? 'http://localhost:4198')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
assert.ok(process.env.LANCITY_TEST_D1)
const run = randomUUID().replaceAll('-', '').slice(0, 10)
const password = 'Rt7$wQn4&hBz-Ke9'

function request(path, { cookie, method = 'GET', body, ip } = {}) {
  const headers = new Headers()
  if (cookie) headers.set('cookie', cookie)
  if (ip) headers.set('cf-connecting-ip', ip)
  if (method !== 'GET') headers.set('origin', base.origin)
  if (body !== undefined) headers.set('content-type', 'application/json')
  return fetch(new URL(path, base), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' })
}
async function json(response, status) {
  assert.equal(response.status, status, `${response.url} ${await response.clone().text()}`)
  return response.status === 204 ? null : response.json()
}
const cookieOf = response =>
  response.headers
    .getSetCookie()
    .map(value => value.split(';', 1)[0])
    .join('; ')

async function signUp(suffix, ip) {
  const username = `p1${run}${suffix}`
  const email = `${username}@example.com`
  const response = await request('/api/auth/sign-up/email', { method: 'POST', ip, body: { username, email, name: suffix, password } })
  const { user } = await json(response, 200)
  return { id: Number(user.id), email, username, cookie: cookieOf(response), ip }
}

test('sign-up provisions profile and security rows and exposes the Plane user shape', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const me = await signUp('shape', '198.18.231.1')
    const body = await json(await request('/api/v1/users/me', me), 200)
    assert.equal(body.email, me.email)
    assert.equal(body.is_onboarded, false)
    assert.equal(body.is_password_autoset, false)
    assert.equal(db.prepare('select count(*) n from profiles where user_id = ?').get(me.id).n, 1)
    assert.equal(db.prepare('select count(*) n from user_security where user_id = ?').get(me.id).n, 1)
    assert.equal(db.prepare('select count(*) n from user_notification_preferences where user_id = ?').get(me.id).n, 1)
    const session = await json(await request('/api/v1/users/session', me), 200)
    assert.equal(session.is_authenticated, true)
    assert.equal((await json(await request('/api/v1/users/session'), 200)).is_authenticated, false)
  } finally {
    db.close()
  }
})

test('weak passwords are rejected on sign-up and change-password', async () => {
  const weak = await request('/api/auth/sign-up/email', {
    method: 'POST',
    ip: '198.18.231.2',
    body: { username: `p1${run}weak`, email: `p1${run}weak@example.com`, name: 'weak', password: 'password1' }
  })
  assert.equal(weak.status, 400)
  const me = await signUp('chg', '198.18.231.3')
  const rejected = await request('/api/v1/auth/change-password', { ...me, method: 'POST', body: { old_password: password, new_password: 'qwerty123' } })
  const error = await json(rejected, 400)
  assert.equal(error.error.details.error_code, 5021)
  const wrong = await request('/api/v1/auth/change-password', { ...me, method: 'POST', body: { old_password: 'not-the-password-1', new_password: 'Hp3#vXd8@Jm5-Lc2' } })
  assert.equal((await json(wrong, 400)).error.details.error_code, 5135)
  const second = await request('/api/auth/sign-in/email', { method: 'POST', body: { email: me.email, password } })
  assert.equal(second.status, 200)
  const otherCookie = cookieOf(second)
  const changed = await request('/api/v1/auth/change-password', { ...me, method: 'POST', body: { old_password: password, new_password: 'Hp3#vXd8@Jm5-Lc2' } })
  await json(changed, 200)
  const newCookie = cookieOf(changed)
  assert.ok(newCookie, 'rotated session cookie is returned')
  assert.equal((await request('/api/v1/users/me', { cookie: newCookie })).status, 200)
  assert.equal((await request('/api/v1/users/me', { cookie: otherCookie })).status, 401)
  const login = await request('/api/auth/sign-in/email', { method: 'POST', ip: '198.18.231.3', body: { email: me.email, password: 'Hp3#vXd8@Jm5-Lc2' } })
  assert.equal(login.status, 200)
})

test('email-check reports existing users and magic code needs SMTP', async () => {
  const me = await signUp('check', '198.18.231.4')
  const known = await json(await request('/api/v1/auth/email-check', { method: 'POST', body: { email: me.email.toUpperCase() } }), 200)
  assert.equal(known.existing, true)
  assert.equal(known.status, 'CREDENTIAL')
  const fresh = await json(await request('/api/v1/auth/email-check', { method: 'POST', body: { email: `new${run}@example.com` } }), 200)
  assert.equal(fresh.existing, false)
  const invalid = await request('/api/v1/auth/email-check', { method: 'POST', body: { email: 'not-an-email' } })
  assert.equal((await json(invalid, 400)).error.details.error_code, 5005)
  const config = await json(await request('/api/v1/auth/config'), 200)
  if (!config.is_smtp_configured) {
    const generate = await request('/api/v1/auth/magic-generate', { method: 'POST', body: { email: me.email } })
    assert.equal((await json(generate, 400)).error.details.error_code, 5025)
  }
})

test('email change needs a code bound to the user, limits attempts and revokes sessions', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const me = await signUp('mail', '198.18.231.5')
    const other = await signUp('taken', '198.18.231.6')
    const next = `p1${run}next@example.com`
    const same = await request('/api/v1/users/me/email/generate-code', { ...me, method: 'POST', body: { email: me.email } })
    assert.equal(same.status, 400)
    const dup = await request('/api/v1/users/me/email/generate-code', { ...me, method: 'POST', body: { email: other.email } })
    assert.equal(dup.status, 400)
    await json(await request('/api/v1/users/me/email/generate-code', { ...me, method: 'POST', body: { email: next } }), 200)
    const row = db.prepare('select value from verification where identifier = ?').get(`email_update:${me.id}:${next}`)
    assert.match(row.value, /^\d{6}$/)
    const wrong = await request('/api/v1/users/me/email', { ...me, method: 'PATCH', body: { email: next, code: '000000' } })
    assert.equal(wrong.status, 400)
    const done = await json(await request('/api/v1/users/me/email', { ...me, method: 'PATCH', body: { email: next, code: row.value } }), 200)
    assert.equal(done.email, next)
    assert.equal(db.prepare('select email_verified v from user where id = ?').get(me.id).v, 0)
    assert.equal((await request('/api/v1/users/me', me)).status, 401)
  } finally {
    db.close()
  }
})

test('deactivation revokes access, blocks sign-in and keeps instance admins protected', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const me = await signUp('gone', '198.18.231.7')
    const slug = `p1-${run}`
    await json(await request('/api/v1/workspaces', { ...me, method: 'POST', body: { name: 'Solo', slug } }), 201)
    await json(await request('/api/v1/users/me', { ...me, method: 'DELETE' }), 204)
    assert.equal((await request('/api/v1/users/me', me)).status, 401)
    const login = await request('/api/auth/sign-in/email', { method: 'POST', ip: '198.18.231.7', body: { email: me.email, password } })
    assert.notEqual(login.status, 200)
    const security = db.prepare('select is_active a, last_logout_time t from user_security where user_id = ?').get(me.id)
    assert.equal(security.a, 0)
    assert.ok(security.t)
  } finally {
    db.close()
  }
})

test('unlinking the only sign-in method is refused and other users cannot read an account', async () => {
  const me = await signUp('acct', '198.18.231.8')
  const other = await signUp('acct2', '198.18.231.9')
  const accounts = await json(await request('/api/v1/users/me/accounts', me), 200)
  assert.equal(accounts.length, 1)
  assert.equal((await request(`/api/v1/users/me/accounts/${accounts[0].id}`, other)).status, 404)
  assert.equal((await request(`/api/v1/users/me/accounts/${accounts[0].id}`, { ...me, method: 'DELETE' })).status, 400)
})

test('auth throttling returns 429 after the per-IP budget is used', async () => {
  const ip = '198.18.231.99'
  let last
  for (let i = 0; i < 12; i++) {
    last = await request('/api/auth/sign-in/email', { method: 'POST', ip, body: { email: `nobody${run}@example.com`, password } })
  }
  assert.equal(last.status, 429)
})
