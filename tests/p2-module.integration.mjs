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
    ip: suffix === 'owner' ? '198.18.213.1' : '198.18.213.2',
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

test('modules: write rules, counters, issues, links, properties, favorites, archive and delete', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('owner')
    const outsider = await signUp('outsider')
    const slug = `mod-${runId}`
    const workspace = await responseJson(
      await request('/api/v1/workspaces', { ...owner, method: 'POST', body: { name: 'Modules', slug } }),
      201
    )
    const project = await responseJson(
      await request(`/api/v1/workspaces/${slug}/projects`, {
        ...owner,
        method: 'POST',
        body: { name: 'Modules', identifier: 'MOD' }
      }),
      201
    )
    db.prepare('UPDATE projects SET module_view = 1 WHERE id = ?').run(project.id)
    const path = `/api/v1/workspaces/${slug}/projects/${project.id}`
    const send = (method, url, body, user = owner) => request(`${path}${url}`, { ...user, method, body })

    // Access and validation
    assert.equal((await request(`${path}/modules`)).status, 401)
    assert.equal((await send('GET', '/modules', undefined, outsider)).status, 404)
    assert.equal(
      (await send('POST', '/modules', { name: 'Bad', start_date: '2026-02-01', target_date: '2026-01-01' })).status,
      400
    )
    assert.equal((await send('POST', '/modules', { name: 'Lead', lead_id: outsider.id })).status, 400)

    // Create: the creator leads by default, the newest module sorts first
    const first = await responseJson(
      await send('POST', '/modules', { name: 'First', external_source: 'jira', external_id: '1' }),
      201
    )
    assert.equal(first.leadId, owner.id)
    assert.equal(first.totalIssues, 0)
    assert.equal(first.isFavorite, false)
    assert.equal((await send('POST', '/modules', { name: 'First' })).status, 409)
    assert.equal(
      (await send('POST', '/modules', { name: 'Other', external_source: 'jira', external_id: '1' })).status,
      409
    )
    const second = await responseJson(
      await send('POST', '/modules', { name: 'Second', member_ids: [owner.id, outsider.id], status: 'in-progress' }),
      201
    )
    assert.deepEqual(second.memberIds, [owner.id], 'only project members are kept')
    assert.ok(second.sortOrder < first.sortOrder)
    assert.deepEqual(
      (await responseJson(await send('GET', '/modules'), 200)).map(item => item.name),
      ['Second', 'First']
    )
    const page = await responseJson(await send('GET', '/modules?per_page=1&order_by=name'), 200)
    assert.equal(page.results.length, 1)
    assert.equal(page.total_count, 2)
    assert.equal(page.results[0].name, 'First')
    assert.equal((await responseJson(await send('GET', '/modules-lite?per_page=10'), 200)).results.length, 2)
    assert.deepEqual(
      Object.keys(await responseJson(await send('GET', `/modules/${first.id}?fields=id,name`), 200)).sort(),
      ['id', 'name']
    )

    // Issues: add through the app route, counters follow the state group of the issue
    const issueA = await responseJson(await send('POST', '/issues', { name: 'A' }), 201)
    const issueB = await responseJson(await send('POST', '/issues', { name: 'B' }), 201)
    assert.equal((await send('POST', `/modules/${first.id}/issues`, { issues: [] })).status, 400)
    assert.equal(
      (await send('POST', `/modules/${first.id}/issues`, { issues: [issueA.id, issueB.id, 999999999] })).status,
      201
    )
    assert.equal((await send('POST', `/modules/${first.id}/issues`, { issues: [issueA.id] })).status, 201)
    assert.equal(db.prepare('SELECT count(*) AS n FROM module_issues WHERE module_id = ?').get(first.id).n, 2)
    const detail = await responseJson(await send('GET', `/modules/${first.id}`), 200)
    assert.equal(detail.totalIssues, 2)
    assert.ok(Array.isArray(detail.linkModule))
    assert.ok(Array.isArray(detail.distribution.assignees))
    const issuePage = await responseJson(await send('GET', `/modules/${first.id}/issues`), 200)
    assert.equal(issuePage.results.length, 2)
    assert.equal((await send('GET', `/modules/${first.id}/issues/${issueA.id}`)).status, 200)
    assert.equal((await send('GET', `/modules/${second.id}/issues/${issueA.id}`)).status, 404)
    const apiPage = await responseJson(await send('GET', `/modules/${first.id}/module-issues?per_page=10`), 200)
    assert.ok(apiPage.results.every(item => typeof item.bridgeId === 'number'))

    // API assignment moves an issue out of its module, the app route may keep it in several
    assert.equal((await send('POST', `/modules/${second.id}/module-issues`, { issues: [issueA.id] })).status, 204)
    assert.equal(
      db.prepare('SELECT module_id FROM module_issues WHERE issue_id = ?').get(issueA.id).module_id,
      second.id
    )
    assert.equal(
      (await send('POST', `/issues/${issueA.id}/modules`, { modules: [first.id], removed_modules: [second.id] }))
        .status,
      201
    )
    assert.deepEqual(
      db
        .prepare('SELECT module_id FROM module_issues WHERE issue_id = ?')
        .all(issueA.id)
        .map(row => row.module_id),
      [first.id]
    )
    assert.equal((await send('DELETE', `/modules/${first.id}/issues/${issueB.id}`)).status, 204)
    assert.equal((await send('DELETE', `/modules/${first.id}/issues/${issueB.id}`)).status, 204)
    assert.equal((await send('DELETE', `/modules/${first.id}/module-issues/${issueB.id}`)).status, 404)
    assert.equal((await send('PATCH', `/modules/${first.id}/issues/${issueA.id}`, {})).status, 405)

    // Links
    const link = await responseJson(
      await send('POST', `/modules/${first.id}/module-links`, { url: 'example.com/a', title: 'A' }),
      201
    )
    assert.equal(link.url, 'http://example.com/a')
    assert.equal((await send('POST', `/modules/${first.id}/module-links`, { url: 'http://example.com/a' })).status, 400)
    assert.equal((await send('POST', `/modules/${first.id}/module-links`, { url: 'not a url' })).status, 400)
    assert.equal(
      (await responseJson(await send('PATCH', `/modules/${first.id}/module-links/${link.id}`, { title: 'B' }), 200))
        .title,
      'B'
    )
    assert.equal((await responseJson(await send('GET', `/modules/${first.id}/module-links`), 200)).length, 1)
    assert.equal((await responseJson(await send('GET', `/modules/${first.id}`), 200)).linkModule.length, 1)
    assert.equal((await send('DELETE', `/modules/${first.id}/module-links/${link.id}`)).status, 204)
    assert.equal((await send('GET', `/modules/${first.id}/module-links/${link.id}`)).status, 404)

    // User properties: defaults on first read, partial patch afterwards
    const properties = await responseJson(await send('GET', `/modules/${first.id}/user-properties`), 200)
    assert.equal(properties.displayFilters.layout, 'list')
    const patched = await responseJson(
      await send('PATCH', `/modules/${first.id}/user-properties`, { display_filters: { layout: 'kanban' } }),
      201
    )
    assert.equal(patched.displayFilters.layout, 'kanban')
    assert.equal(patched.displayProperties.key, true)

    // Favorites float to the top of the app list
    assert.equal((await send('POST', '/user-favorite-modules', { module: 999999999 })).status, 404)
    assert.equal((await send('POST', '/user-favorite-modules', { module: first.id })).status, 204)
    assert.equal((await send('POST', '/user-favorite-modules', { module: first.id })).status, 204)
    const favorites = await responseJson(await send('GET', '/modules'), 200)
    assert.equal(favorites[0].name, 'First')
    assert.equal(favorites[0].isFavorite, true)
    assert.equal((await responseJson(await send('GET', '/user-favorite-modules'), 200)).length, 1)
    assert.equal((await send('DELETE', `/user-favorite-modules/${first.id}`)).status, 204)
    assert.equal((await send('DELETE', `/user-favorite-modules/${first.id}`)).status, 404)

    // Update, workspace list, archive
    const renamed = await responseJson(
      await send('PATCH', `/modules/${first.id}`, { name: 'Renamed', member_ids: [owner.id] }),
      200
    )
    assert.equal(renamed.name, 'Renamed')
    assert.deepEqual(renamed.memberIds, [owner.id])
    assert.equal((await send('PATCH', `/modules/${first.id}`, { name: 'Second' })).status, 409)
    assert.equal(
      (await send('PATCH', `/modules/${first.id}`, { start_date: '2026-03-01', target_date: '2026-01-01' })).status,
      400
    )
    assert.equal((await responseJson(await request(`/api/v1/workspaces/${slug}/modules`, owner), 200)).length, 2)
    assert.equal((await request(`/api/v1/workspaces/${slug}/modules`, outsider)).status, 403)
    assert.equal((await send('POST', `/modules/${first.id}/archive`)).status, 400)
    await responseJson(await send('PATCH', `/modules/${first.id}`, { status: 'completed' }), 200)
    assert.equal((await send('POST', `/modules/${first.id}/archive`)).status, 200)
    assert.equal((await send('PATCH', `/modules/${first.id}`, { name: 'Archived edit' })).status, 400)
    assert.equal((await send('GET', `/modules/${first.id}`)).status, 404)
    assert.equal((await responseJson(await send('GET', '/archived-modules'), 200)).length, 1)
    assert.equal((await responseJson(await send('GET', '/archived-modules?per_page=5'), 200)).results.length, 1)
    assert.equal((await responseJson(await send('GET', `/archived-modules/${first.id}`), 200)).id, first.id)
    assert.equal((await send('DELETE', `/archived-modules/${first.id}/unarchive`)).status, 204)

    // Delete: the module disappears together with its assignments
    assert.equal((await send('DELETE', `/modules/${first.id}`, undefined, outsider)).status, 404)
    assert.equal((await send('DELETE', `/modules/${first.id}`)).status, 204)
    assert.equal((await send('GET', `/modules/${first.id}`)).status, 404)
    assert.equal(db.prepare('SELECT count(*) AS n FROM module_issues WHERE module_id = ?').get(first.id).n, 0)
    assert.ok(db.prepare('SELECT deleted_at FROM modules WHERE id = ?').get(first.id).deleted_at)
    assert.equal((await send('POST', '/modules', { name: 'First' })).status, 201, 'the name is free again')
    assert.ok(workspace.id)
  } finally {
    db.close()
  }
})
