import assert from 'node:assert/strict'
import { test } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import { handleApiError } from '../src/server/api/v1/errors'
import { getTimezones } from '../src/server/api/v1/timezones'
import { readJson } from '../src/server/api/v1/validation'
import { ServiceError } from '../src/server/common/errors'

const app = new Hono()
app.onError(handleApiError)
app.post('/', async c => c.json(await readJson(c, z.object({ name: z.string().min(1) }))))
app.get('/expected', () => {
  throw new ServiceError(403, 'FORBIDDEN', 'Denied')
})
app.get('/unexpected', () => {
  throw new Error('secret')
})

test('validates JSON and produces consistent client errors', async () => {
  const valid = await app.request('/', { method: 'POST', body: JSON.stringify({ name: 'ok' }) })
  assert.deepEqual(await valid.json(), { name: 'ok' })
  const invalid = await app.request('/', { method: 'POST', body: '{' })
  assert.equal(invalid.status, 400)
  assert.equal(((await invalid.json()) as { error: { code: string } }).error.code, 'INVALID_JSON')
  const badInput = await app.request('/', { method: 'POST', body: '{"name":""}' })
  assert.equal(badInput.status, 400)
  assert.equal(((await badInput.json()) as { error: { code: string } }).error.code, 'VALIDATION_ERROR')
  const denied = await app.request('/expected')
  assert.equal(denied.status, 403)
  assert.deepEqual(await denied.json(), { error: { code: 'FORBIDDEN', message: 'Denied' } })
})

test('unexpected errors do not expose internal messages', async () => {
  const original = console.error
  console.error = () => {}
  try {
    const response = await app.request('/unexpected')
    assert.equal(response.status, 500)
    assert.doesNotMatch(await response.text(), /secret/)
  } finally {
    console.error = original
  }
})

test('rejects oversized JSON before validation', async () => {
  const response = await app.request('/', {
    method: 'POST',
    body: JSON.stringify({ name: 'x'.repeat(5 * 1024 * 1024) })
  })
  assert.equal(response.status, 413)
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'BODY_TOO_LARGE')
})

test('timezone offsets change with seasons and preserve source ordering', () => {
  const winter = getTimezones(new Date('2026-01-15T12:00:00Z')).timezones
  const summer = getTimezones(new Date('2026-07-15T12:00:00Z')).timezones
  assert.equal(winter.find(x => x.value === 'America/New_York')?.utc_offset, 'UTC-05:00')
  assert.equal(summer.find(x => x.value === 'America/New_York')?.utc_offset, 'UTC-04:00')
  assert.equal(winter.find(x => x.label === 'Kathmandu')?.utc_offset, 'UTC+05:45')
  assert.equal(winter.find(x => x.label === 'Newfoundland Time (Canada)')?.utc_offset, 'UTC-04:30')
  assert.equal(winter.length, 120)
})

test('robots policy disallows crawling for all user agents', async () => {
  const { default: robots } = await import('../src/app/robots')
  assert.deepEqual(robots(), { rules: { userAgent: '*', disallow: '/' } })
})

test('cookie writes reject cross-origin requests and responses are not cached', async () => {
  const { privateNoStore, protectCookieWrites } = await import('../src/server/api/v1/request-security')
  const secured = new Hono()
  secured.onError(handleApiError)
  secured.use('*', privateNoStore, protectCookieWrites)
  secured.post('/', c => c.json({ ok: true }))
  for (const origin of [undefined, 'https://example.com']) {
    const headers: Record<string, string> = { cookie: 'session=test' }
    if (origin) headers.origin = origin
    const response = await secured.request('https://example.com/', { method: 'POST', headers })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  }
  const denied = await secured.request('https://example.com/', {
    method: 'POST',
    headers: { cookie: 'session=test', origin: 'https://attacker.example' }
  })
  assert.equal(denied.status, 403)
  assert.equal(denied.headers.get('cache-control'), 'private, no-store')
  const anonymous = await secured.request('https://example.com/', {
    method: 'POST',
    headers: { origin: 'https://attacker.example' }
  })
  assert.equal(anonymous.status, 200)
})
