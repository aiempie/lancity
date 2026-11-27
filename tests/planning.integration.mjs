import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'vitest'

const base = new URL(process.env.LANCITY_TEST_URL ?? 'http://localhost:4198')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use an isolated local Worker')
assert.ok(process.env.LANCITY_TEST_D1, 'Set LANCITY_TEST_D1 to the isolated Worker database file')
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
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
async function responseJson(response, status) {
  assert.equal(response.status, status, `${response.url}: ${await response.clone().text()}`)
  return response.json()
}
async function signUp(suffix) {
  const username = `test${runId}${suffix}`
  const response = await request('/api/auth/sign-up/email', {
    method: 'POST',
    ip: suffix === 'owner' ? '198.18.201.1' : '198.18.201.2',
    body: { name: `Test ${suffix}`, username, email: `${username}@example.com`, password: 'isolated-test-password' }
  })
  const { user } = await responseJson(response, 200)
  return {
    id: Number(user.id),
    cookie: response.headers
      .getSetCookie()
      .map(value => value.split(';', 1)[0])
      .join('; ')
  }
}

test('planning resources enforce scope, roles and atomic assignment batches', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('owner')
    const outsider = await signUp('outsider')
    const slug = `plan-${runId}`
    const workspace = await responseJson(
      await request('/api/v1/workspaces', { ...owner, method: 'POST', body: { name: 'Planning', slug } }),
      201
    )
    const project = await responseJson(
      await request(`/api/v1/workspaces/${slug}/projects`, {
        ...owner,
        method: 'POST',
        body: { name: 'Planning', identifier: 'PLAN' }
      }),
      201
    )
    db.prepare('UPDATE projects SET cycle_view = 1, module_view = 1 WHERE id = ?').run(project.id)
    const path = `/api/v1/workspaces/${slug}/projects/${project.id}`
    const post = (url, body, user = owner) => request(`${path}${url}`, { ...user, method: 'POST', body })
    assert.equal((await request(`${path}/cycles`)).status, 401)
    assert.equal((await request(`${path}/cycles`, outsider)).status, 404)
    assert.equal((await post('/cycles', { name: 'Invalid', start_date: '2026-01-01' })).status, 400)
    const first = await responseJson(await post('/cycles', { name: 'First' }), 201)
    const second = await responseJson(await post('/cycles', { name: 'Second' }), 201)
    const projectModule = await responseJson(await post('/modules', { name: 'Module' }), 201)
    assert.equal((await post('/modules', { name: 'Module' })).status, 409)
    const issue = await responseJson(await post('/issues', { name: 'Planning issue' }), 201)
    assert.equal((await post(`/cycles/${first.id}/cycle-issues`, { issues: [issue.id] })).status, 204)
    assert.equal((await post(`/cycles/${second.id}/cycle-issues`, { issues: [issue.id] })).status, 204)
    assert.equal(
      db.prepare('SELECT cycle_id FROM cycle_issues WHERE issue_id = ? AND deleted_at IS NULL').get(issue.id).cycle_id,
      second.id
    )
    assert.equal((await post(`/modules/${projectModule.id}/module-issues`, { issues: [issue.id] })).status, 204)
    assert.equal(
      (await responseJson(await request(`${path}/modules/${projectModule.id}/module-issues`, owner), 200)).length,
      1
    )
    assert.equal((await post(`/cycles/${first.id}/cycle-issues`, { issues: [issue.id, 999999999] })).status, 404)
    assert.equal(
      db.prepare('SELECT cycle_id FROM cycle_issues WHERE issue_id = ? AND deleted_at IS NULL').get(issue.id).cycle_id,
      second.id
    )
    db.exec(
      `CREATE TRIGGER planning_fail_cycle BEFORE INSERT ON cycle_issues WHEN NEW.cycle_id = ${first.id} BEGIN SELECT RAISE(ABORT, 'forced'); END`
    )
    try {
      assert.equal((await post(`/cycles/${first.id}/cycle-issues`, { issues: [issue.id] })).status, 400)
    } finally {
      db.exec('DROP TRIGGER planning_fail_cycle')
    }
    assert.equal(
      db.prepare('SELECT cycle_id FROM cycle_issues WHERE issue_id = ? AND deleted_at IS NULL').get(issue.id).cycle_id,
      second.id
    )
    const estimate = await responseJson(
      await post('/estimates', {
        estimate: { name: 'Points', type: 'points' },
        estimate_points: [{ key: 1, value: '1' }]
      }),
      201
    )
    assert.equal((await responseJson(await request(`${path}/estimates/${estimate.id}`, owner), 200)).points.length, 1)
    const intake = await responseJson(await post('/intakes', { name: 'Inbox' }), 201)
    db.prepare('UPDATE intakes SET is_default = 1 WHERE id = ?').run(intake.id)
    assert.equal((await request(`${path}/intakes/${intake.id}`, { ...owner, method: 'DELETE' })).status, 400)
    const draft = await responseJson(await post('/drafts', { name: 'Private draft' }), 201)
    db.prepare('INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (?, ?, 15)').run(
      workspace.id,
      outsider.id
    )
    db.prepare('INSERT INTO project_members (workspace_id, project_id, member_id, role) VALUES (?, ?, ?, 15)').run(
      workspace.id,
      project.id,
      outsider.id
    )
    assert.equal((await request(`${path}/drafts/${draft.id}`, outsider)).status, 404)
    db.prepare('UPDATE project_members SET role = 5 WHERE project_id = ? AND member_id = ?').run(
      project.id,
      outsider.id
    )
    assert.equal((await post('/cycles', { name: 'Denied' }, outsider)).status, 403)
  } finally {
    db.close()
  }
})
