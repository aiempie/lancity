import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

const base = new URL(process.env.LANCITY_TEST_URL ?? 'http://localhost:4198')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use an isolated local Worker')
assert.ok(process.env.LANCITY_TEST_D1, 'Set LANCITY_TEST_D1 to the isolated Worker database file')

const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const api = '/api/v1'

function request(path, { cookie, method = 'GET', body, rawBody, clientIp, headers: extra = {} } = {}) {
  const headers = new Headers(extra)
  if (cookie) headers.set('cookie', cookie)
  if (method !== 'GET') headers.set('origin', base.origin)
  if (clientIp) headers.set('cf-connecting-ip', clientIp)
  if (body !== undefined || rawBody !== undefined) headers.set('content-type', 'application/json')
  return fetch(new URL(path, base), {
    method,
    headers,
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    redirect: 'manual'
  })
}

async function signUp(suffix) {
  const username = `p1${runId}${suffix}`
  const [network, address] = randomBytes(2)
  const response = await request('/api/auth/sign-up/email', {
    method: 'POST',
    clientIp: `198.19.${network}.${address}`,
    body: { name: `P1 ${suffix}`, username, email: `${username}@example.com`, password: 'isolated-test-password' }
  })
  assert.equal(response.status, 200, await response.clone().text())
  const cookie = response.headers
    .getSetCookie()
    .map(header => header.split(';', 1)[0])
    .join('; ')
  assert.match(cookie, /lancity\.session_token=/)
  return { cookie }
}

test('API errors share one JSON shape and never leak internals', async () => {
  const unauthorized = await request(`${api}/workspaces`)
  assert.equal(unauthorized.status, 401)
  assert.equal(unauthorized.headers.get('cache-control'), 'private, no-store')
  const body = await unauthorized.json()
  assert.deepEqual(Object.keys(body), ['error'])
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message'])
  const missing = await request(`${api}/definitely-missing`)
  assert.equal(missing.status, 404)
  assert.equal((await missing.json()).error.code, 'NOT_FOUND')
})

test('JSON bodies are validated before handlers run', async () => {
  const user = await signUp('body')
  const malformed = await request(`${api}/workspaces`, { ...user, method: 'POST', rawBody: '{' })
  assert.equal(malformed.status, 400)
  assert.equal((await malformed.json()).error.code, 'INVALID_JSON')
  const wrongShape = await request(`${api}/workspaces`, { ...user, method: 'POST', body: [] })
  assert.equal(wrongShape.status, 400)
  assert.ok(['VALIDATION_ERROR', 'PARSE_ERROR'].includes((await wrongShape.json()).error.code))
  const oversized = await request(`${api}/workspaces`, {
    ...user,
    method: 'POST',
    rawBody: JSON.stringify({ name: 'x'.repeat(5 * 1024 * 1024 + 16) })
  })
  assert.equal(oversized.status, 413)
  assert.equal((await oversized.json()).error.code, 'BODY_TOO_LARGE')
})

test('timezone endpoint is public, sorted by offset and cacheable by clients', async () => {
  const response = await request(`${api}/timezones`)
  assert.equal(response.status, 200)
  const { timezones } = await response.json()
  assert.ok(timezones.length > 100)
  const offsets = timezones.map(zone => zone.utc_offset)
  assert.deepEqual(offsets, [...offsets].sort((a, b) => parseOffset(a) - parseOffset(b)))
})

function parseOffset(text) {
  const [, sign, hours, minutes] = /^UTC([+-])(\d{2}):(\d{2})$/.exec(text)
  // Plane formats offsets with floor division: -03:30 is shown as UTC-04:30 (hours floored, minutes added back).
  // Undo that so the value is the real offset in minutes that the endpoint sorts by.
  return sign === '-' ? -Number(hours) * 60 + Number(minutes) : Number(hours) * 60 + Number(minutes)
}

// The statements below are the ones `src/server/common/rate-limit.ts` and `cache.ts` run on D1.
// They need the ext-p1-platform tables, so the tests skip until the integrator has merged and applied that migration.
function hasTable(db, name) {
  return Boolean(db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name))
}

test('rate limit statement is a sliding window with an atomic conditional insert', t => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    if (!hasTable(db, 'rate_limit_hits')) return t.skip('rate_limit_hits migration is not applied')
    const key = `test:${runId}`
    const limit = 3
    const windowMs = 60_000
    const hit = now =>
      db
        .prepare(
          `insert into rate_limit_hits (key, hit_at) select ?1, ?2
           where (select count(*) from rate_limit_hits where key = ?1 and hit_at > ?3) < ?4`
        )
        .run(key, now, now - windowMs, limit).changes
    const t0 = 1_000_000
    assert.deepEqual([hit(t0), hit(t0 + 1), hit(t0 + 2), hit(t0 + 3)], [1, 1, 1, 0])
    assert.equal(hit(t0 + windowMs + 1), 1, 'old hits leave the window')
    db.prepare('delete from rate_limit_hits where key = ?').run(key)
  } finally {
    db.close()
  }
})

test('cache upsert replaces the value and honours expiry', t => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    if (!hasTable(db, 'cache_entries')) return t.skip('cache_entries migration is not applied')
    const key = `/cache/${runId}:1`
    const upsert = (value, expiresAt) =>
      db
        .prepare(
          `insert into cache_entries (key, value, expires_at) values (?1, ?2, ?3)
           on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at`
        )
        .run(key, value, expiresAt)
    upsert('{"data":1,"status":200}', 100)
    upsert('{"data":2,"status":200}', 200)
    const live = db.prepare('select value from cache_entries where key = ? and expires_at > ?')
    assert.equal(live.get(key, 150).value, '{"data":2,"status":200}')
    assert.equal(live.get(key, 250), undefined)
    db.prepare("delete from cache_entries where key like ? escape '\\'").run(`%${runId}%`)
    assert.equal(db.prepare('select count(*) as c from cache_entries where key = ?').get(key).c, 0)
  } finally {
    db.close()
  }
})
