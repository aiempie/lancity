import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'vitest'

// Requires publicRoutes and projectPublicationRoutes (src/server/api/v1/routes/public.ts) to be mounted at
// /public and /workspaces/:slug/projects/:projectId, and the R2 binding ASSET_BUCKET for the asset case.
// The Worker's .dev.vars must set PUBLIC_WRITE_RATE_LIMIT=1000/minute. The default (30/minute) throttles the
// public write calls this suite makes from one visitor and the run then fails with 429.
const base = new URL(process.env.LANCITY_TEST_URL ?? 'http://localhost:4198')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use an isolated local Worker')
assert.ok(process.env.LANCITY_TEST_D1, 'Set LANCITY_TEST_D1 to the isolated Worker database file')
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])

function request(path, { cookie, method = 'GET', body, ip, headers: extra } = {}) {
  const headers = new Headers(extra)
  if (cookie) headers.set('cookie', cookie)
  if (ip) headers.set('cf-connecting-ip', ip)
  if (method !== 'GET') headers.set('origin', base.origin)
  const raw = body instanceof Uint8Array
  if (body !== undefined && !raw) headers.set('content-type', 'application/json')
  return fetch(new URL(path, base), {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    redirect: 'manual'
  })
}
async function responseJson(response, status) {
  assert.equal(response.status, status, `${response.url}: ${await response.clone().text()}`)
  return response.json()
}
async function signUp(suffix, ip) {
  const username = `pub${runId}${suffix}`
  const response = await request('/api/auth/sign-up/email', {
    method: 'POST',
    ip,
    body: { name: `Public ${suffix}`, username, email: `${username}@example.com`, password: 'isolated-test-password' }
  })
  const { user } = await responseJson(response, 200)
  return {
    id: Number(user.id),
    cookie: response.headers
      .getSetCookie()
      .map(value => value.split(';', 1)[0])
      .join('; '),
    ip
  }
}

