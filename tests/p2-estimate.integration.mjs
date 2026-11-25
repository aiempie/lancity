import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

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
    ip: suffix === 'owner' ? '198.18.212.1' : '198.18.212.2',
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


test('estimates: bulk create/update, point removal with reassignment, workspace listing', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('owner')
    const guest = await signUp('outsider')
    const slug = `est-${runId}`
    const workspace = await responseJson(
      await request('/api/v1/workspaces', { ...owner, method: 'POST', body: { name: 'Estimates', slug } }),
      201
    )
    const project = await responseJson(
      await request(`/api/v1/workspaces/${slug}/projects`, {
        ...owner,
        method: 'POST',
        body: { name: 'Estimates', identifier: 'EST' }
      }),
      201
    )
    const path = `/api/v1/workspaces/${slug}/projects/${project.id}`
    const send = (method, url, body, user = owner) => request(`${path}${url}`, { ...user, method, body })

    // No estimate yet: project-estimates is empty
    assert.deepEqual(await responseJson(await send('GET', '/project-estimates'), 200), [])

    // Name is optional (random), points are returned with the estimate
    const estimate = await responseJson(
      await send('POST', '/estimates', {
        estimate: { type: 'points' },
        estimate_points: [
          { key: 1, value: '1' },
          { key: 2, value: '2' },
          { key: 3, value: '3' }
        ]
      }),
      201
    )
    assert.match(estimate.name, /^[a-z]{10}$/)
    assert.equal(estimate.points.length, 3)
    assert.equal((await responseJson(await send('GET', '/estimates'), 200))[0].points.length, 3)
    db.prepare('UPDATE projects SET estimate_id = ? WHERE id = ?').run(estimate.id, project.id)
    assert.equal((await responseJson(await send('GET', '/project-estimates'), 200)).length, 3)

    // Bulk update needs points and ignores ids of other estimates
    assert.equal((await send('PATCH', `/estimates/${estimate.id}`, { estimate: { name: 'x' }, estimate_points: [] })).status, 400)
    const [p1, p2, p3] = estimate.points
    const updated = await responseJson(
      await send('PATCH', `/estimates/${estimate.id}`, {
        estimate: { name: 'Renamed' },
        estimate_points: [{ id: p1.id, value: 'one' }, { id: 999999999, value: 'ghost' }]
      }),
      200
    )
    assert.equal(updated.name, 'Renamed')
    assert.equal(updated.points.find(point => point.id === p1.id).value, 'one')
    // Plain name/description patch still works
    assert.equal((await responseJson(await send('PATCH', `/estimates/${estimate.id}`, { description: 'd' }), 200)).description, 'd')

    // Single point create: Plane rejects a missing key or value
    assert.equal((await send('POST', `/estimates/${estimate.id}/estimate-points`, { value: '5' })).status, 400)
    const p4 = await responseJson(await send('POST', `/estimates/${estimate.id}/estimate-points`, { key: 4, value: '4' }), 201)
    assert.equal(p4.key, 4)

    // Delete a point: issues move to the new point, higher keys shift down
    const issue = await responseJson(await send('POST', '/issues', { name: 'Estimated' }), 201)
    db.prepare('UPDATE issues SET estimate_point_id = ? WHERE id = ?').run(p2.id, issue.id)
    assert.equal((await send('DELETE', `/estimates/${estimate.id}/estimate-points/${p2.id}`, { new_estimate_id: 999999999 })).status, 404)
    const shifted = await responseJson(
      await send('DELETE', `/estimates/${estimate.id}/estimate-points/${p2.id}`, { new_estimate_id: p1.id }),
      200
    )
    assert.deepEqual(shifted.map(point => [point.id, point.key]).sort(), [[p3.id, 2], [p4.id, 3]].sort())
    assert.equal(db.prepare('SELECT estimate_point_id FROM issues WHERE id = ?').get(issue.id).estimate_point_id, p1.id)
    assert.equal(db.prepare('SELECT key FROM estimate_points WHERE id = ?').get(p4.id).key, 3)
    // Without a replacement the issue loses its estimate
    await responseJson(await send('DELETE', `/estimates/${estimate.id}/estimate-points/${p1.id}`), 200)
    assert.equal(db.prepare('SELECT estimate_point_id FROM issues WHERE id = ?').get(issue.id).estimate_point_id, null)

    // Workspace listing honours project visibility: a guest outside the project sees nothing
    const list = await responseJson(await request(`/api/v1/workspaces/${slug}/estimates`, owner), 200)
    assert.equal(list.length, 1)
    db.prepare('INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (?, ?, 5)').run(workspace.id, guest.id)
    assert.deepEqual(await responseJson(await request(`/api/v1/workspaces/${slug}/estimates`, guest), 200), [])
    assert.equal((await request(`/api/v1/workspaces/${slug}/estimates`)).status, 401)
  } finally {
    db.close()
  }
})
