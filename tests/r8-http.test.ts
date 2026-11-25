import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { getDb } from '../src/db/client'
import { Hono } from 'hono'
import { handleApiError } from '../src/server/api/v1/errors'
import { createApiCors, createProtectCookieWrites } from '../src/server/api/v1/request-security'
import { createAuthenticate } from '../src/server/api-token/authentication'
import { apiKeyRateLimit } from '../src/server/common/rate-limit'
import { hashApiToken } from '../src/server/integration/model-rules'
import { ServiceError } from '../src/server/common/errors'
import type { ApiEnv } from '../src/types/api/schema'

/** Minimal D1 binding over node:sqlite so drizzle's d1 driver runs the real queries. */
function createD1(sqlite: DatabaseSync) {
  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...values: unknown[]) => statement(sql, values),
    all: async () => ({ results: sqlite.prepare(sql).all(...(params as never[])), success: true, meta: {} }),
    raw: async () => {
      const prepared = sqlite.prepare(sql) as ReturnType<DatabaseSync['prepare']> & {
        setReturnArrays(enabled: boolean): void
      }
      prepared.setReturnArrays(true)
      return prepared.all(...(params as never[]))
    },
    run: async () => {
      const info = sqlite.prepare(sql).run(...(params as never[]))
      return { success: true, results: [], meta: { changes: Number(info.changes) } }
    },
    first: async () => sqlite.prepare(sql).get(...(params as never[]))
  })
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: { run: () => Promise<unknown> }[]) => Promise.all(list.map(s => s.run()))
  }
}

function setup() {
  const sqlite = new DatabaseSync(':memory:')
  for (const file of readdirSync('drizzle')
    .filter(name => name.endsWith('.sql'))
    .sort()) {
    for (const part of readFileSync(`drizzle/${file}`, 'utf8').split('--> statement-breakpoint')) {
      if (part.trim()) sqlite.exec(part)
    }
  }
  const db = getDb(createD1(sqlite) as unknown as D1Database)
  return { sqlite, db }
}

const NOW = Date.now()
async function seed(sqlite: DatabaseSync) {
  const time = new Date(NOW).toISOString()
  sqlite.exec('pragma foreign_keys = off')
  for (const [id, email] of [
    [1, 'a@x.test'],
    [2, 'b@x.test']
  ] as const) {
    sqlite
      .prepare('insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)')
      .run(id, email, email, NOW, NOW)
  }
  const insertWs = sqlite.prepare(
    "insert into workspaces (id, name, slug, owner_id, created_at, updated_at, organization_size) values (?, ?, ?, 1, ?, ?, '10')"
  )
  insertWs.run(1, 'One', 'one', NOW, NOW)
  insertWs.run(2, 'Two', 'two', NOW, NOW)
  const insertToken = sqlite.prepare(
    'insert into api_tokens (token, label, user_id, workspace_id, expired_at, is_active, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  insertToken.run(await hashApiToken('good-key'), 'good', 1, 1, null, 1, NOW, NOW)
  insertToken.run(await hashApiToken('legacy-key'), 'legacy', 1, null, null, 1, NOW, NOW)
  insertToken.run(await hashApiToken('expired-key'), 'old', 1, 1, NOW - 1000, 1, NOW, NOW)
  insertToken.run(await hashApiToken('ws-key'), 'ws', 2, 1, null, 1, NOW, NOW)
  void time
}

function buildApp() {
  const { sqlite, db } = setup()
  const app = new Hono<ApiEnv>().basePath('/api/v1')
  app.onError((error, c) => {
    if (process.env.R8_DEBUG) console.error(error)
    return handleApiError(error, c)
  })
  const authenticate = createAuthenticate({
    getDatabase: () => db,
    sessionActor: async headers => {
      if (headers.get('cookie') === 'session=ok') return { userId: 2 }
      throw new ServiceError(401, 'UNAUTHORIZED', 'Authentication required')
    }
  })
  app.get('/users/me', authenticate, c =>
    c.json({ userId: c.get('actor').userId, viaKey: c.get('apiKeyAuthenticated') ?? false })
  )
  app.get('/workspaces/:slug/projects', authenticate, c => c.json({ slug: c.req.param('slug'), userId: c.get('actor').userId, viaKey: c.get('apiKeyAuthenticated') ?? false }))
  app.get('/users/api-tokens', authenticate, c => c.json({ ok: true }))
  app.get('/instances/configurations', authenticate, c => c.json({ ok: true }))
  app.post('/auth/change-password', authenticate, c => c.json({ ok: true }))
  return { app, sqlite, db }
}

const keyHeaders = (key: string) => ({ 'X-API-Key': key })

test('valid X-API-Key authenticates as the token owner', async () => {
  const { app, sqlite } = buildApp()
  await seed(sqlite)
  const response = await app.request('/api/v1/workspaces/one/projects', { headers: keyHeaders('good-key') })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { slug: 'one', userId: 1, viaKey: true })
  const [row] = sqlite.prepare("select last_used from api_tokens where label = 'good'").all() as {
    last_used: number | null
  }[]
  assert.ok(row.last_used)
})

