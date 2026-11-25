import assert from 'node:assert/strict'
import test from 'node:test'
import { authResponseCookies } from '../src/lib/auth/response-cookies'
import { getSafeRedirectUrl, validateNextPath } from '../src/server/common/path-validator'
import { isPasswordStrong, passwordScore } from '../src/server/identity/password'
import { parseRate } from '../src/server/identity/throttle'

test('validateNextPath rejects open-redirect payloads', () => {
  for (const bad of ['//evil.com', 'https://evil.com/x', '/\\evil.com', '/a/../b', 'javascript:alert(1)', '/%2f%2fevil.com', '/%252e%252e/x'])
    assert.notEqual(validateNextPath(bad), bad, bad)
  assert.equal(validateNextPath('/acme/projects'), '/acme/projects')
  assert.equal(validateNextPath('//evil.com'), '')
})

test('getSafeRedirectUrl stays on the configured host', () => {
  const env = { WEB_URL: 'https://app.example.com' }
  assert.equal(getSafeRedirectUrl(env, 'https://app.example.com', '/acme'), 'https://app.example.com/?next_path=%2Facme')
  assert.equal(getSafeRedirectUrl(env, 'https://app.example.com', '//evil.com'), 'https://app.example.com')
})

test('isPasswordStrong uses zxcvbn with threshold 3', () => {
  // zxcvbn-ts scores 'Football2023!!!!' as 3, which meets Plane's threshold, so it is accepted like in Plane.
  assert.equal(passwordScore('Football2023!!!!'), 3)
  assert.equal(isPasswordStrong('Jennifer19801980'), false)
  assert.equal(isPasswordStrong('password'), false)
  assert.equal(isPasswordStrong('k7#Qv9!zLp2$xR8w'), true)
})

test('parseRate defaults to 10/minute like Plane', () => {
  assert.deepEqual(parseRate(undefined), { limit: 10, windowSeconds: 60 })
})

test('auth response cookies preserve session attributes and deletion', () => {
  const [session, deleted] = authResponseCookies([
    'lancity.session_token=abc%2Bdef; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600',
    'lancity.session_data=; Path=/; HttpOnly; Max-Age=0'
  ])
  assert.equal(session.value, 'abc+def')
  assert.equal(session.path, '/')
  assert.equal(session.httpOnly, true)
  assert.equal(session.secure, true)
  assert.equal(session.sameSite, 'lax')
  assert.equal(session.maxAge, 3600)
  assert.equal(deleted.value, '')
  assert.equal(deleted.maxAge, 0)
})
