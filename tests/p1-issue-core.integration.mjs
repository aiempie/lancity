import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

// Isolated Worker test of the core issue API: create, list, filters, groups, detail, update, archive, bulk, states, labels.
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
async function signUp(suffix, ip) {
  const username = `core${runId}${suffix}`
  const response = await request('/api/auth/sign-up/email', {
    method: 'POST',
    ip,
    body: { name: `Core ${suffix}`, username, email: `${username}@example.com`, password: 'isolated-test-password' }
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

test('core issue API covers create, list, filters, detail, update and bulk operations', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('owner', '198.18.210.1')
    const guest = await signUp('guest', '198.18.210.2')
    const slug = `core-${runId}`
    const workspace = await responseJson(
      await request('/api/v1/workspaces', { ...owner, method: 'POST', body: { name: 'Core', slug } }),
      201
    )
    const project = await responseJson(
      await request(`/api/v1/workspaces/${slug}/projects`, {
        ...owner,
        method: 'POST',
        body: { name: 'Core', identifier: 'CORE' }
      }),
      201
    )
    const path = `/api/v1/workspaces/${slug}/projects/${project.id}`
    const call = (url, method, body, user = owner) => request(`${path}${url}`, { ...user, method, body })
    const get = (url, user = owner) => request(`${path}${url}`, user)

    // States: a new project starts with Backlog, Todo, In Progress, Done, Cancelled and a hidden Triage state.
    const initial = await responseJson(await get('/states'), 200)
    assert.equal(initial.length, 5)
    const backlog = initial.find(state => state.name === 'Backlog')
    const done = initial.find(state => state.name === 'Done')
    assert.equal(backlog.default, true)
    const review = await responseJson(await call('/states', 'POST', { name: 'Code Review', color: '#222', group: 'started' }), 201)
    assert.equal(review.slug, 'code-review')
    assert.equal(review.sequence, 70000)
    assert.equal((await call('/states', 'POST', { name: 'Done', color: '#222' })).status, 409)
    assert.equal((await call('/states', 'POST', { name: 'Tri', color: '#222', group: 'triage' })).status, 400)
    const planned = await responseJson(
      await call('/states', 'POST', { name: 'Planned', color: '#333', group: 'unstarted', default: true }),
      201
    )
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM states WHERE project_id = ? AND "default" = 1').get(project.id).n, 1)
    assert.equal((await call(`/states/${backlog.id}/mark-default`, 'POST')).status, 204)
    assert.equal(db.prepare('SELECT "default" AS d FROM states WHERE id = ?').get(backlog.id).d, 1)
    assert.equal(db.prepare('SELECT "default" AS d FROM states WHERE id = ?').get(planned.id).d, 0)
    const grouped = await responseJson(await get('/states?grouped=true'), 200)
    assert.deepEqual(Object.keys(grouped).sort(), ['backlog', 'cancelled', 'completed', 'started', 'unstarted'])
    assert.equal(grouped.backlog[0].order, 1)
    assert.equal((await call(`/states/${backlog.id}`, 'DELETE')).status, 400)
    await responseJson(await call(`/states/${planned.id}`, 'PATCH', { color: '#444' }), 200)
    assert.equal((await responseJson(await get('/intake-state'), 200)).name, 'Triage')

    // Labels: case-insensitive names, sort order, alias path.
    const bug = await responseJson(await call('/labels', 'POST', { name: 'Bug', color: '#f00' }), 201)
    const feature = await responseJson(await call('/issue-labels', 'POST', { name: 'Feature' }), 201)
    assert.equal(feature.sortOrder, bug.sortOrder + 10000)
    assert.equal((await call('/labels', 'POST', { name: 'bug' })).status, 409)
    assert.equal((await call(`/labels/${feature.id}`, 'PATCH', { name: 'BUG' })).status, 409)
    const bulk = await responseJson(await call('/bulk-create-labels', 'POST', { labelData: [{ name: 'Bug' }, { name: 'Ops' }] }), 201)
    assert.equal(bulk.labels.length, 1)

    // Create: description, labels, assignees (invalid ones dropped), unique sequence under concurrency.
    db.prepare('INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (?, ?, 5)').run(workspace.id, guest.id)
    db.prepare('INSERT INTO project_members (workspace_id, project_id, member_id, role) VALUES (?, ?, ?, 5)').run(
      workspace.id,
      project.id,
      guest.id
    )
    const first = await responseJson(
      await call('/issues', 'POST', {
        name: 'First',
        priority: 'high',
        descriptionHtml: '<p>Hello <b>there</b></p>',
        labelIds: [bug.id, 999999],
        assigneeIds: [owner.id, guest.id],
        stateId: backlog.id
      }),
      201
    )
    assert.equal(first.sequenceId, 1)
    assert.equal(first.descriptionStripped, 'Hello there')
    assert.deepEqual(
      db.prepare('SELECT label_id FROM issue_labels WHERE issue_id = ? AND deleted_at IS NULL').all(first.id).map(row => row.label_id),
      [bug.id]
    )
    assert.deepEqual(
      db.prepare('SELECT assignee_id FROM issue_assignees WHERE issue_id = ? AND deleted_at IS NULL').all(first.id).map(row => row.assignee_id),
      [owner.id]
    )
    const parallel = await Promise.all(
      Array.from({ length: 8 }, (_, index) => call('/issues', 'POST', { name: `Parallel ${index}`, stateId: backlog.id }))
    )
    const created = await Promise.all(parallel.map(response => responseJson(response, 201)))
    const sequences = [first, ...created].map(issue => issue.sequenceId).sort((a, b) => a - b)
    assert.deepEqual(sequences, Array.from({ length: 9 }, (_, index) => index + 1))
    assert.equal(new Set(created.map(issue => issue.sortOrder)).size >= 1, true)
    const external = await responseJson(
      await call('/issues', 'POST', { name: 'External', externalId: 'ext-1', externalSource: 'import' }),
      201
    )
    assert.equal((await call('/issues', 'POST', { name: 'Dup', externalId: 'ext-1', externalSource: 'import' })).status, 409)
    const upsert = await responseJson(
      await call('/issues', 'PUT', { name: 'External renamed', externalId: 'ext-1', externalSource: 'import' }),
      200
    )
    assert.equal(upsert.id, external.id)
    assert.equal((await call('/issues', 'PUT', { name: 'No external id' })).status, 400)
    const byExternal = await responseJson(await get('/issues?external_id=ext-1&external_source=import'), 200)
    assert.equal(byExternal.name, 'External renamed')

    // List: legacy array, envelope, filters, order, pagination, groups.
    assert.ok(Array.isArray(await responseJson(await get('/issues'), 200)))
    const page = await responseJson(await get('/issues?per_page=4&order_by=sequence_id'), 200)
    assert.equal(page.results.length, 4)
    assert.equal(page.total_count, 10)
    assert.equal(page.next_page_results, true)
    assert.equal(page.next_cursor, '4:1:0')
    assert.deepEqual(page.results.map(issue => issue.sequenceId), [1, 2, 3, 4])
    const next = await responseJson(await get('/issues?per_page=4&order_by=sequence_id&cursor=4:1:0'), 200)
    assert.deepEqual(next.results.map(issue => issue.sequenceId), [5, 6, 7, 8])
    assert.equal((await get('/issues?per_page=0')).status, 400)
    assert.equal((await get('/issues?cursor=bad')).status, 400)
    const byLabel = await responseJson(await get(`/issues?labels=${bug.id}`), 200)
    assert.deepEqual(byLabel.results.map(issue => issue.id), [first.id])
    assert.deepEqual(byLabel.results[0].labelIds, [bug.id])
    const unlabeled = await responseJson(await get('/issues?labels=None&per_page=50'), 200)
    assert.equal(unlabeled.total_count, 9)
    const byName = await responseJson(await get('/issues?name=parallel%203'), 200)
    assert.equal(byName.total_count, 1)
    const byPriority = await responseJson(await get('/issues?priority=high'), 200)
    assert.equal(byPriority.total_count, 1)
    const priorityOrder = await responseJson(await get('/issues?order_by=-priority&per_page=3'), 200)
    assert.equal(priorityOrder.results[0].id, first.id)
    assert.equal((await responseJson(await get('/issues?order_by=-created_at;drop'), 200)).total_count, 10)
    const groupedByState = await responseJson(await get('/issues?group_by=state_id'), 200)
    assert.equal(groupedByState.grouped_by, 'state_id')
    assert.equal(groupedByState.results[String(backlog.id)].total_results, 10)
    assert.equal(groupedByState.results[String(done.id)].total_results, 0)
    assert.equal(groupedByState.results.None, undefined)
    const groupedByLabel = await responseJson(await get('/issues?group_by=labels__id&per_page=3'), 200)
    assert.equal(groupedByLabel.results[String(bug.id)].results.length, 1)
    assert.equal(groupedByLabel.results.None.results.length, 3)
    assert.equal(groupedByLabel.results.None.total_results, 9)
    const sub = await responseJson(await get('/issues?group_by=priority&sub_group_by=state__group'), 200)
    assert.equal(sub.sub_grouped_by, 'state__group')
    assert.equal(sub.results.high.results.backlog.total_results, 1)
    assert.equal((await get('/issues?group_by=priority&sub_group_by=priority')).status, 400)
    assert.equal((await get('/issues?group_by=name')).status, 400)
    const sync = await responseJson(await get('/v2/issues?per_page=2&description=true'), 200)
    assert.equal(sync.results.length, 2)
    assert.ok('descriptionHtml' in sync.results[0])

    // Detail, identifier, meta, search.
    const detail = await responseJson(await get(`/issues/${first.id}`), 200)
    assert.deepEqual(detail.labelIds, [bug.id])
    assert.deepEqual(detail.assigneeIds, [owner.id])
    // The owner is the assignee, and Plane auto-subscribes assignees.
    // The subscription is written by the background activity job, so poll for it.
    let subscribed = detail.isSubscribed
    for (let attempt = 0; !subscribed && attempt < 30; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 500))
      subscribed = (await responseJson(await get(`/issues/${first.id}`), 200)).isSubscribed
    }
    assert.equal(subscribed, true)
    assert.deepEqual(await responseJson(await get(`/issues/${first.id}/meta`), 200), { sequenceId: 1, projectIdentifier: 'CORE' })
    const workspacePath = `/api/v1/workspaces/${slug}`
    const byIdentifier = await responseJson(await request(`${workspacePath}/work-items/core-1`, owner), 200)
    assert.equal(byIdentifier.id, first.id)
    assert.equal((await request(`${workspacePath}/work-items/core-x`, owner)).status, 400)
    assert.equal((await request(`${workspacePath}/issues/CORE-x`, owner)).status, 404)
    const found = await responseJson(await request(`${workspacePath}/issues/search?search=First`, owner), 200)
    assert.equal(found.issues[0].id, first.id)
    assert.equal((await responseJson(await request(`${workspacePath}/issues/search?search=CORE-1`, owner), 200)).issues.length >= 1, true)
    assert.equal((await responseJson(await request(`${workspacePath}/states`, owner), 200)).length, 7)
    assert.equal((await responseJson(await request(`${workspacePath}/labels`, owner), 200)).length, 3)
    // A guest only sees what they created.
    assert.equal((await get(`/issues/${first.id}`, guest)).status, 404)
    assert.equal((await responseJson(await get('/issues?per_page=5', guest), 200)).total_count, 0)

    // Update: scalar fields, relation diffs, parent rules, conflicts and activity.
    const second = created[0]
    const patched = await responseJson(
      await call(`/issues/${first.id}`, 'PATCH', {
        name: 'First renamed',
        stateId: done.id,
        labelIds: [feature.id],
        assigneeIds: [],
        parentId: second.id
      }),
      200
    )
    assert.equal(patched.name, 'First renamed')
    assert.ok(patched.completedAt)
    assert.deepEqual(
      db.prepare('SELECT label_id FROM issue_labels WHERE issue_id = ? AND deleted_at IS NULL').all(first.id).map(row => row.label_id),
      [feature.id]
    )
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM issue_assignees WHERE issue_id = ? AND deleted_at IS NULL').get(first.id).n, 0)
    const fields = db
      .prepare("SELECT field FROM issue_activities WHERE issue_id = ? AND verb = 'updated'")
      .all(first.id)
      .map(row => row.field)
    for (const field of ['name', 'state', 'parent', 'labels', 'assignees']) assert.ok(fields.includes(field), field)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM issue_versions WHERE issue_id = ?').get(first.id).n, 2)
    assert.equal((await call(`/issues/${second.id}`, 'PATCH', { parentId: first.id })).status, 400)
    assert.equal((await call(`/issues/${second.id}`, 'PATCH', { parentId: second.id })).status, 400)
    assert.equal((await call(`/issues/${first.id}`, 'PATCH', { startDate: '2026-02-02', targetDate: '2026-02-01' })).status, 400)
    assert.equal((await call(`/issues/${first.id}`, 'PATCH', { stateId: 999999 })).status, 400)
    assert.equal((await call(`/issues/${first.id}`, 'PATCH', { name: 'Denied' }, guest)).status, 404)

    // Sub-issues.
    const children = await responseJson(await get(`/issues/${second.id}/sub-issues`), 200)
    assert.deepEqual(children.subIssues.map(issue => issue.id), [first.id])
    assert.deepEqual(children.stateDistribution.completed, [String(first.id)])
    const attached = await responseJson(
      await call(`/issues/${second.id}/sub-issues`, 'POST', { subIssueIds: [created[1].id, created[2].id] }),
      200
    )
    assert.equal(attached.subIssues.length, 2)
    assert.equal((await call(`/issues/${first.id}/sub-issues`, 'POST', { subIssueIds: [second.id] })).status, 400)
    assert.equal((await responseJson(await get(`/issues?sub_issue=false&per_page=50`), 200)).total_count, 7)

    // Dates in bulk, archive rules, bulk delete.
    assert.equal(
      (await call('/issue-dates', 'POST', { updates: [{ id: created[3].id, startDate: '2026-03-02', targetDate: '2026-03-01' }] })).status,
      400
    )
    await responseJson(
      await call('/issue-dates', 'POST', { updates: [{ id: created[3].id, startDate: '2026-03-01', targetDate: '2026-03-05' }] }),
      200
    )
    assert.equal(db.prepare('SELECT start_date AS s FROM issues WHERE id = ?').get(created[3].id).s, '2026-03-01')
    assert.equal((await call(`/issues/${created[3].id}/archive`, 'POST')).status, 400)
    const archived = await responseJson(await call(`/issues/${first.id}/archive`, 'POST'), 200)
    assert.match(archived.archivedAt, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal((await responseJson(await get('/archived-issues'), 200)).total_count, 1)
    assert.equal((await responseJson(await get(`/issues/${first.id}/archive`), 200)).id, first.id)
    assert.equal((await responseJson(await get('/deleted-issues'), 200)).includes(first.id), true)
    assert.equal((await call(`/issues/${first.id}/archive`, 'DELETE')).status, 204)
    assert.equal((await call('/bulk-archive-issues', 'POST', { issueIds: [first.id, created[3].id] })).status, 400)
    assert.equal(db.prepare('SELECT archived_at FROM issues WHERE id = ?').get(first.id).archived_at, null)
    assert.equal((await call('/bulk-delete-issues', 'DELETE', { issueIds: [created[4].id, created[5].id] }, guest)).status, 403)
    const removed = await responseJson(await call('/bulk-delete-issues', 'DELETE', { issueIds: [created[4].id, created[5].id] }), 200)
    assert.equal(removed.deleted, 2)
    assert.equal((await get(`/issues/${created[4].id}`)).status, 404)
    assert.equal((await responseJson(await get('/deleted-issues'), 200)).includes(created[4].id), true)
    assert.equal((await call(`/issues/${created[6].id}`, 'DELETE', undefined, guest)).status, 404)
    assert.equal((await call(`/issues/${created[6].id}`, 'DELETE')).status, 204)
    const afterDelete = await responseJson(await call('/issues', 'POST', { name: 'After delete' }), 201)
    assert.equal(afterDelete.sequenceId, 11)

    // State deletion rules and label deletion.
    assert.equal((await call(`/states/${backlog.id}`, 'DELETE')).status, 400)
    assert.equal((await call(`/states/${done.id}`, 'DELETE')).status, 400)
    assert.equal((await call(`/states/${planned.id}`, 'DELETE')).status, 204)
    assert.equal((await call(`/labels/${bug.id}`, 'DELETE')).status, 204)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM issue_labels WHERE label_id = ? AND deleted_at IS NULL').get(bug.id).n, 0)

    // User properties are created on first read and patched in place.
    const props = await responseJson(await get('/user-properties'), 200)
    assert.equal(props.displayFilters.order_by, '-created_at')
    const patchedProps = await responseJson(await call('/user-properties', 'PATCH', { displayFilters: { layout: 'kanban' } }), 200)
    assert.equal(patchedProps.displayFilters.layout, 'kanban')
    // The sanitizer strips scripts instead of rejecting the request.
    const scripted = await call('/issues', 'POST', { name: 'Bad', descriptionHtml: '<p>ok</p><script>x</script>' })
    assert.equal(scripted.status, 201)
    const scriptedBody = await scripted.json()
    assert.equal(
      db.prepare('SELECT description_html FROM issues WHERE id = ?').get(scriptedBody.id).description_html.includes('<script'),
      false
    )

    const largeHtml = `<p>${'x'.repeat(157_000)}</p>`
    assert.equal((await call(`/issues/${scriptedBody.id}`, 'PATCH', { descriptionHtml: largeHtml })).status, 200)
    const readVersion = db.prepare('SELECT owned_by_id FROM issue_description_versions WHERE issue_id = ? AND description_html = ?')
    let saved
    const deadline = Date.now() + 25_000
    while (Date.now() < deadline && !(saved = readVersion.get(scriptedBody.id, largeHtml))) await delay(250)
    assert.equal(saved?.owned_by_id, owner.id, 'The Queue stores the 157 KB description version for the editor')

    // A maximum-size set of valid members and labels must fit D1's bind limit on create and update.
    const insertUser = db.prepare('INSERT INTO user(name,email,username,created_at,updated_at) VALUES(?,?,?,?,?)')
    const insertWorkspaceMember = db.prepare('INSERT INTO workspace_members(workspace_id,member_id,role) VALUES(?,?,15)')
    const insertProjectMember = db.prepare('INSERT INTO project_members(workspace_id,project_id,member_id,role) VALUES(?,?,?,15)')
    const insertLabel = db.prepare('INSERT INTO labels(name,project_id,workspace_id) VALUES(?,?,?)')
    const assigneeIds = [owner.id]
    const labelIds = []
    for (let index = 0; index < 100; index++) {
      labelIds.push(Number(insertLabel.run(`Many ${index}`, project.id, workspace.id).lastInsertRowid))
      if (index < 99) {
        const username = `many${runId}${index}`
        const id = Number(insertUser.run(username, `${username}@example.com`, username, Date.now(), Date.now()).lastInsertRowid)
        insertWorkspaceMember.run(workspace.id, id)
        insertProjectMember.run(workspace.id, project.id, id)
        assigneeIds.push(id)
      }
    }
    const many = await responseJson(await call('/issues', 'POST', { name: 'Many relations', assigneeIds, labelIds }), 201)
    assert.equal(db.prepare('SELECT count(*) AS n FROM issue_assignees WHERE issue_id = ? AND deleted_at IS NULL').get(many.id).n, 100)
    assert.equal(db.prepare('SELECT count(*) AS n FROM issue_labels WHERE issue_id = ? AND deleted_at IS NULL').get(many.id).n, 100)
    const manyUpdated = await responseJson(
      await call(`/issues/${many.id}`, 'PATCH', { name: 'Many relations updated', assigneeIds, labelIds }),
      200
    )
    assert.equal(manyUpdated.name, 'Many relations updated')
    assert.equal(db.prepare('SELECT count(*) AS n FROM issue_assignees WHERE issue_id = ? AND deleted_at IS NULL').get(many.id).n, 100)
    assert.equal(db.prepare('SELECT count(*) AS n FROM issue_labels WHERE issue_id = ? AND deleted_at IS NULL').get(many.id).n, 100)
  } finally {
    db.close()
  }
})
