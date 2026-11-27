import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'vitest'

// Requires issueCollabRoutes (src/server/api/v1/routes/issue-collab.ts) mounted before issuesRoutes.
const base = new URL(process.env.LANCITY_TEST_URL ?? 'http://localhost:4198')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use an isolated local Worker')
assert.ok(process.env.LANCITY_TEST_D1, 'Set LANCITY_TEST_D1 to the isolated Worker database file')
const runId = randomUUID().replaceAll('-', '').slice(0, 12)

function request(path, { cookie, method = 'GET', body, ip, headers: extra } = {}) {
  const headers = new Headers(extra)
  if (cookie) headers.set('cookie', cookie)
  if (ip) headers.set('cf-connecting-ip', ip)
  if (method !== 'GET') headers.set('origin', base.origin)
  const isRaw = body instanceof Uint8Array
  if (body !== undefined && !isRaw) headers.set('content-type', 'application/json')
  return fetch(new URL(path, base), {
    method,
    headers,
    body: body === undefined ? undefined : isRaw ? body : JSON.stringify(body),
    redirect: 'manual'
  })
}
async function responseJson(response, status) {
  assert.equal(response.status, status, `${response.url}: ${await response.clone().text()}`)
  return response.json()
}
async function signUp(suffix, ip) {
  const username = `collab${runId}${suffix}`
  const response = await request('/api/auth/sign-up/email', {
    method: 'POST',
    ip,
    body: { name: `Collab ${suffix}`, username, email: `${username}@example.com`, password: 'isolated-test-password' }
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

test('issue collaboration: comments, reactions, votes, relations, attachments and history', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('owner', '198.18.210.1')
    const guest = await signUp('guest', '198.18.210.2')
    const outsider = await signUp('outsider', '198.18.210.3')
    const slug = `collab-${runId}`
    const workspace = await responseJson(
      await request('/api/v1/workspaces', { ...owner, method: 'POST', body: { name: 'Collab', slug } }),
      201
    )
    const project = await responseJson(
      await request(`/api/v1/workspaces/${slug}/projects`, {
        ...owner,
        method: 'POST',
        body: { name: 'Collab', identifier: 'COL' }
      }),
      201
    )
    const path = `/api/v1/workspaces/${slug}/projects/${project.id}`
    const send = (url, method, body, user = owner) => request(`${path}${url}`, { ...user, method, body })
    const issue = await responseJson(await send('/issues', 'POST', { name: 'Collaboration' }), 201)
    const other = await responseJson(await send('/issues', 'POST', { name: 'Second' }), 201)
    const issuePath = `/issues/${issue.id}`

    // Comments: sanitised HTML, derived plain text, description row, activity and mention subscription.
    const html = `<p>Hello <mention-component entity_name="user_mention" entity_identifier="${guest.id}"></mention-component></p><script>alert(1)</script><img src="javascript:alert(1)" onerror="x()">`
    db.prepare('INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (?, ?, 5)').run(
      workspace.id,
      guest.id
    )
    db.prepare('INSERT INTO project_members (workspace_id, project_id, member_id, role) VALUES (?, ?, ?, 5)').run(
      workspace.id,
      project.id,
      guest.id
    )
    db.prepare('UPDATE projects SET guest_view_all_features = 0 WHERE id = ?').run(project.id)
    assert.equal((await send(`${issuePath}/comments`, 'POST', { comment_html: html }, outsider)).status, 404)
    const comment = await responseJson(
      await send(`${issuePath}/comments`, 'POST', { comment_html: html, comment_json: { type: 'doc' } }),
      201
    )
    assert.ok(!comment.commentHtml.includes('script') && !comment.commentHtml.includes('onerror'))
    assert.ok(!comment.commentHtml.includes('javascript:'))
    assert.equal(comment.commentStripped, 'Hello ')
    assert.ok(comment.descriptionId)
    assert.equal(
      db.prepare('SELECT description_html FROM descriptions WHERE id = ?').get(comment.descriptionId).description_html,
      comment.commentHtml
    )
    assert.equal(
      db
        .prepare(
          'SELECT count(*) AS n FROM issue_subscribers WHERE issue_id = ? AND subscriber_id IN (?, ?) AND deleted_at IS NULL'
        )
        .get(issue.id, owner.id, guest.id).n,
      2
    )
    assert.equal((await send(`${issuePath}/comments`, 'POST', { text: 'x', comment_html: '<p>x</p>' })).status, 400)
    await responseJson(
      await send(`${issuePath}/comments`, 'POST', { text: 'a & b', external_id: 'e1', external_source: 's' }),
      201
    )
    assert.equal(
      (await send(`${issuePath}/comments`, 'POST', { text: 'dup', external_id: 'e1', external_source: 's' })).status,
      409
    )

    // Only the author or an admin edits; a restricted guest cannot see the issue at all.
    assert.equal((await send(`${issuePath}/comments`, 'GET', undefined, guest)).status, 403)
    const edited = await responseJson(
      await send(`${issuePath}/comments/${comment.id}`, 'PATCH', { comment_html: '<p>Edited</p>' }),
      200
    )
    assert.ok(edited.editedAt)
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS n FROM issue_activities WHERE issue_comment_id = ? AND verb = 'updated' AND field = 'comment'"
        )
        .get(comment.id).n,
      1
    )
    const accessOnly = await responseJson(
      await send(`${issuePath}/comments/${comment.id}`, 'PATCH', { access: 'EXTERNAL' }),
      200
    )
    assert.equal(accessOnly.access, 'EXTERNAL')
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM issue_activities WHERE issue_comment_id = ? AND verb = 'updated'")
        .get(comment.id).n,
      1
    )

    // Comment reactions
    const reactionPath = `/comments/${comment.id}/reactions`
    await responseJson(await send(reactionPath, 'POST', { reaction: '128077' }), 201)
    assert.equal((await send(reactionPath, 'POST', { reaction: '128077' })).status, 400)
    assert.equal((await responseJson(await send(reactionPath, 'GET'), 200)).length, 1)
    const listed = await responseJson(await send(`${issuePath}/comments/${comment.id}`, 'GET'), 200)
    assert.equal(listed.commentReactions.length, 1)
    assert.equal((await send(`${reactionPath}/128077`, 'DELETE')).status, 204)
    assert.equal((await send(`${reactionPath}/128077`, 'DELETE')).status, 404)

    // Issue reactions
    await responseJson(await send(`${issuePath}/reactions`, 'POST', { reaction: '128077' }), 201)
    assert.equal((await send(`${issuePath}/reactions`, 'POST', { reaction: '128077' })).status, 400)
    assert.equal((await responseJson(await send(`${issuePath}/reactions`, 'GET'), 200)).length, 1)
    assert.equal((await send(`${issuePath}/reactions/128077`, 'DELETE')).status, 204)

    // Votes
    assert.deepEqual(await responseJson(await send(`${issuePath}/votes`, 'POST', { vote: 1 }), 201), {
      up: 1,
      down: 0,
      vote: 1
    })
    assert.deepEqual(await responseJson(await send(`${issuePath}/votes`, 'POST', { vote: -1 }), 201), {
      up: 0,
      down: 1,
      vote: -1
    })
    assert.equal((await send(`${issuePath}/votes`, 'POST', { vote: 2 })).status, 400)
    assert.equal((await responseJson(await send(`${issuePath}/votes`, 'DELETE'), 200)).vote, null)

    // Relations, including `implements`
    const relations = await responseJson(
      await send(`${issuePath}/relations`, 'POST', { relation_type: 'implements', issues: [other.id] }),
      201
    )
    assert.equal(relations.length, 1)
    assert.equal(
      (await responseJson(await send(`${issuePath}/relations`, 'GET'), 200)).implements.map(item => item.id).join(),
      String(other.id)
    )
    assert.equal((await responseJson(await send(`/issues/${other.id}/relations`, 'GET'), 200)).implemented_by.length, 1)

    // Attachments: create, upload, confirm, download, delete
    const bytes = new TextEncoder().encode('attachment body')
    const created = await responseJson(
      await send(`${issuePath}/attachments`, 'POST', { name: '../report.txt', type: 'text/plain', size: bytes.length }),
      201
    )
    assert.equal(created.attachment.attributes.name, 'report.txt')
    assert.equal(
      (await send(`${issuePath}/attachments`, 'POST', { name: 'x.exe', type: 'application/x-msdownload', size: 1 }))
        .status,
      400
    )
    assert.equal((await responseJson(await send(`${issuePath}/attachments`, 'GET'), 200)).length, 0)
    assert.equal((await send(`${issuePath}/attachments/${created.assetId}`, 'PATCH', {})).status, 400)
    const put = await request(new URL(created.uploadUrl, base).pathname, {
      ...owner,
      method: 'PUT',
      body: bytes,
      headers: { 'content-type': 'text/plain' }
    })
    assert.equal(put.status, 200, await put.clone().text())
    assert.equal(
      (await send(`${issuePath}/attachments/${created.assetId}`, 'PATCH', { is_uploaded: true })).status,
      204
    )
    assert.equal((await responseJson(await send(`${issuePath}/attachments`, 'GET'), 200)).length, 1)
    const download = await send(`${issuePath}/attachments/${created.assetId}`, 'GET')
    assert.equal(download.status, 200)
    assert.equal(await download.text(), 'attachment body')
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM issue_activities WHERE field = 'attachment' AND issue_id = ?").get(issue.id)
        .n,
      1
    )
    assert.equal((await send(`${issuePath}/attachments/${created.assetId}`, 'DELETE', undefined, outsider)).status, 404)
    assert.equal((await send(`${issuePath}/attachments/${created.assetId}`, 'DELETE')).status, 204)
    assert.equal((await responseJson(await send(`${issuePath}/attachments`, 'GET'), 200)).length, 0)

    // History feed, paginated activities and versions
    const history = await responseJson(await send(`${issuePath}/history`, 'GET'), 200)
    assert.ok(history.some(item => item.commentHtml !== undefined))
    assert.ok(history.every(item => !['vote', 'reaction'].includes(item.field)))
    assert.ok(
      (await responseJson(await send(`${issuePath}/history?activity_type=issue-comment`, 'GET'), 200)).length >= 2
    )
    const page = await responseJson(await send(`${issuePath}/activities/page?per_page=2`, 'GET'), 200)
    assert.equal(page.results.length, 2)
    assert.equal(page.next_page_results, true)
    const next = await responseJson(
      await send(`${issuePath}/activities/page?per_page=2&cursor=${page.next_cursor}`, 'GET'),
      200
    )
    assert.ok(next.results.every(item => item.id < Number(page.next_cursor)))
    const versions = await responseJson(await send(`${issuePath}/versions/page`, 'GET'), 200)
    assert.ok(Array.isArray(versions.results))
    assert.equal((await send(`${issuePath}/versions/999999`, 'GET')).status, 404)
    // Creating an issue enqueues issue.description_version, so a version appears once the queue batch runs (poll, up to 15 s).
    let descriptionVersions = 0
    for (let attempt = 0; attempt < 30 && descriptionVersions === 0; attempt += 1) {
      descriptionVersions = (await responseJson(await send(`${issuePath}/description-versions`, 'GET'), 200)).results.length
      if (descriptionVersions === 0) await new Promise(resolve => setTimeout(resolve, 500))
    }
    assert.equal(descriptionVersions, 1)

    // Soft delete cascades to reactions and the description row
    assert.equal((await send(`${issuePath}/comments/${comment.id}`, 'DELETE', undefined, guest)).status, 403)
    assert.equal((await send(`${issuePath}/comments/${comment.id}`, 'DELETE')).status, 204)
    assert.ok(db.prepare('SELECT deleted_at FROM descriptions WHERE id = ?').get(comment.descriptionId).deleted_at)
    assert.equal((await send(`${issuePath}/comments/${comment.id}`, 'GET')).status, 404)
  } finally {
    db.close()
  }
})
