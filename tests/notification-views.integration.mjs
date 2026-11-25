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

test('notifications and project views preserve visibility and state', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('owner', '198.18.223.1')
    const other = await signUp('other', '198.18.223.2')
    const slug = `notify-${run}`
    const workspace = await json(
      await request('/api/v1/workspaces', { ...owner, method: 'POST', body: { name: 'Notifications', slug } }),
      201
    )
    const project = await json(
      await request(`/api/v1/workspaces/${slug}/projects`, {
        ...owner,
        method: 'POST',
        body: { name: 'Project', identifier: 'NOTIF' }
      }),
      201
    )
    const basePath = `/api/v1/workspaces/${slug}`
    const projectPath = `${basePath}/projects/${project.id}`
    const issue = await json(
      await request(`${projectPath}/issues`, { ...owner, method: 'POST', body: { name: 'Visible issue' } }),
      201
    )
    db.prepare('INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (?, ?, 15)').run(
      workspace.id,
      other.id
    )
    db.prepare('INSERT INTO project_members (workspace_id, project_id, member_id, role) VALUES (?, ?, ?, 15)').run(
      workspace.id,
      project.id,
      other.id
    )
    const insert = db.prepare(
      `INSERT INTO notifications (entity_name, entity_identifier, title, sender, receiver_id, workspace_id, project_id) VALUES ('issue', ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    const normal = insert.get(issue.id, 'Normal', 'assigned', owner.id, workspace.id, project.id)
    const mention = insert.get(issue.id, 'Mention', 'mentioned', owner.id, workspace.id, project.id)
    const theirs = insert.get(issue.id, 'Other', 'assigned', other.id, workspace.id, project.id)
    const path = `${basePath}/users/notifications`
    assert.deepEqual(
      (await json(await request(path, owner), 200)).map(item => item.id),
      [normal.id]
    )
    assert.deepEqual(
      (await json(await request(`${path}?mentioned=true`, owner), 200)).map(item => item.id),
      [mention.id]
    )
    assert.deepEqual(await json(await request(`${path}/unread`, owner), 200), {
      total_unread_notifications_count: 1,
      mention_unread_notifications_count: 1
    })
    assert.equal((await request(`${path}/${theirs.id}/read`, { ...owner, method: 'POST' })).status, 404)
    assert.equal(
      (
        await request(`${path}/${normal.id}`, {
          ...owner,
          method: 'PATCH',
          body: { snoozed_till: '2030-01-01T00:00:00Z' }
        })
      ).status,
      200
    )
    assert.deepEqual(
      (await json(await request(`${path}?snoozed=true`, owner), 200)).map(item => item.id),
      [normal.id]
    )
    assert.equal(
      (await request(`${path}/${normal.id}`, { ...owner, method: 'PATCH', body: { snoozed_till: null } })).status,
      200
    )
    assert.equal((await request(`${path}/${normal.id}/read`, { ...owner, method: 'POST' })).status, 200)
    assert.deepEqual(
      (await json(await request(`${path}?read=true`, owner), 200)).map(item => item.id),
      [normal.id]
    )
    assert.equal((await request(`${path}/${normal.id}/archive`, { ...owner, method: 'POST' })).status, 200)
    assert.deepEqual(
      (await json(await request(`${path}?archived=true`, owner), 200)).map(item => item.id),
      [normal.id]
    )
    assert.equal((await request(`${path}/${normal.id}/archive`, { ...owner, method: 'DELETE' })).status, 200)
    db.prepare('INSERT INTO issue_assignees (workspace_id, project_id, issue_id, assignee_id) VALUES (?, ?, ?, ?)').run(
      workspace.id,
      project.id,
      issue.id,
      owner.id
    )
    assert.deepEqual(
      (await json(await request(`${path}?type=assigned`, owner), 200)).map(item => item.id),
      [normal.id]
    )
    assert.equal((await request(`${path}/${normal.id}/read`, { ...owner, method: 'DELETE' })).status, 200)
    assert.equal(
      (await request(`${path}/mark-all-read`, { ...owner, method: 'POST', body: { type: 'assigned' } })).status,
      200
    )
    assert.notEqual(db.prepare('SELECT read_at FROM notifications WHERE id = ?').get(normal.id).read_at, null)
    assert.notEqual(db.prepare('SELECT read_at FROM notifications WHERE id = ?').get(mention.id).read_at, null)
    const settings = '/api/v1/users/me/notification-preferences'
    assert.equal((await json(await request(settings, owner), 200)).mention, true)
    assert.equal(
      (await json(await request(settings, { ...owner, method: 'PATCH', body: { mention: false } }), 200)).mention,
      false
    )
    assert.equal((await json(await request(settings, other), 200)).mention, true)
    const view = await json(
      await request(`${projectPath}/views`, {
        ...owner,
        method: 'POST',
        body: { name: 'Private', query: {}, access: 0 }
      }),
      201
    )
    assert.equal((await request(`${projectPath}/views/${view.id}`, other)).status, 404)
    const publicView = await json(
      await request(`${projectPath}/views`, {
        ...owner,
        method: 'POST',
        body: { name: 'Public', query: {}, access: 1 }
      }),
      201
    )
    assert.equal((await request(`${projectPath}/views/${publicView.id}`, other)).status, 200)
    db.prepare('UPDATE project_members SET role = 5 WHERE project_id = ? AND member_id = ?').run(project.id, other.id)
    assert.equal((await request(`${projectPath}/views/${publicView.id}`, other)).status, 404)
    db.prepare('UPDATE projects SET guest_view_all_features = 1 WHERE id = ?').run(project.id)
    assert.equal((await request(`${projectPath}/views/${publicView.id}`, other)).status, 200)
    assert.equal((await request(`${projectPath}/views/${view.id}/lock`, { ...owner, method: 'POST' })).status, 200)
    assert.equal(
      (await request(`${projectPath}/views/${view.id}`, { ...owner, method: 'PATCH', body: { name: 'Denied' } }))
        .status,
      400
    )
    assert.equal((await request(`${projectPath}/views/${view.id}/lock`, { ...owner, method: 'DELETE' })).status, 200)
    assert.equal(
      (await request(`${projectPath}/views/${view.id}`, { ...owner, method: 'PATCH', body: { name: 'Updated' } }))
        .status,
      200
    )
    assert.equal((await request(`${projectPath}/views/${view.id}/archive`, { ...owner, method: 'POST' })).status, 200)
    assert.equal((await request(`${projectPath}/views/${view.id}`, owner)).status, 404)
    assert.equal((await request(`${projectPath}/views/${view.id}/archive`, { ...owner, method: 'DELETE' })).status, 200)
    assert.equal((await request(`${projectPath}/views/${view.id}`, owner)).status, 200)
    db.prepare('UPDATE project_members SET is_active = 0 WHERE project_id = ? AND member_id = ?').run(
      project.id,
      other.id
    )
    assert.equal((await request(`${path}/${theirs.id}/read`, { ...other, method: 'POST' })).status, 404)
  } finally {
    db.close()
  }
})
