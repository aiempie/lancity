import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'vitest'

// Requires assetsRoutes (mounted at /workspaces) and userAssetsRoutes (mounted at /assets) from
// src/server/api/v1/routes/assets.ts, and the R2 binding ASSET_BUCKET (local simulation).
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
  const raw = body instanceof Uint8Array || body instanceof FormData
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
  const username = `asset${runId}${suffix}`
  const response = await request('/api/auth/sign-up/email', {
    method: 'POST',
    ip,
    body: { name: `Asset ${suffix}`, username, email: `${username}@example.com`, password: 'isolated-test-password' }
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

test('assets: logo, avatar, project assets, bulk binding, duplicate, restore and legacy upload', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('owner', '198.18.220.1')
    const member = await signUp('member', '198.18.220.2')
    const outsider = await signUp('outsider', '198.18.220.3')
    const slug = `asset-${runId}`
    const workspace = await responseJson(
      await request('/api/v1/workspaces', { ...owner, method: 'POST', body: { name: 'Assets', slug } }),
      201
    )
    const project = await responseJson(
      await request(`/api/v1/workspaces/${slug}/projects`, {
        ...owner,
        method: 'POST',
        body: { name: 'Assets', identifier: 'AST' }
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
    const ws = `/api/v1/workspaces/${slug}`
    const send = (path, method, body, user = owner, headers) => request(path, { ...user, method, body, headers })
    const upload = (url, user, type = 'image/png', bytes = PNG) =>
      send(url, 'PUT', bytes, user, { 'content-type': type, 'content-length': String(bytes.length) })

    // Workspace logo: only an admin registers it, the bytes go through the Worker, PATCH binds it.
    const logoBody = { name: 'logo.png', type: 'image/png', size: PNG.length, entity_type: 'WORKSPACE_LOGO' }
    assert.equal((await send(`${ws}/assets`, 'POST', logoBody, member)).status, 403)
    assert.equal((await send(`${ws}/assets`, 'POST', logoBody, outsider)).status, 403)
    assert.equal((await send(`${ws}/assets`, 'POST', { ...logoBody, entity_type: 'NOPE' })).status, 400)
    assert.equal((await send(`${ws}/assets`, 'POST', { ...logoBody, type: 'text/html' })).status, 400)
    const logo = await responseJson(await send(`${ws}/assets`, 'POST', logoBody), 200)
    assert.equal(logo.upload_data.method, 'PUT')
    assert.equal(logo.asset_url, `/api/v1/assets/static/${logo.asset_id}`)
    // The object is not stored yet, so confirming fails and the logo is not bound.
    assert.equal((await send(`${ws}/assets/${logo.asset_id}`, 'PATCH', {})).status, 400)
    assert.equal((await upload(logo.upload_data.url, owner, 'image/jpeg')).status, 400)
    assert.equal((await upload(logo.upload_data.url, owner, 'image/png', new Uint8Array([1, 2, 3]))).status, 400)
    assert.equal((await upload(logo.upload_data.url, member)).status, 403)
    await responseJson(await upload(logo.upload_data.url, owner), 200)
    assert.equal((await send(`${ws}/assets/${logo.asset_id}`, 'PATCH', {}, member)).status, 403)
    assert.equal((await send(`${ws}/assets/${logo.asset_id}`, 'PATCH', {})).status, 204)
    assert.equal(
      db.prepare('SELECT logo_asset_id AS id FROM workspaces WHERE id = ?').get(workspace.id).id,
      logo.asset_id
    )
    assert.equal((await upload(logo.upload_data.url, owner)).status, 409)
    const shown = await request(logo.asset_url)
    assert.equal(shown.status, 200)
    assert.equal(shown.headers.get('content-type'), 'image/png')
    assert.equal(shown.headers.get('x-content-type-options'), 'nosniff')

    // A second logo replaces the first one, which is soft deleted.
    const logo2 = await responseJson(await send(`${ws}/assets`, 'POST', logoBody), 200)
    await responseJson(await upload(logo2.upload_data.url, owner), 200)
    assert.equal((await send(`${ws}/assets/${logo2.asset_id}`, 'PATCH', {})).status, 204)
    assert.equal(
      db.prepare('SELECT logo_asset_id AS id FROM workspaces WHERE id = ?').get(workspace.id).id,
      logo2.asset_id
    )
    assert.equal(
      db.prepare('SELECT is_deleted AS d, deleted_at IS NOT NULL AS t FROM file_assets WHERE id = ?').get(logo.asset_id)
        .d,
      1
    )
    assert.equal((await request(logo.asset_url)).status, 404)

    // Restore, check and delete (delete unbinds the logo when it is the current one).
    assert.equal((await send(`${ws}/assets/${logo.asset_id}/restore`, 'POST', undefined, member)).status, 403)
    assert.equal((await send(`${ws}/assets/${logo.asset_id}/restore`, 'POST')).status, 204)
    assert.equal((await responseJson(await send(`${ws}/assets/${logo.asset_id}/check`, 'GET'), 200)).exists, true)
    assert.equal((await responseJson(await send(`${ws}/assets/999999/check`, 'GET'), 200)).exists, false)
    assert.equal((await send(`${ws}/assets/${logo2.asset_id}`, 'DELETE')).status, 204)
    assert.equal(db.prepare('SELECT logo_asset_id AS id FROM workspaces WHERE id = ?').get(workspace.id).id, null)

    // User avatar: the profile points at the newest confirmed asset.
    const avatars = []
    for (let i = 0; i < 2; i++) {
      const created = await responseJson(
        await send(
          '/api/v1/assets/user-assets',
          'POST',
          { name: 'me.png', type: 'image/png', entity_type: 'USER_AVATAR' },
          member
        ),
        200
      )
      await responseJson(await upload(created.upload_data.url, member), 200)
      assert.equal((await send(`/api/v1/assets/user-assets/${created.asset_id}`, 'PATCH', {}, member)).status, 204)
      avatars.push(created.asset_id)
    }
    assert.equal(
      db.prepare('SELECT avatar_asset_id AS id FROM profiles WHERE user_id = ?').get(member.id).id,
      avatars[1]
    )
    assert.equal(db.prepare('SELECT is_deleted AS d FROM file_assets WHERE id = ?').get(avatars[0]).d, 1)
    assert.equal((await send(`/api/v1/assets/user-assets/${avatars[1]}`, 'PATCH', {}, owner)).status, 404)
    assert.equal(
      (await send('/api/v1/assets/user-assets', 'POST', { entity_type: 'WORKSPACE_LOGO' }, member)).status,
      400
    )
    assert.equal((await send(`/api/v1/assets/user-assets/${avatars[1]}`, 'DELETE', undefined, member)).status, 204)
    assert.equal(db.prepare('SELECT avatar_asset_id AS id FROM profiles WHERE user_id = ?').get(member.id).id, null)

    // Project assets and the bulk binding of a description image to the issue created afterwards.
    const issue = await responseJson(
      await send(`${ws}/projects/${project.id}/issues`, 'POST', { name: 'With image' }),
      201
    )
    const entity = `${ws}/projects/${project.id}/entity-assets`
    const body = { name: 'inline.png', type: 'image/png', size: PNG.length, entity_type: 'ISSUE_DESCRIPTION' }
    assert.equal((await send(entity, 'POST', body, outsider)).status, 403)
    assert.equal((await send(entity, 'POST', { ...body, entity_identifier: 999999 }, member)).status, 400)
    const inline = await responseJson(await send(entity, 'POST', body, member), 200)
    await responseJson(await upload(inline.upload_data.url, member), 200)
    assert.equal((await send(`${entity}/${inline.asset_id}`, 'PATCH', {}, member)).status, 204)
    assert.equal((await send(`${entity}/bulk/${issue.id}`, 'POST', { asset_ids: [] }, member)).status, 400)
    assert.equal(
      (await send(`${entity}/bulk/${issue.id}`, 'POST', { asset_ids: [inline.asset_id] }, owner)).status,
      404
    )
    assert.equal(
      (await send(`${entity}/bulk/${issue.id}`, 'POST', { asset_ids: [inline.asset_id] }, member)).status,
      204
    )
    assert.equal(db.prepare('SELECT issue_id AS id FROM file_assets WHERE id = ?').get(inline.asset_id).id, issue.id)
    const read = await send(`${entity}/${inline.asset_id}?disposition=inline`, 'GET', undefined, member)
    assert.equal(read.status, 200)
    assert.equal(read.headers.get('content-type'), 'image/png')
    const download = await send(`${entity}/${inline.asset_id}/download`, 'GET', undefined, member)
    assert.equal(download.headers.get('content-type'), 'application/octet-stream')
    assert.match(download.headers.get('content-disposition'), /^attachment;/)

    // A project cover needs a project admin, and PATCH of the bulk call binds it to the project.
    const cover = { name: 'cover.png', type: 'image/png', size: PNG.length, entity_type: 'PROJECT_COVER' }
    assert.equal((await send(`${ws}/assets`, 'POST', { ...cover, entity_identifier: project.id }, member)).status, 403)
    const projectCover = await responseJson(
      await send(`${ws}/assets`, 'POST', { ...cover, entity_identifier: project.id }),
      200
    )
    await responseJson(await upload(projectCover.upload_data.url, owner), 200)
    assert.equal((await send(`${ws}/assets/${projectCover.asset_id}`, 'PATCH', {})).status, 204)
    assert.equal(
      db.prepare('SELECT cover_image_asset_id AS id FROM projects WHERE id = ?').get(project.id).id,
      projectCover.asset_id
    )

    // Duplicate the inline image onto a comment-less issue description; the copy has its own object.
    const copied = await responseJson(
      await send(`${ws}/assets/${inline.asset_id}/duplicate`, 'POST', {
        entity_type: 'ISSUE_DESCRIPTION',
        entity_id: issue.id,
        project_id: project.id
      }),
      200
    )
    assert.notEqual(copied.asset_id, inline.asset_id)
    const copy = db
      .prepare('SELECT asset, is_uploaded AS up, issue_id AS issue FROM file_assets WHERE id = ?')
      .get(copied.asset_id)
    assert.equal(copy.up, 1)
    assert.equal(copy.issue, issue.id)
    assert.equal((await send(`${ws}/assets/${inline.asset_id}/duplicate`, 'POST', { entity_type: 'NOPE' })).status, 400)

    // Generic assets: attachments registered by integrations, deduplicated by external id.
    const generic = {
      name: 'a.txt',
      type: 'text/plain',
      size: 5,
      project_id: project.id,
      external_id: 'x1',
      external_source: 'gh'
    }
    const registered = await responseJson(await send(`${ws}/generic-assets`, 'POST', generic, member), 200)
    const conflict = await send(`${ws}/generic-assets`, 'POST', generic, member)
    assert.equal(conflict.status, 409)
    assert.equal((await conflict.json()).error.details.asset_id, registered.asset_id)
    assert.equal((await send(`${ws}/generic-assets`, 'POST', { ...generic, type: 'x/y' }, member)).status, 400)
    assert.equal((await send(`${ws}/generic-assets/${registered.asset_id}`, 'GET', undefined, member)).status, 400)
    await responseJson(
      await upload(registered.upload_data.url, member, 'text/plain', new TextEncoder().encode('hello')),
      200
    )
    assert.equal((await send(`${ws}/generic-assets/${registered.asset_id}`, 'PATCH', undefined, member)).status, 204)
    const meta = await responseJson(
      await send(`${ws}/generic-assets/${registered.asset_id}`, 'GET', undefined, member),
      200
    )
    assert.equal(meta.asset_name, 'a.txt')

    // Legacy multipart upload: one request stores and confirms the file.
    const form = new FormData()
    form.set('asset', new File(['hello'], 'note.txt', { type: 'text/plain' }))
    const legacy = await responseJson(await send(`${ws}/file-assets`, 'POST', form, member), 201)
    assert.equal(legacy.is_uploaded, true)
    const key = legacy.asset.split('/').at(-1)
    assert.equal(
      (await responseJson(await send(`${ws}/file-assets/${key}`, 'GET', undefined, member), 200)).status,
      true
    )
    assert.equal(
      (await responseJson(await send(`${ws}/file-assets/nope`, 'GET', undefined, member), 200)).status,
      false
    )
    const bad = new FormData()
    bad.set('asset', new File(['x'], 'x.bin', { type: 'application/x-nope' }))
    assert.equal((await send(`${ws}/file-assets`, 'POST', bad, member)).status, 400)
    assert.equal((await send(`${ws}/file-assets/${key}`, 'DELETE', undefined, outsider)).status, 403)
    assert.equal((await send(`${ws}/file-assets/${key}`, 'DELETE', undefined, member)).status, 204)
    assert.equal((await send(`${ws}/file-assets/${key}/restore`, 'POST', undefined, member)).status, 204)
    assert.equal(db.prepare('SELECT is_deleted AS d FROM file_assets WHERE id = ?').get(legacy.id).d, 0)
    const userForm = new FormData()
    userForm.set('asset', new File(['hi'], 'mine.txt', { type: 'text/plain' }))
    const mine = await responseJson(await send('/api/v1/assets/user-file-assets', 'POST', userForm, member), 201)
    assert.equal(mine.user, member.id)
    assert.equal(
      (await responseJson(await send(`/api/v1/assets/user-file-assets/${mine.asset}`, 'GET', undefined, member), 200))
        .status,
      true
    )
    assert.equal((await send(`/api/v1/assets/user-file-assets/${mine.asset}`, 'DELETE', undefined, owner)).status, 404)

    // Static assets only serve avatars, covers and logos.
    assert.equal((await request(`/api/v1/assets/static/${inline.asset_id}`)).status, 400)
  } finally {
    db.close()
  }
})
