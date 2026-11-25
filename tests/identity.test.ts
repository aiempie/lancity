import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionUserIdSchema } from '../src/types/auth/schema'
import { onboardSchema, updateCurrentUserSchema, updateProfileSchema } from '../src/types/identity/schema'

test('session IDs accept only positive safe serial IDs', () => {
  assert.equal(sessionUserIdSchema.parse('42'), 42)
  assert.equal(sessionUserIdSchema.parse(42), 42)
  for (const value of ['0', '-1', '1e2', '01', '9007199254740992', 0, -1, 1.1]) {
    assert.equal(sessionUserIdSchema.safeParse(value).success, false)
  }
})

test('identity writes reject system fields, invalid preferences and URLs in names', () => {
  assert.equal(updateCurrentUserSchema.safeParse({ first_name: 'Jane', last_name: 'Doe' }).success, true)
  assert.equal(updateCurrentUserSchema.safeParse({ first_name: 'example.com' }).success, false)
  assert.equal(updateCurrentUserSchema.safeParse({ email: 'other@example.com' }).success, false)
  assert.equal(updateProfileSchema.safeParse({ user_id: 10 }).success, false)
  assert.equal(updateProfileSchema.safeParse({ start_of_the_week: 7 }).success, false)
  assert.deepEqual(onboardSchema.parse({}), { is_onboarded: false })
})
