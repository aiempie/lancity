import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'vitest'

// Requires pagesRoutes (src/server/api/v1/routes/pages.ts) mounted under /api/v1/workspaces and the page job module loaded.
const base = new URL(process.env.LANCITY_TEST_URL ?? 'http://localhost:4198')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use an isolated local Worker')
assert.ok(process.env.LANCITY_TEST_D1, 'Set LANCITY_TEST_D1 to the isolated Worker database file')
const runId = randomUUID().replaceAll('-', '').slice(0, 12)

function request(path, { cookie, method = 'GET', body, ip, headers: extra } = {}) {
  const headers = new Headers(extra)
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
// page.transaction / page.version run through a Queue (maxBatchTimeout 5s); poll instead of asserting immediately.
async function eventually(check, { timeoutMs = 15_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      return await check()
    } catch (error) {
      if (Date.now() >= deadline) throw error
      await new Promise(resolve => setTimeout(resolve, intervalMs))
    }
  }
}
async function responseJson(response, status) {
  assert.equal(response.status, status, `${response.url}: ${await response.clone().text()}`)
  return response.json()
}
async function signUp(suffix, ip) {
  const username = `page${runId}${suffix}`
  const response = await request('/api/auth/sign-up/email', {
    method: 'POST',
    ip,
    body: { name: `Page ${suffix}`, username, email: `${username}@example.com`, password: 'isolated-test-password' }
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

test('pages: CRUD, sanitizing, access, lock, favorites, duplicate, binary description, versions, archive and delete', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('owner', '198.18.220.1')
    const member = await signUp('member', '198.18.220.2')
    const outsider = await signUp('outsider', '198.18.220.3')
    const slug = `pages-${runId}`
    const workspace = await responseJson(
      await request('/api/v1/workspaces', { ...owner, method: 'POST', body: { name: 'Pages', slug } }),
      201
    )
    const project = await responseJson(
      await request(`/api/v1/workspaces/${slug}/projects`, {
        ...owner,
        method: 'POST',
        body: { name: 'Pages', identifier: 'PGS' }
      }),
      201
    )
    db.prepare('INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (?, ?, 15)').run(
      workspace.id,
      member.id
    )
    db.prepare('INSERT INTO project_members (workspace_id, project_id, member_id, role) VALUES (?, ?, ?, 15)').run(
      workspace.id,
      project.id,
      member.id
    )
    const path = `/api/v1/workspaces/${slug}/projects/${project.id}`
    const send = (url, method, body, user = owner) => request(`${path}${url}`, { ...user, method, body })

    // Create with HTML: sanitized, stripped text derived, page log synced by the job, outsider locked out.
    const html =
      '<p onclick="x()">Hello <mention-component id="m1" entity_name="issue" entity_identifier="42"></mention-component></p><script>alert(1)</script>'
    const page = await responseJson(
      await send('/pages', 'POST', { name: 'Spec', description_html: html, view_props: { full_width: true } }),
      201
    )
    assert.ok(!page.descriptionHtml.includes('script') && !page.descriptionHtml.includes('onclick'))
    assert.equal(page.descriptionText, 'Hello ')
    assert.deepEqual(page.projectIds, [project.id])
    assert.equal((await send('/pages', 'GET', undefined, outsider)).status, 404)
    assert.equal((await send('/pages', 'POST', { description_html: '<p>a</p>', descriptionText: 'a' })).status, 400)
    assert.equal((await send('/pages', 'POST', { name: 'Bad', parent: 999999 })).status, 400)
    await eventually(() =>
      assert.equal(db.prepare('SELECT count(*) AS n FROM page_logs WHERE page_id = ?').get(page.id).n, 1)
    )
    const detail = await responseJson(await send(`/pages/${page.id}?track_visit=false`, 'GET'), 200)
    assert.deepEqual(detail.issueIds, [42])

    // Sub-page: parent must live in the project and cannot form a cycle.
    const child = await responseJson(await send('/pages', 'POST', { name: 'Child', parent: page.id }), 201)
    assert.equal(child.parentId, page.id)
    assert.equal((await send(`/pages/${page.id}`, 'PATCH', { parent: child.id })).status, 400)
    const list = await responseJson(await send('/pages', 'GET'), 200)
    assert.ok(list.some(item => item.id === page.id) && !list.some(item => item.id === child.id))

    // Access: only the owner changes visibility; summary counts visible pages.
    assert.equal((await send(`/pages/${page.id}/access`, 'POST', { access: 1 }, member)).status, 400)
    assert.equal((await send(`/pages/${page.id}/access`, 'POST', { access: 1 })).status, 204)
    assert.equal((await send(`/pages/${page.id}`, 'GET', undefined, member)).status, 404)
    assert.equal((await send(`/pages/${page.id}/access`, 'POST', { access: 0 })).status, 204)
    const summary = await responseJson(await send('/pages-summary', 'GET'), 200)
    assert.deepEqual(summary, { publicPages: 1, privatePages: 0, archivedPages: 0 })

    // Favorites float to the top; a second favorite call is idempotent.
    assert.equal((await send(`/favorite-pages/${page.id}`, 'POST', undefined, member)).status, 204)
    assert.equal((await send(`/favorite-pages/${page.id}`, 'POST', undefined, member)).status, 204)
    const memberList = await responseJson(await send('/pages', 'GET', undefined, member), 200)
    assert.equal(memberList[0].id, page.id)
    assert.equal(memberList[0].isFavorite, true)
    assert.equal((await send(`/favorite-pages/${page.id}`, 'DELETE', undefined, member)).status, 204)
    assert.equal((await send(`/favorite-pages/${page.id}`, 'DELETE', undefined, member)).status, 404)

    // Binary description: validated, stored, streamed back; version job keeps a snapshot.
    const state = Buffer.from([1, 2, 3, 4, 5, 6])
    assert.equal(
      (
        await send(`/pages/${page.id}/description`, 'PATCH', {
          description_binary: Buffer.from('<script>1').toString('base64')
        })
      ).status,
      400
    )
    const saved = await responseJson(
      await send(`/pages/${page.id}/description`, 'PATCH', {
        description_binary: state.toString('base64'),
        description_html: '<p>Version two</p>',
        description_json: { type: 'doc' }
      }),
      200
    )
    assert.equal(saved.message, 'Updated successfully')
    const binary = await send(`/pages/${page.id}/description?format=binary`, 'GET')
    assert.equal(binary.status, 200)
    assert.equal(binary.headers.get('content-type'), 'application/octet-stream')
    assert.deepEqual([...new Uint8Array(await binary.arrayBuffer())], [...state])
    const stored = db
      .prepare('SELECT description_binary AS b, description_stripped AS s FROM pages WHERE id = ?')
      .get(page.id)
    assert.deepEqual([...stored.b], [...state])
    assert.equal(stored.s, 'Version two')
    const versions = await eventually(async () => {
      const found = await responseJson(await send(`/pages/${page.id}/versions`, 'GET'), 200)
      assert.ok(found.length >= 1)
      return found
    })
    const version = await responseJson(await send(`/pages/${page.id}/versions/${versions[0].id}`, 'GET'), 200)
    assert.equal(typeof version.descriptionHtml, 'string')
    assert.equal((await send(`/pages/${child.id}/versions/${versions[0].id}`, 'GET')).status, 404)

    // Lock blocks description writes; only the owner or an admin unlocks.
    assert.equal((await send(`/pages/${page.id}/lock`, 'POST', undefined, member)).status, 204)
    const locked = await send(`/pages/${page.id}/description`, 'PATCH', { description_html: '<p>x</p>' })
    assert.equal(locked.status, 400)
    assert.equal((await send(`/pages/${page.id}/lock`, 'DELETE', undefined, member)).status, 403)
    assert.equal((await send(`/pages/${page.id}/lock`, 'DELETE')).status, 204)

    // Duplicate: new owner, "(Copy)" name, no binary state, linked to the project.
    const copy = await responseJson(await send(`/pages/${page.id}/duplicate`, 'POST', undefined, member), 201)
    assert.equal(copy.name, 'Spec (Copy)')
    assert.equal(copy.ownedById, member.id)
    assert.equal(db.prepare('SELECT description_binary AS b FROM pages WHERE id = ?').get(copy.id).b, null)
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM project_pages WHERE page_id = ? AND deleted_at IS NULL').get(copy.id).n,
      1
    )

    // Delete needs an archived page; children lose their parent; favorites go away.
    assert.equal((await send(`/pages/${page.id}`, 'DELETE')).status, 400)
    assert.equal((await send(`/pages/${page.id}/archive`, 'POST')).status, 200)
    assert.equal(db.prepare('SELECT count(*) AS n FROM pages WHERE archived_at IS NOT NULL').get().n >= 2, true)
    assert.equal((await send(`/pages/${page.id}`, 'DELETE', undefined, member)).status, 403)
    assert.equal((await send(`/pages/${page.id}`, 'DELETE')).status, 204)
    assert.equal(db.prepare('SELECT parent_id FROM pages WHERE id = ?').get(child.id).parent_id, null)
    assert.equal((await send(`/pages/${page.id}`, 'GET')).status, 404)
  } finally {
    db.close()
  }
})
