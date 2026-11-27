import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'vitest'
import { createEditorFileHandler } from '../src/lib/editor/file-handler'

// The editor file handler (src/lib/editor/file-handler.ts) against the Worker's project asset routes and the local
// R2 simulation: the same requests the editor makes in the browser, except that the bytes go through `fetch`
// instead of XMLHttpRequest (the browser path is covered by tests/editor/assets.browser.test.tsx).
const base = new URL(process.env.LANCITY_TEST_URL ?? 'http://localhost:4198')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use an isolated local Worker')
assert.ok(process.env.LANCITY_TEST_D1, 'Set LANCITY_TEST_D1 to the isolated Worker database file')
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])

function request(path, { cookie, method = 'GET', body, ip } = {}) {
  const headers = new Headers()
  if (cookie) headers.set('cookie', cookie)
  if (ip) headers.set('cf-connecting-ip', ip)
  if (method !== 'GET') headers.set('origin', base.origin)
  if (body !== undefined) headers.set('content-type', 'application/json')
  return fetch(new URL(path, base), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}
async function responseJson(response, status) {
  assert.equal(response.status, status, `${response.url}: ${await response.clone().text()}`)
  return response.json()
}
async function signUp(suffix, ip) {
  const username = `edasset${runId}${suffix}`
  const response = await request('/api/auth/sign-up/email', {
    method: 'POST',
    ip,
    body: { name: `Editor ${suffix}`, username, email: `${username}@example.com`, password: 'isolated-test-password' }
  })
  const { user } = await responseJson(response, 200)
  const cookie = response.headers
    .getSetCookie()
    .map(value => value.split(';', 1)[0])
    .join('; ')
  return { id: Number(user.id), cookie }
}

/** `fetch` of a signed-in browser tab: relative URLs, the session cookie, and Origin on writes. */
function browserFetch(user) {
  return (input, init = {}) => {
    const headers = new Headers(init.headers)
    headers.set('cookie', user.cookie)
    if (init.method && init.method !== 'GET') headers.set('origin', base.origin)
    return fetch(new URL(input, base), { ...init, headers })
  }
}
/** The XMLHttpRequest PUT of the browser, with `fetch`. */
function fetchSender(user) {
  return async (url, file, headers, { onProgress, signal }) => {
    const response = await browserFetch(user)(url, {
      method: 'PUT',
      headers: { ...headers, 'content-length': String(file.size) },
      body: file,
      signal
    })
    if (!response.ok) throw new Error(`upload ${response.status}: ${await response.text()}`)
    onProgress(1)
  }
}
const png = (name = 'diagram.png') => new File([PNG], name, { type: 'image/png' })

test('editor images: upload to R2, read, check, duplicate, delete, restore and refusals', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('owner', '198.18.230.1')
    const member = await signUp('member', '198.18.230.2')
    const outsider = await signUp('outsider', '198.18.230.3')
    const slug = `edasset-${runId}`
    const workspace = await responseJson(
      await request('/api/v1/workspaces', { ...owner, method: 'POST', body: { name: 'Editor assets', slug } }),
      201
    )
    const project = await responseJson(
      await request(`/api/v1/workspaces/${slug}/projects`, {
        ...owner,
        method: 'POST',
        body: { name: 'Editor assets', identifier: 'EDA' }
      }),
      201
    )
    // The member belongs to the project; the outsider only to the workspace.
    for (const [user, inProject] of [
      [member, true],
      [outsider, false]
    ]) {
      db.prepare('INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (?, ?, 15)').run(
        workspace.id,
        user.id
      )
      if (inProject)
        db.prepare('INSERT INTO project_members (workspace_id, project_id, member_id, role) VALUES (?, ?, ?, 15)').run(
          workspace.id,
          project.id,
          user.id
        )
    }
    const page = await responseJson(
      await request(`/api/v1/workspaces/${slug}/projects/${project.id}/pages`, {
        ...owner,
        method: 'POST',
        body: { name: 'With images' }
      }),
      201
    )
    const scope = { workspaceSlug: slug, projectId: project.id, entityType: 'PAGE_DESCRIPTION', entityId: page.id }
    const progress = []
    const handler = (user, extra = {}) =>
      createEditorFileHandler({
        ...scope,
        fetch: browserFetch(user),
        sendContent: fetchSender(user),
        onProgress: (blockId, percent) => progress.push([blockId, percent]),
        ...extra
      })
    const files = handler(owner)
    const read = (src, user = member) => browserFetch(user)(src)

    // Upload: register, PUT the bytes to R2, confirm. The node stores the asset id.
    const id = await files.upload('block-1', png())
    assert.match(id, /^[1-9]\d*$/)
    assert.deepEqual(progress, [
      ['block-1', 0],
      ['block-1', 100],
      ['block-1', undefined]
    ])
    const row = db
      .prepare('SELECT entity_type, page_id, project_id, is_uploaded, size FROM file_assets WHERE id = ?')
      .get(Number(id))
    assert.deepEqual(
      { ...row },
      { entity_type: 'PAGE_DESCRIPTION', page_id: page.id, project_id: project.id, is_uploaded: 1, size: PNG.length }
    )

    // Read: any project member gets the image inline; the download is an attachment.
    const src = await files.getAssetSrc(id)
    assert.equal(src, `/api/v1/workspaces/${slug}/projects/${project.id}/entity-assets/${id}?disposition=inline`)
    const image = await read(src)
    assert.equal(image.status, 200)
    assert.equal(image.headers.get('content-type'), 'image/png')
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), PNG)
    const download = await read(await files.getAssetDownloadSrc(id))
    assert.match(download.headers.get('content-disposition'), /^attachment;/)
    assert.equal((await read(src, outsider)).status, 403)

    // Values that are not asset ids never reach the API.
    assert.equal(await files.getAssetSrc('https://example.com/a.png'), 'https://example.com/a.png')
    assert.equal(await files.getAssetSrc('../../users/me'), '')
    assert.equal(await files.getAssetSrc('blob:http://localhost/x'), '')
    assert.equal(await files.checkIfAssetExists('1 OR 1=1'), false)
    await assert.rejects(files.duplicate('abc'), /Invalid asset id/)

    assert.equal(await files.checkIfAssetExists(id), true)
    assert.equal(await files.checkIfAssetExists('999999999'), false)

    // Duplicate (copying a page or pasting an image block): a new asset with its own R2 object.
    const copy = await files.duplicate(id)
    assert.notEqual(copy, id)
    assert.equal(db.prepare('SELECT page_id FROM file_assets WHERE id = ?').get(Number(copy)).page_id, page.id)
    assert.deepEqual(new Uint8Array(await (await read(await files.getAssetSrc(copy))).arrayBuffer()), PNG)

    // Delete (image node removed) and restore (undo): soft delete, the R2 object stays.
    await files.delete(id)
    assert.equal((await read(src)).status, 404)
    assert.equal(await files.checkIfAssetExists(id), false)
    await files.restore(id)
    assert.equal((await read(src)).status, 200)
    assert.equal(await files.checkIfAssetExists(id), true)

    // Refusals surface as rejected uploads and the progress entry is cleared.
    progress.length = 0
    await assert.rejects(
      files.upload('block-2', new File(['hello'], 'notes.txt', { type: 'text/plain' })),
      /Asset request failed \(400\)/
    )
    assert.deepEqual(progress.at(-1), ['block-2', undefined])
    await assert.rejects(handler(outsider).upload('block-3', png()), /Asset request failed \(403\)/)
    const large = new File([new Uint8Array(6 * 1024 * 1024)], 'large.png', { type: 'image/png' })
    // The registration caps the declared size; the PUT of more bytes than the limit is refused with 413.
    await assert.rejects(files.upload('block-4', large), /413/)
    assert.equal(files.validation.maxFileSize, 5 * 1024 * 1024)

    // Cancel aborts the transfer; the registered asset stays unconfirmed for the cleanup job.
    const before = db.prepare('SELECT MAX(id) AS id FROM file_assets').get().id
    const stalled = handler(owner, {
      sendContent: (_url, _file, _headers, { signal }) =>
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
    })
    const pending = stalled.upload('block-5', png())
    await new Promise(resolve => setTimeout(resolve, 300))
    stalled.cancel()
    await assert.rejects(pending, /aborted/)
    const registered = db.prepare('SELECT is_uploaded FROM file_assets WHERE id > ? ORDER BY id DESC').get(before)
    assert.equal(registered.is_uploaded, 0)
  } finally {
    db.close()
  }
})
