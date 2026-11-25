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

test('workspace preferences, links and favorites remain scoped to actor and project', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('owner', '198.18.222.1')
    const other = await signUp('other', '198.18.222.2')
    const slug = `prefs-${run}`
    const foreignSlug = `foreign-${run}`
    const workspace = await json(
      await request('/api/v1/workspaces', { ...owner, method: 'POST', body: { name: 'Preferences', slug } }),
      201
    )
    await json(
      await request('/api/v1/workspaces', { ...other, method: 'POST', body: { name: 'Other', slug: foreignSlug } }),
      201
    )
    const project = await json(
      await request(`/api/v1/workspaces/${slug}/projects`, {
        ...owner,
        method: 'POST',
        body: { name: 'Project', identifier: 'PREF' }
      }),
      201
    )
    const foreignProject = await json(
      await request(`/api/v1/workspaces/${foreignSlug}/projects`, {
        ...other,
        method: 'POST',
        body: { name: 'Other project', identifier: 'FOREIGN' }
      }),
      201
    )
    db.prepare('INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (?, ?, 15)').run(
      workspace.id,
      other.id
    )
    const path = `/api/v1/workspaces/${slug}`
    const defaults = await json(await request(`${path}/sidebar-preferences`, owner), 200)
    assert.equal(Object.keys(defaults).length, 7)
    assert.equal(defaults.drafts.is_pinned, true)
    assert.equal(
      (
        await request(`${path}/sidebar-preferences`, {
          ...owner,
          method: 'PATCH',
          body: [{ key: 'drafts', is_pinned: false, sort_order: 1 }]
        })
      ).status,
      200
    )
    assert.equal((await json(await request(`${path}/sidebar-preferences`, owner), 200)).drafts.is_pinned, false)
    assert.equal((await json(await request(`${path}/sidebar-preferences`, other), 200)).drafts.is_pinned, true)
    assert.equal(
      (await request(`${path}/quick-links`, { ...owner, method: 'POST', body: { url: 'javascript:alert(1)' } })).status,
      400
    )
    assert.equal(
      (
        await request(`${path}/quick-links`, {
          ...owner,
          method: 'POST',
          body: { url: 'https://example.com', project_id: foreignProject.id }
        })
      ).status,
      404
    )
    const link = await json(
      await request(`${path}/quick-links`, {
        ...owner,
        method: 'POST',
        body: { url: 'https://example.com', project_id: project.id }
      }),
      201
    )
    assert.equal((await request(`${path}/quick-links/${link.id}`, other)).status, 404)
    assert.equal((await request(`${path}/quick-links/${link.id}`, { ...other, method: 'DELETE' })).status, 404)
    const folder = await json(
      await request(`${path}/user-favorites`, {
        ...owner,
        method: 'POST',
        body: { entity_type: 'folder', name: 'Folder' }
      }),
      200
    )
    const favorite = await json(
      await request(`${path}/user-favorites`, {
        ...owner,
        method: 'POST',
        body: { entity_type: 'project', entity_identifier: project.id, parent: folder.id }
      }),
      200
    )
    assert.equal(
      (await json(await request(`${path}/user-favorites/${folder.id}/group`, owner), 200))[0].id,
      favorite.id
    )
    assert.equal(
      (
        await request(`${path}/user-favorites`, {
          ...owner,
          method: 'POST',
          body: { entity_type: 'project', entity_identifier: foreignProject.id }
        })
      ).status,
      404
    )
    assert.equal((await request(`${path}/user-favorites/${favorite.id}`, { ...other, method: 'DELETE' })).status, 404)
    assert.equal((await request(`${path}/user-favorites/${favorite.id}`, { ...owner, method: 'DELETE' })).status, 204)
    assert.equal((await request(`${path}/quick-links/${link.id}`, { ...owner, method: 'DELETE' })).status, 204)
  } finally {
    db.close()
  }
})
