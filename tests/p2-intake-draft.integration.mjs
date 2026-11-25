import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

// Isolated Worker test of intake work items (app and public API) and workspace drafts. See README "Kiểm thử chuyển backend".
// Needs the route mounts listed in docs/plane-demo-porting/handoff/p2-intake-draft.md.
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
  const username = `p2id${runId}${suffix}`
  const response = await request('/api/auth/sign-up/email', {
    method: 'POST',
    ip,
    body: { name: `P2 ${suffix}`, username, email: `${username}@example.com`, password: 'isolated-test-password' }
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

test('intake work items follow the triage workflow and drafts convert into issues', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('owner', '198.18.220.1')
    const guest = await signUp('guest', '198.18.220.2')
    const slug = `p2id-${runId}`
    const workspace = await responseJson(
      await request('/api/v1/workspaces', { ...owner, method: 'POST', body: { name: 'P2 Intake', slug } }),
      201
    )
    const project = await responseJson(
      await request(`/api/v1/workspaces/${slug}/projects`, {
        ...owner,
        method: 'POST',
        body: { name: 'P2 Intake', identifier: 'PTWO' }
      }),
      201
    )
    db.prepare('UPDATE projects SET intake_view = 1 WHERE id = ?').run(project.id)
    db.prepare('INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (?, ?, 5)').run(
      workspace.id,
      guest.id
    )
    db.prepare('INSERT INTO project_members (workspace_id, project_id, member_id, role) VALUES (?, ?, ?, 5)').run(
      workspace.id,
      project.id,
      guest.id
    )
    const path = `/api/v1/workspaces/${slug}/projects/${project.id}`
    const call = (url, method, body, user = owner) => request(`${path}${url}`, { ...user, method, body })
    const wsCall = (url, method, body, user = owner) =>
      request(`/api/v1/workspaces/${slug}${url}`, { ...user, method, body })

    // Intake container: the first intake is returned with its pending count.
    await responseJson(await call('/intakes', 'POST', { name: 'Inbox' }), 201)
    const intake = await responseJson(await call('/inboxes', 'GET'), 200)
    assert.equal(intake.name, 'Inbox')
    assert.equal(intake.pendingIssueCount, 0)

    // Submitting: a guest may submit, the work item lands in the triage state with status pending.
    assert.equal((await call('/inbox-issues', 'POST', { issue: { priority: 'high' } })).status, 400)
    assert.equal((await call('/inbox-issues', 'POST', { issue: { name: 'Bad', priority: 'huge' } })).status, 400)
    const submitted = await responseJson(
      await call('/inbox-issues', 'POST', { issue: { name: 'Please add dark mode', priority: 'high' } }, guest),
      200
    )
    assert.equal(submitted.status, -2)
    const triage = db
      .prepare('SELECT s."group" AS g FROM issues i JOIN states s ON s.id = i.state_id WHERE i.id = ?')
      .get(submitted.issue.id)
    assert.equal(triage.g, 'triage')
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM issue_activities WHERE issue_id = ?').get(submitted.issue.id).n,
      1
    )
    assert.equal((await responseJson(await call('/inboxes', 'GET'), 200)).pendingIssueCount, 1)

    // The guest only sees own items; the owner lists pending ones and filters by status.
    const own = await responseJson(await call('/inbox-issues', 'GET', undefined, guest), 200)
    assert.equal(own.total_count, 1)
    const mine = await responseJson(await call('/inbox-issues', 'POST', { issue: { name: 'Owner request' } }), 200)
    assert.equal((await responseJson(await call('/inbox-issues', 'GET', undefined, guest), 200)).total_count, 1)
    assert.equal((await responseJson(await call('/inbox-issues', 'GET'), 200)).total_count, 2)
    assert.equal((await responseJson(await call('/inbox-issues?status=1', 'GET'), 200)).total_count, 0)
    assert.equal((await call('/inbox-issues?status=7', 'GET')).status, 400)
    assert.equal((await call(`/inbox-issues/${mine.issue.id}`, 'GET', undefined, guest)).status, 403)

    // A guest cannot triage their own item, but may edit its name.
    const guestPatch = await responseJson(
      await call(
        `/inbox-issues/${submitted.issue.id}`,
        'PATCH',
        { status: 1, issue: { name: 'Dark mode please' } },
        guest
      ),
      200
    )
    assert.equal(guestPatch.status, -2)
    assert.equal(db.prepare('SELECT name FROM issues WHERE id = ?').get(submitted.issue.id).name, 'Dark mode please')

    // Snooze: a bare date wakes at the start of that day in the project timezone (UTC here).
    const snoozed = await responseJson(
      await call(`/inbox-issues/${mine.issue.id}`, 'PATCH', { status: 0, snoozed_till: '2099-01-02' }),
      200
    )
    assert.equal(snoozed.status, 0)
    assert.equal(new Date(snoozed.snoozedTill).toISOString(), '2099-01-02T00:00:00.000Z')

    // Duplicate needs a work item of the same project.
    const target = await responseJson(await call('/issues', 'POST', { name: 'Existing' }), 201)
    assert.equal(
      (await call(`/inbox-issues/${mine.issue.id}`, 'PATCH', { status: 2, duplicate_to: 999999999 })).status,
      400
    )
    const duplicate = await responseJson(
      await call(`/inbox-issues/${mine.issue.id}`, 'PATCH', { status: 2, duplicate_to: target.id }),
      200
    )
    assert.equal(duplicate.duplicateIssueDetail.id, target.id)

    // Accepting moves the work item out of triage into the default state and records an intake activity.
    const accepted = await responseJson(await call(`/inbox-issues/${submitted.issue.id}`, 'PATCH', { status: 1 }), 200)
    assert.equal(accepted.status, 1)
    const moved = db
      .prepare(
        'SELECT s."group" AS g, s."default" AS d FROM issues i JOIN states s ON s.id = i.state_id WHERE i.id = ?'
      )
      .get(submitted.issue.id)
    assert.notEqual(moved.g, 'triage')
    assert.equal(moved.d, 1)
    assert.equal(
      db
        .prepare("SELECT COUNT(*) AS n FROM issue_activities WHERE issue_id = ? AND field = 'intake'")
        .get(submitted.issue.id).n,
      1
    )

    // Public API: needs intake_view, answers with issueDetail and 201 on create.
    const apiCreated = await responseJson(
      await call('/intake-issues', 'POST', { issue: { name: 'From API', priority: 'low' } }),
      201
    )
    assert.equal(apiCreated.issueDetail.name, 'From API')
    assert.equal((await responseJson(await call('/intake-issues', 'GET'), 200)).results.length >= 1, true)
    assert.equal((await responseJson(await call(`/intake-issues/${apiCreated.issueDetail.id}`, 'GET'), 200)).status, -2)
    db.prepare('UPDATE projects SET intake_view = 0 WHERE id = ?').run(project.id)
    assert.equal((await responseJson(await call('/intake-issues', 'GET'), 200)).results.length, 0)
    db.prepare('UPDATE projects SET intake_view = 1 WHERE id = ?').run(project.id)

    // Deleting a pending item removes the work item; an accepted one keeps it.
    assert.equal((await call(`/intake-issues/${apiCreated.issueDetail.id}`, 'DELETE')).status, 204)
    assert.equal(
      db.prepare('SELECT deleted_at IS NOT NULL AS gone FROM issues WHERE id = ?').get(apiCreated.issueDetail.id).gone,
      1
    )
    assert.equal((await call(`/inbox-issues/${submitted.issue.id}`, 'DELETE')).status, 204)
    assert.equal(
      db.prepare('SELECT deleted_at IS NULL AS live FROM issues WHERE id = ?').get(submitted.issue.id).live,
      1
    )

    // Drafts: private to the creator, optional project, convertible into an issue.
    const labelA = await responseJson(await call('/labels', 'POST', { name: 'Draft label' }), 201)
    const emptyDraft = await responseJson(await wsCall('/draft-issues', 'POST', { name: 'No project' }), 201)
    assert.equal(emptyDraft.projectId, null)
    assert.equal(
      (await wsCall('/draft-issues', 'POST', { name: 'Not mine', project_id: project.id }, guest)).status,
      403
    )
    assert.equal(
      (
        await wsCall('/draft-issues', 'POST', {
          name: 'Bad dates',
          start_date: '2026-02-02',
          target_date: '2026-01-01'
        })
      ).status,
      400
    )
    const draft = await responseJson(
      await wsCall('/draft-issues', 'POST', {
        name: 'Plan launch',
        project_id: project.id,
        priority: 'high',
        label_ids: [labelA.id, 999999],
        assignee_ids: [owner.id, guest.id],
        description_html: '<p>Launch</p>'
      }),
      201
    )
    assert.deepEqual(draft.labelIds, [labelA.id])
    assert.deepEqual(draft.assigneeIds, [owner.id])
    assert.ok(draft.stateId)
    const list = await responseJson(await wsCall('/draft-issues', 'GET'), 200)
    assert.equal(list.total_count, 2)
    assert.equal((await responseJson(await wsCall('/draft-issues', 'GET', undefined, guest), 200)).total_count, 0)
    assert.equal((await wsCall(`/draft-issues/${draft.id}`, 'GET', undefined, guest)).status, 404)
    assert.equal(
      (await wsCall(`/draft-issues/${draft.id}`, 'PATCH', { name: 'Plan launch v2', label_ids: [] })).status,
      204
    )
    const detail = await responseJson(await wsCall(`/draft-issues/${draft.id}`, 'GET'), 200)
    assert.equal(detail.name, 'Plan launch v2')
    assert.deepEqual(detail.labelIds, [])
    assert.equal((await call('', 'PATCH', { cycleView: true })).status, 200)
    const cycle = await responseJson(await call('/cycles', 'POST', { name: 'Draft cycle' }), 201)
    assert.equal(
      (await wsCall(`/draft-to-issue/${draft.id}`, 'POST', { name: 'Plan launch', cycle_id: 999999 })).status,
      400
    )
    const converted = await responseJson(
      await wsCall(`/draft-to-issue/${draft.id}`, 'POST', {
        name: 'Plan launch',
        priority: 'high',
        cycle_id: cycle.id
      }),
      201
    )
    assert.equal(converted.name, 'Plan launch')
    assert.equal(
      db.prepare('SELECT cycle_id FROM cycle_issues WHERE issue_id = ? AND deleted_at IS NULL').get(converted.id)
        .cycle_id,
      cycle.id
    )
    assert.equal(
      db.prepare('SELECT deleted_at IS NOT NULL AS gone FROM draft_issues WHERE id = ?').get(draft.id).gone,
      1
    )
    assert.equal((await wsCall(`/draft-to-issue/${emptyDraft.id}`, 'POST', { name: 'x' })).status, 400)
    assert.equal((await wsCall(`/draft-issues/${emptyDraft.id}`, 'DELETE')).status, 204)
    assert.equal((await responseJson(await wsCall('/draft-issues', 'GET'), 200)).total_count, 0)
  } finally {
    db.close()
  }
})
