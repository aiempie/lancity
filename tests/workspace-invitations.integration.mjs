import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

const base = new URL(process.env.LANCITY_TEST_URL ?? 'http://localhost:4198')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
assert.ok(process.env.LANCITY_TEST_D1)
const run = randomUUID().replaceAll('-', '').slice(0, 12)
function request(path, { cookie, method = 'GET', body, ip } = {}) {
  const headers = new Headers()
  if (cookie) headers.set('cookie', cookie)
  if (ip) headers.set('cf-connecting-ip', ip)
  if (method !== 'GET') headers.set('origin', base.origin)
  if (body !== undefined) headers.set('content-type', 'application/json')
  return fetch(new URL(path, base), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  })
}
async function json(response, status) {
  assert.equal(response.status, status, `${response.url} ${await response.clone().text()}`)
  return response.json()
}
async function signUp(suffix, ip) {
  const username = `test${run}${suffix}`
  const email = `${username}@example.com`
  const response = await request('/api/auth/sign-up/email', {
    method: 'POST',
    ip,
    body: { username, email, name: suffix, password: 'isolated-test-password' }
  })
  const { user } = await json(response, 200)
  return {
    id: Number(user.id),
    email,
    cookie: response.headers
      .getSetCookie()
      .map(value => value.split(';', 1)[0])
      .join('; ')
  }
}

test('verified invitation recipients can accept atomically and managers remain scoped', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('owner', '198.18.221.1')
    const invitee = await signUp('invitee', '198.18.221.2')
    const outsider = await signUp('outsider', '198.18.221.3')
    const slug = `invite-${run}`
    const workspace = await json(
      await request('/api/v1/workspaces', { ...owner, method: 'POST', body: { name: 'Invitations', slug } }),
      201
    )
    const management = `/api/v1/workspaces/${slug}/invitations`
    const invite = await json(
      await request(management, { ...owner, method: 'POST', body: { email: invitee.email.toUpperCase(), role: 15 } }),
      201
    )
    assert.equal(invite.email, invitee.email)
    assert.equal('token' in invite, false)
    assert.equal((await json(await request(management, owner), 200)).length, 1)
    assert.equal((await json(await request(`${management}/${invite.id}`, owner), 200)).id, invite.id)
    assert.equal((await request(management, { ...owner, method: 'POST', body: { email: invitee.email } })).status, 409)
    assert.equal(
      (await json(await request(`${management}/${invite.id}`, { ...owner, method: 'PATCH', body: { role: 5 } }), 200))
        .role,
      5
    )
    assert.equal(
      (await json(await request(`${management}/${invite.id}`, { ...owner, method: 'PATCH', body: { role: 15 } }), 200))
        .role,
      15
    )
    assert.equal((await request(management, outsider)).status, 404)
    assert.equal((await request('/api/v1/workspaces/invitations/pending', invitee)).status, 403)
    db.prepare('UPDATE user SET email_verified = 1 WHERE id IN (?, ?)').run(invitee.id, outsider.id)
    const pending = await json(await request('/api/v1/workspaces/invitations/pending', invitee), 200)
    assert.equal(pending.length, 1)
    assert.equal('token' in pending[0], false)
    const respond = `/api/v1/workspaces/invitations/${invite.id}/respond`
    assert.equal((await request(respond, { ...outsider, method: 'POST', body: { accepted: true } })).status, 404)
    db.exec(
      `CREATE TRIGGER invitation_test_failure BEFORE UPDATE OF responded_at ON workspace_member_invites WHEN NEW.id = ${invite.id} BEGIN SELECT RAISE(ABORT, 'forced'); END`
    )
    try {
      assert.equal((await request(respond, { ...invitee, method: 'POST', body: { accepted: true } })).status, 400)
    } finally {
      db.exec('DROP TRIGGER invitation_test_failure')
    }
    assert.equal(
      db
        .prepare('SELECT id FROM workspace_members WHERE workspace_id = ? AND member_id = ? AND deleted_at IS NULL')
        .get(workspace.id, invitee.id),
      undefined
    )
    assert.equal(
      db.prepare('SELECT responded_at FROM workspace_member_invites WHERE id = ?').get(invite.id).responded_at,
      null
    )
    assert.deepEqual(
      await json(await request(respond, { ...invitee, method: 'POST', body: { accepted: true } }), 200),
      { accepted: true }
    )
    assert.equal(
      db
        .prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND member_id = ? AND deleted_at IS NULL')
        .get(workspace.id, invitee.id).role,
      15
    )
    assert.equal((await request(respond, { ...invitee, method: 'POST', body: { accepted: true } })).status, 404)
    assert.equal((await json(await request('/api/v1/workspaces/invitations/pending', invitee), 200)).length, 0)
    assert.equal(
      (await request(`${management}/${invite.id}`, { ...owner, method: 'PATCH', body: { role: 5 } })).status,
      409
    )
    const removable = await json(
      await request(management, { ...owner, method: 'POST', body: { email: `unused-${run}@example.com` } }),
      201
    )
    assert.equal((await request(`${management}/${removable.id}`, { ...owner, method: 'DELETE' })).status, 204)
    assert.equal((await request(`${management}/${removable.id}`, owner)).status, 404)
    const declined = await json(
      await request(management, { ...owner, method: 'POST', body: { email: outsider.email } }),
      201
    )
    assert.deepEqual(
      await json(
        await request(`/api/v1/workspaces/invitations/${declined.id}/respond`, {
          ...outsider,
          method: 'POST',
          body: { accepted: false }
        }),
        200
      ),
      { accepted: false }
    )
    assert.equal(
      db
        .prepare('SELECT id FROM workspace_members WHERE workspace_id = ? AND member_id = ? AND deleted_at IS NULL')
        .get(workspace.id, outsider.id),
      undefined
    )
  } finally {
    db.close()
  }
})