test('session cookie still works and has no key flag', async () => {
  const { app, sqlite } = buildApp()
  await seed(sqlite)
  const response = await app.request('/api/v1/users/me', { headers: { cookie: 'session=ok' } })
  assert.deepEqual(await response.json(), { userId: 2, viaKey: false })
})

test('unknown, expired and inactive keys are 401, and a bad key is not rescued by a cookie', async () => {
  const { app, sqlite } = buildApp()
  await seed(sqlite)
  assert.equal((await app.request('/api/v1/users/me', { headers: keyHeaders('nope') })).status, 401)
  assert.equal((await app.request('/api/v1/users/me', { headers: keyHeaders('expired-key') })).status, 401)
  assert.equal(
    (await app.request('/api/v1/users/me', { headers: { ...keyHeaders('nope'), cookie: 'session=ok' } })).status,
    401
  )
  sqlite.exec("update api_tokens set is_active = 0 where label = 'good'")
  assert.equal((await app.request('/api/v1/users/me', { headers: keyHeaders('good-key') })).status, 401)
  assert.equal((await app.request('/api/v1/users/me')).status, 401)
})

test('deactivated owner cannot use the key', async () => {
  const { app, sqlite } = buildApp()
  await seed(sqlite)
  sqlite.prepare('insert into user_security (user_id, is_active) values (1, 0)').run()
  assert.equal((await app.request('/api/v1/users/me', { headers: keyHeaders('good-key') })).status, 401)
})

test('API keys are refused on token management, instance admin and password routes', async () => {
  const { app, sqlite } = buildApp()
  await seed(sqlite)
  for (const [method, path] of [
    ['GET', '/users/api-tokens'],
    ['GET', '/instances/configurations'],
    ['POST', '/auth/change-password']
  ]) {
    const response = await app.request(`/api/v1${path}`, { method, headers: keyHeaders('good-key') })
    assert.equal(response.status, 403, path)
  }
})

test('workspace bound token only reaches its own workspace', async () => {
  const { app, sqlite } = buildApp()
  await seed(sqlite)
  assert.equal((await app.request('/api/v1/workspaces/one/projects', { headers: keyHeaders('ws-key') })).status, 200)
  assert.equal((await app.request('/api/v1/workspaces/two/projects', { headers: keyHeaders('ws-key') })).status, 403)
  assert.equal((await app.request('/api/v1/users/me', { headers: keyHeaders('ws-key') })).status, 403)
  assert.equal((await app.request('/api/v1/workspaces/two/projects', { headers: keyHeaders('good-key') })).status, 403)
  assert.equal((await app.request('/api/v1/workspaces/one/projects', { headers: keyHeaders('legacy-key') })).status, 401)
})

test('apiKeyRateLimit: per key, 429 after the limit, requests without key are skipped', async () => {
  const { sqlite, db } = setup()
  await seed(sqlite)
  const app = new Hono<ApiEnv>()
  app.use(
    '*',
    apiKeyRateLimit('2/minute', () => db)
  )
  app.get('/', c => c.text('ok'))
  const call = (key?: string) => app.request('/', { headers: key ? keyHeaders(key) : {} })
  assert.equal((await call('k1')).status, 200)
  assert.equal((await call('k1')).status, 200)
  const blocked = await call('k1')
  assert.equal(blocked.status, 429)
  assert.ok(blocked.headers.get('retry-after'))
  assert.equal((await call('k2')).status, 200)
  for (let i = 0; i < 5; i++) assert.equal((await call()).status, 200)
})

test('CORS preflight allows configured origin with credentials and X-API-Key', async () => {
  const app = new Hono()
  app.use(
    '*',
    createApiCors(() => ({ CORS_ALLOWED_ORIGINS: 'https://app.example.com, https://m.example.com' }))
  )
  app.get('/x', c => c.text('ok'))
  const preflight = await app.request('/x', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://app.example.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'x-api-key,content-type'
    }
  })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://app.example.com')
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true')
  assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /x-api-key/i)
  const evil = await app.request('/x', {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.test', 'Access-Control-Request-Method': 'GET' }
  })
  assert.notEqual(evil.headers.get('access-control-allow-origin'), 'https://evil.test')
  assert.notEqual(evil.headers.get('access-control-allow-origin'), '*')
})

test('CORS never combines * with credentials when nothing is configured', async () => {
  const app = new Hono()
  app.use(
    '*',
    createApiCors(() => ({}))
  )
  app.get('/x', c => c.text('ok'))
  const response = await app.request('/x', { headers: { Origin: 'https://any.test' } })
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.equal(response.headers.get('access-control-allow-credentials'), null)
})

test('cookie writes: cross-origin denied unless the origin is configured', async () => {
  const app = new Hono()
  app.onError((error, c) => handleApiError(error, c))
  app.use(
    '*',
    createProtectCookieWrites(() => ['https://app.example.com'])
  )
  app.post('/x', c => c.text('ok'))
  const post = (origin: string) =>
    app.request('http://api.local/x', { method: 'POST', headers: { cookie: 'a=b', origin } })
  assert.equal((await post('https://app.example.com')).status, 200)
  assert.equal((await post('http://api.local')).status, 200)
  assert.equal((await post('https://evil.test')).status, 403)
})