test('public board: settings, reactions, votes, comment reactions, intake, assets, listing and abuse limits', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('owner', '198.18.230.1')
    const visitor = await signUp('visitor', '198.18.230.2')
    const other = await signUp('other', '198.18.230.3')
    const slug = `pub-${runId}`
    const workspace = await responseJson(
      await request('/api/v1/workspaces', { ...owner, method: 'POST', body: { name: 'Public', slug } }),
      201
    )
    const project = await responseJson(
      await request(`/api/v1/workspaces/${slug}/projects`, {
        ...owner,
        method: 'POST',
        body: { name: 'Public board', identifier: 'PUB' }
      }),
      201
    )
    const projectPath = `/api/v1/workspaces/${slug}/projects/${project.id}`
    const issue = await responseJson(
      await request(`${projectPath}/issues`, { ...owner, method: 'POST', body: { name: 'Board issue' } }),
      201
    )
    const { anchor } = await responseJson(
      await request(`${projectPath}/publication`, { ...owner, method: 'POST' }),
      200
    )
    const board = `/api/v1/public/anchor/${anchor}`
    const get = (path, user) => request(path, user)
    const send = (path, method, body, user) => request(path, { ...user, method, body })

    // PD-1683 to PD-1686: settings, members and the workspace listing.
    const settings = await responseJson(await get(`${board}/settings`), 200)
    assert.equal(settings.anchor, anchor)
    assert.equal(settings.is_reactions_enabled, false)
    assert.equal(settings.project_details.id, project.id)
    const boards = await responseJson(await get(`/api/v1/public/workspaces/${slug}/project-boards`), 200)
    assert.deepEqual(
      boards.map(row => [row.id, row.anchor]),
      [[project.id, anchor]]
    )
    assert.equal(
      (await responseJson(await get(`/api/v1/public/workspaces/${slug}/projects/${project.id}/anchor`), 200)).anchor,
      anchor
    )
    const members = await responseJson(await get(`${board}/members`), 200)
    assert.ok(members.some(member => member.member === owner.id))
    assert.ok(!members.some(member => 'email' in member))

    // The owner decides what visitors may do. Only an admin changes it.
    assert.equal((await send(`${projectPath}/publication`, 'PATCH', { is_votes_enabled: true }, visitor)).status, 404)
    assert.equal((await send(`${projectPath}/publication`, 'PATCH', {}, owner)).status, 400)
    assert.equal((await send(`${projectPath}/publication`, 'PATCH', { unknown: true }, owner)).status, 400)

    // Reactions and votes are off until the board turns them on.
    const reactions = `${board}/issues/${issue.id}/reactions`
    assert.deepEqual(await responseJson(await get(reactions), 200), [])
    assert.equal((await send(reactions, 'POST', { reaction: '👍' }, visitor)).status, 400)
    assert.equal((await send(`${board}/issues/${issue.id}/votes`, 'POST', { vote: 1 }, visitor)).status, 400)
    const enabled = await responseJson(
      await send(
        `${projectPath}/publication`,
        'PATCH',
        { is_reactions_enabled: true, is_votes_enabled: true, is_comments_enabled: true },
        owner
      ),
      200
    )
    assert.equal(enabled.is_reactions_enabled, true)

    // Issue reactions: session required, one per code, own deletion only, hidden issue refused.
    assert.equal((await send(reactions, 'POST', { reaction: '👍' })).status, 401)
    assert.equal((await send(reactions, 'POST', { reaction: '' }, visitor)).status, 400)
    const reaction = await responseJson(await send(reactions, 'POST', { reaction: '👍' }, visitor), 201)
    assert.equal(reaction.actor, visitor.id)
    const reactionEvents = () => db.prepare(`SELECT count(*) AS n FROM job_outbox
      WHERE type = 'issue.activity' AND json_extract(payload, '$.type') = 'issue_reaction.activity.created'
        AND json_extract(payload, '$.issueId') = ? AND json_extract(payload, '$.actorId') = ?`).get(issue.id, visitor.id).n
    assert.equal(reactionEvents(), 1)
    assert.equal((await send(reactions, 'POST', { reaction: '👍' }, visitor)).status, 400)
    assert.equal(reactionEvents(), 1)
    assert.equal((await responseJson(await get(reactions), 200)).length, 1)
    assert.equal((await send(`${reactions}/${encodeURIComponent('👍')}`, 'DELETE', undefined, other)).status, 404)
    assert.equal((await send(`${reactions}/${encodeURIComponent('👍')}`, 'DELETE', undefined, visitor)).status, 204)
    assert.deepEqual(await responseJson(await get(reactions), 200), [])
    assert.ok(db.prepare('SELECT id FROM project_public_members WHERE member_id = ?').get(visitor.id))
    const triage = db.prepare('SELECT id FROM states WHERE project_id = ? AND is_triage = 1').get(project.id)
    const hidden = db
      .prepare(
        `INSERT INTO issues (name, sequence_id, project_id, workspace_id, state_id, is_draft) VALUES ('Hidden', 90, ?, ?, ?, 0) RETURNING id`
      )
      .get(project.id, workspace.id, triage.id)
    assert.equal(
      (await send(`${board}/issues/${hidden.id}/reactions`, 'POST', { reaction: '👍' }, visitor)).status,
      404
    )

    // Votes: one live vote per user, a second call switches it.
    const votes = `${board}/issues/${issue.id}/votes`
    assert.equal((await send(votes, 'POST', { vote: 2 }, visitor)).status, 400)
    assert.equal((await responseJson(await send(votes, 'POST', { vote: 1 }, visitor), 201)).vote, 1)
    assert.equal((await responseJson(await send(votes, 'POST', { vote: -1 }, visitor), 201)).vote, -1)
    assert.equal((await responseJson(await get(votes), 200)).length, 1)
    assert.equal((await send(votes, 'DELETE', undefined, other)).status, 404)
    assert.equal((await send(votes, 'DELETE', undefined, visitor)).status, 204)

    // Comments: rich content is sanitized, then comment reactions work on public comments only.
    const comments = `${board}/issues/${issue.id}/comments`
    const comment = await responseJson(
      await send(comments, 'POST', { comment_html: '<p>Hi <script>alert(1)</script><b>there</b></p>' }, visitor),
      201
    )
    const stored = db.prepare('SELECT comment_html FROM issue_comments WHERE id = ?').get(comment.id)
    assert.ok(!stored.comment_html.includes('<script'))
    const internal = db
      .prepare(
        `INSERT INTO issue_comments (issue_id, project_id, workspace_id, actor_id, comment_stripped) VALUES (?, ?, ?, ?, 'Internal') RETURNING id`
      )
      .get(issue.id, project.id, workspace.id, owner.id)
    const commentReactions = id => `${board}/comments/${id}/reactions`
    assert.equal((await send(commentReactions(internal.id), 'POST', { reaction: '🎉' }, visitor)).status, 404)
    await responseJson(await send(commentReactions(comment.id), 'POST', { reaction: '🎉' }, visitor), 201)
    assert.equal((await send(commentReactions(comment.id), 'POST', { reaction: '🎉' }, visitor)).status, 400)
    assert.equal((await responseJson(await get(commentReactions(comment.id)), 200)).length, 1)
    assert.equal(
      (await send(`${commentReactions(comment.id)}/${encodeURIComponent('🎉')}`, 'DELETE', undefined, other)).status,
      404
    )
    assert.equal(
      (await send(`${commentReactions(comment.id)}/${encodeURIComponent('🎉')}`, 'DELETE', undefined, visitor)).status,
      204
    )

    // Issue detail carries votes and reactions; the list supports pagination, grouping and filters (PD-1656).
    await send(votes, 'POST', { vote: 1 }, visitor)
    const detail = await responseJson(await get(`${board}/issues/${issue.id}`), 200)
    assert.equal(detail.id, issue.id)
    assert.equal(detail.voteItems.length, 1)
    assert.ok(!('descriptionBinary' in detail))
    const page = await responseJson(await get(`${board}/issues?per_page=10`), 200)
    assert.deepEqual(
      page.results.map(row => row.id),
      [issue.id]
    )
    assert.equal(page.results[0].voteItems[0].vote, 1)
    const grouped = await responseJson(await get(`${board}/issues?group_by=priority`), 200)
    assert.equal(grouped.grouped_by, 'priority')
    assert.equal((await get(`${board}/issues?group_by=priority&sub_group_by=priority`)).status, 400)
    assert.equal((await get(`${board}/issues?group_by=password`)).status, 400)
    assert.ok(Array.isArray(await responseJson(await get(`${board}/issues`), 200)))

    // Public multi-value groups use live links and active project members, including when nested.
    const label = db.prepare('INSERT INTO labels (name, project_id, workspace_id) VALUES (?, ?, ?) RETURNING id')
      .get('Board label', project.id, workspace.id)
    const removedLabel = db.prepare('INSERT INTO labels (name, project_id, workspace_id) VALUES (?, ?, ?) RETURNING id')
      .get('Removed link', project.id, workspace.id)
    const boardModule = db.prepare('INSERT INTO modules (name, project_id, workspace_id) VALUES (?, ?, ?) RETURNING id')
      .get('Board module', project.id, workspace.id)
    const removedModule = db.prepare('INSERT INTO modules (name, project_id, workspace_id) VALUES (?, ?, ?) RETURNING id')
      .get('Removed module link', project.id, workspace.id)
    const archivedModule = db.prepare('INSERT INTO modules (name, project_id, workspace_id, archived_at) VALUES (?, ?, ?, ?) RETURNING id')
      .get('Archived module', project.id, workspace.id, Date.now())
    const otherProject = db.prepare('INSERT INTO projects (name, identifier, workspace_id) VALUES (?, ?, ?) RETURNING id')
      .get('Other project', 'OTH', workspace.id)
    const otherLabel = db.prepare('INSERT INTO labels (name, project_id, workspace_id) VALUES (?, ?, ?) RETURNING id')
      .get('Other project label', otherProject.id, workspace.id)
    db.prepare('INSERT INTO project_members (member_id, project_id, workspace_id, is_active) VALUES (?, ?, ?, 0)')
      .run(other.id, project.id, workspace.id)
    const linkLabel = db.prepare('INSERT INTO issue_labels (issue_id, label_id, project_id, workspace_id, deleted_at) VALUES (?, ?, ?, ?, ?)')
    linkLabel.run(issue.id, label.id, project.id, workspace.id, null)
    linkLabel.run(issue.id, removedLabel.id, project.id, workspace.id, Date.now())
    linkLabel.run(issue.id, otherLabel.id, project.id, workspace.id, null)
    const linkAssignee = db.prepare('INSERT INTO issue_assignees (issue_id, assignee_id, project_id, workspace_id, deleted_at) VALUES (?, ?, ?, ?, ?)')
    linkAssignee.run(issue.id, owner.id, project.id, workspace.id, null)
    linkAssignee.run(issue.id, other.id, project.id, workspace.id, null)
    linkAssignee.run(issue.id, visitor.id, project.id, workspace.id, Date.now())
    const linkModule = db.prepare('INSERT INTO module_issues (issue_id, module_id, project_id, workspace_id, deleted_at) VALUES (?, ?, ?, ?, ?)')
    linkModule.run(issue.id, boardModule.id, project.id, workspace.id, null)
    linkModule.run(issue.id, removedModule.id, project.id, workspace.id, Date.now())
    linkModule.run(issue.id, archivedModule.id, project.id, workspace.id, null)
    const byLabel = await responseJson(await get(`${board}/issues?group_by=labels__id`), 200)
    const publicRow = byLabel.results[label.id].results[0]
    assert.equal(publicRow.id, issue.id)
    assert.deepEqual(publicRow.labelIds, [label.id])
    assert.deepEqual(publicRow.assigneeIds, [owner.id])
    assert.deepEqual(publicRow.moduleIds, [boardModule.id])
    assert.equal(publicRow.voteItems[0].vote, 1)
    assert.equal(byLabel.results[removedLabel.id].total_results, 0)
    assert.equal(byLabel.results[otherLabel.id], undefined)
    const byAssignee = await responseJson(await get(`${board}/issues?group_by=assignees__id`), 200)
    assert.equal(byAssignee.results[owner.id].results[0].id, issue.id)
    assert.equal(byAssignee.results[other.id], undefined)
    const byModule = await responseJson(await get(`${board}/issues?group_by=issue_module__module_id`), 200)
    assert.equal(byModule.results[boardModule.id].results[0].id, issue.id)
    assert.equal(byModule.results[removedModule.id].total_results, 0)
    assert.equal(byModule.results[archivedModule.id], undefined)
    const nested = await responseJson(await get(`${board}/issues?group_by=labels__id&sub_group_by=issue_module__module_id`), 200)
    assert.equal(nested.results[label.id].results[boardModule.id].results[0].id, issue.id)
    assert.equal(nested.results[label.id].results[removedModule.id], undefined)
    assert.equal(nested.results[label.id].results[archivedModule.id], undefined)
    assert.equal(nested.results[otherLabel.id], undefined)
    const scopedDetail = await responseJson(await get(`${board}/issues/${issue.id}`), 200)
    assert.deepEqual(scopedDetail.labelIds, [label.id])
    assert.deepEqual(scopedDetail.moduleIds, [boardModule.id])

    // Intake: needs a session and a board intake, lists only the caller's own submissions.
    const intake = db
      .prepare('INSERT INTO intakes (name, project_id, workspace_id, is_default) VALUES (?, ?, ?, 0) RETURNING id')
      .get('Public intake', project.id, workspace.id)
    const inbox = `${board}/intakes/${intake.id}/inbox-issues`
    assert.equal((await get(inbox)).status, 401)
    assert.equal((await send(inbox, 'POST', { issue: { name: 'Idea' } }, visitor)).status, 400)
    assert.equal((await send(`${projectPath}/publication`, 'PATCH', { intake: intake.id + 999 }, owner)).status, 400)
    await responseJson(await send(`${projectPath}/publication`, 'PATCH', { intake: intake.id }, owner), 200)
    assert.equal(
      (await send(`${board}/intakes/${intake.id + 1}/inbox-issues`, 'POST', { issue: { name: 'x' } }, visitor)).status,
      400
    )
    assert.equal((await send(inbox, 'POST', { issue: { name: '' } }, visitor)).status, 400)
    assert.equal((await send(inbox, 'POST', { issue: { name: 'Idea', priority: 'huge' } }, visitor)).status, 400)
    const filed = await responseJson(
      await send(inbox, 'POST', { issue: { name: 'Idea', description_html: '<p>x</p><script>1</script>' } }, visitor),
      200
    )
    assert.equal(filed.issueIntake[0].status, -2)
    assert.equal(filed.priority, 'low')
    const row = db.prepare('SELECT description_html, created_by_id FROM issues WHERE id = ?').get(filed.id)
    assert.ok(!row.description_html.includes('<script'))
    assert.equal(row.created_by_id, visitor.id)
    const own = await responseJson(await get(inbox, visitor), 200)
    assert.deepEqual(
      own.map(item => item.id),
      [filed.id]
    )
    assert.deepEqual(await responseJson(await get(inbox, other), 200), [])
    const item = `${board}/intakes/${intake.id}/intake-issues/${filed.bridgeId}`
    assert.equal((await get(item, other)).status, 404)
    assert.equal((await send(item, 'PATCH', { issue: { name: 'Hijack' } }, other)).status, 404)
    assert.equal(
      (await responseJson(await send(item, 'PATCH', { issue: { name: 'Better idea' } }, visitor), 200)).name,
      'Better idea'
    )
    // The public board never shows triage work items.
    assert.equal((await get(`${board}/issues/${filed.id}`)).status, 404)
    db.prepare('UPDATE intake_issues SET status = 1 WHERE id = ?').run(filed.bridgeId)
    assert.equal((await send(item, 'PATCH', { issue: { name: 'Late' } }, visitor)).status, 409)
    assert.equal((await send(item, 'DELETE', undefined, visitor)).status, 409)
    db.prepare('UPDATE intake_issues SET status = -2 WHERE id = ?').run(filed.bridgeId)
    assert.equal((await send(item, 'DELETE', undefined, visitor)).status, 204)
    assert.deepEqual(await responseJson(await get(inbox, visitor), 200), [])

    // Assets: comment images only, own assets only, bytes go through the Worker.
    const assets = `/api/v1/public/assets/v2/anchor/${anchor}`
    const assetBody = { name: 'a.png', type: 'image/png', size: PNG.length, entity_type: 'COMMENT_DESCRIPTION' }
    assert.equal((await send(assets, 'POST', assetBody)).status, 401)
    assert.equal((await send(assets, 'POST', { ...assetBody, entity_type: 'ISSUE_DESCRIPTION' }, visitor)).status, 400)
    assert.equal((await send(assets, 'POST', { ...assetBody, type: 'text/html' }, visitor)).status, 400)
    assert.equal((await send(assets, 'POST', { ...assetBody, entity_identifier: comment.id }, other)).status, 404)
    const created = await responseJson(await send(assets, 'POST', assetBody, visitor), 200)
    assert.equal(created.upload_data.method, 'PUT')
    assert.equal((await get(`${assets}/${created.asset_id}`)).status, 404)
    const put = (user, bytes = PNG) =>
      request(created.upload_data.url, {
        ...user,
        method: 'PUT',
        body: bytes,
        headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) }
      })
    assert.equal((await put(other)).status, 404)
    assert.equal((await put(visitor, new Uint8Array([1, 2, 3]))).status, 400)
    await responseJson(await put(visitor), 200)
    assert.equal((await send(`${assets}/${created.asset_id}`, 'PATCH', {}, other)).status, 404)
    assert.equal((await send(`${assets}/${created.asset_id}`, 'PATCH', {}, visitor)).status, 204)
    assert.equal(
      (await send(`${assets}/${comment.id}/bulk`, 'POST', { asset_ids: [created.asset_id] }, other)).status,
      404
    )
    assert.equal(
      (await send(`${assets}/${comment.id}/bulk`, 'POST', { asset_ids: [created.asset_id] }, visitor)).status,
      204
    )
    assert.equal(
      db.prepare('SELECT comment_id FROM file_assets WHERE id = ?').get(created.asset_id).comment_id,
      comment.id
    )
    const shown = await get(`${assets}/${created.asset_id}`)
    assert.equal(shown.status, 200)
    assert.equal(shown.headers.get('content-type'), 'image/png')
    assert.equal((await send(`${assets}/${created.asset_id}`, 'DELETE', undefined, other)).status, 404)
    assert.equal((await send(`${assets}/${created.asset_id}`, 'DELETE', undefined, visitor)).status, 204)
    assert.equal((await get(`${assets}/${created.asset_id}`)).status, 404)
    assert.equal((await send(`${assets}/restore/${created.asset_id}`, 'POST', undefined, visitor)).status, 204)
    assert.equal((await get(`${assets}/${created.asset_id}`)).status, 200)

    // Unpublishing closes every public route at once.
    assert.equal((await send(`${projectPath}/publication`, 'DELETE', undefined, owner)).status, 204)
    for (const path of [`${board}/settings`, reactions, votes, inbox, `${assets}/${created.asset_id}`])
      assert.equal((await get(path, visitor)).status, 404)
  } finally {
    db.close()
  }
})

test('public board: anonymous requests are throttled per IP and cannot write', async () => {
  const ip = `198.18.231.${Math.floor(Math.random() * 200) + 1}`
  const statuses = []
  for (let i = 0; i < 140; i++) statuses.push((await request('/api/v1/public/anchor/missing/settings', { ip })).status)
  assert.ok(statuses.includes(404), 'unknown board answers 404')
  assert.ok(statuses.includes(429), 'the anon throttle answers 429 after the limit (default 120/minute)')
})
