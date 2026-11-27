import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { Node } from '@tiptap/pm/model'
import { afterAll, beforeAll, test } from 'vitest'
import * as Y from 'yjs'
import { fragmentToJson, htmlToJson } from '../src/server/collaboration/codec'
import { documentSchema } from './editor/schema'

// Live collaboration through the real Worker and Durable Object, with the provider the editor uses
// (@hocuspocus/provider) and one signed-in session per user:
//   owner  - owns the pages
//   member - project member (role 15), may edit public pages
//   guest  - project guest (role 5) in a project that shows guests every feature: read-only
//   outsider - workspace member who is not in the project
// Needs the isolated Worker of the other integration tests (`pnpm dev --port 4198`) and LANCITY_TEST_D1.
const base = new URL(process.env.LANCITY_TEST_URL ?? 'http://localhost:4198')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use an isolated local Worker')
assert.ok(process.env.LANCITY_TEST_D1, 'Set LANCITY_TEST_D1 to the isolated Worker database file')
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const ipSeed = parseInt(runId.slice(0, 4), 16)
const slug = `live-${runId}`

const providers = new Set()
let db
let users
let projectId
let publicPageId
let privatePageId

function request(path, { cookie, method = 'GET', body, ip } = {}) {
  const headers = new Headers()
  if (cookie) headers.set('cookie', cookie)
  if (ip) headers.set('cf-connecting-ip', ip)
  if (method !== 'GET') headers.set('origin', base.origin)
  if (body !== undefined) headers.set('content-type', 'application/json')
  return fetch(new URL(path, base), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}

async function json(response, status) {
  assert.equal(response.status, status, `${response.url}: ${await response.clone().text()}`)
  return response.json()
}

let ipCounter = 0
async function signUp(role) {
  const username = `live${runId}${role}`
  const ip = `198.19.${(ipSeed >> 8) % 256}.${(ipSeed + ++ipCounter) % 256}`
  const response = await request('/api/auth/sign-up/email', {
    method: 'POST',
    ip,
    body: { name: `Live ${role}`, username, email: `${username}@example.com`, password: 'isolated-test-password' }
  })
  const { user } = await json(response, 200)
  const cookie = response.headers
    .getSetCookie()
    .map(value => value.split(';', 1)[0])
    .join('; ')
  return { id: Number(user.id), name: role, cookie }
}

async function waitFor(check, { timeoutMs = 15_000, intervalMs = 100, message = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastError
  for (;;) {
    try {
      const value = await check()
      if (value !== false) return value
    } catch (error) {
      lastError = error
    }
    if (Date.now() >= deadline) throw lastError ?? new Error(`Timed out waiting for ${message}`)
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}

/**
 * Open a page like the editor does. The WebSocket carries the user's session cookie and the app origin, which the
 * Worker checks on the upgrade; the token is the editor's user object.
 */
function open(user, pageId, { doc = new Y.Doc(), tokenUserId = user.id } = {}) {
  const url = new URL(
    `/api/v1/live/collaboration?workspaceSlug=${slug}&documentType=project_page&pageId=${pageId}`,
    base
  )
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const events = { authenticated: null, denied: null, synced: false, sockets: 0 }
  class SessionWebSocket extends WebSocket {
    constructor(target, protocols) {
      super(target, { protocols, headers: { cookie: user.cookie, origin: base.origin } })
      events.sockets++
    }
  }
  const provider = new HocuspocusProvider({
    url: url.href,
    name: String(pageId),
    document: doc,
    token: JSON.stringify({ id: String(tokenUserId), name: user.name, color: '#5e6ad2' }),
    WebSocketPolyfill: SessionWebSocket,
    // A refused page must not reconnect forever.
    maxAttempts: 1,
    onAuthenticated: ({ scope }) => (events.authenticated = scope),
    onAuthenticationFailed: ({ reason }) => (events.denied = reason),
    onSynced: () => (events.synced = true)
  })
  providers.add(provider)
  const session = {
    doc,
    provider,
    events,
    synced: () => waitFor(() => events.synced, { message: `${user.name} to sync page ${pageId}` }),
    close: async () => {
      provider.destroy()
      providers.delete(provider)
      // Let the Durable Object see the close and run its last-disconnect save.
      await new Promise(resolve => setTimeout(resolve, 300))
    }
  }
  return session
}

const fragment = doc => doc.getXmlFragment('default')
const toJson = doc => fragmentToJson(fragment(doc))
const texts = doc =>
  (toJson(doc).content ?? []).map(node => (node.content ?? []).map(child => child.text ?? '').join(''))

/** Insert a paragraph the way the editor does (Yjs XML element with a block id), at the start or the end. */
function addParagraph(doc, text, { atStart = false } = {}) {
  const paragraph = new Y.XmlElement('paragraph')
  paragraph.setAttribute('id', `b-${randomUUID()}`)
  paragraph.insert(0, [new Y.XmlText(text)])
  doc.transact(() => fragment(doc).insert(atStart ? 0 : fragment(doc).length, [paragraph]))
}

function assertEditorDocument(doc) {
  Node.fromJSON(documentSchema, toJson(doc)).check()
}

/** The stored page, read straight from D1. */
function storedPage(pageId) {
  const row = db
    .prepare('SELECT description_binary AS binary, description_html AS html FROM pages WHERE id = ?')
    .get(pageId)
  const stored = new Y.Doc()
  if (row.binary?.byteLength) Y.applyUpdate(stored, new Uint8Array(row.binary))
  return { doc: stored, html: row.html, hasBinary: Boolean(row.binary?.byteLength) }
}

/** Reopen with a fresh session and an empty document: only what the server stored comes back. */
async function reopen(user, pageId) {
  const session = open(user, pageId)
  await session.synced()
  const content = texts(session.doc)
  await session.close()
  return content
}

beforeAll(async () => {
  db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  const [owner, member, guest, outsider] = [
    await signUp('owner'),
    await signUp('member'),
    await signUp('guest'),
    await signUp('outsider')
  ]
  users = { owner, member, guest, outsider }
  const workspace = await json(
    await request('/api/v1/workspaces', { ...owner, method: 'POST', body: { name: 'Live', slug } }),
    201
  )
  const project = await json(
    await request(`/api/v1/workspaces/${slug}/projects`, {
      ...owner,
      method: 'POST',
      body: { name: 'Live', identifier: `L${runId.slice(0, 4).toUpperCase()}` }
    }),
    201
  )
  projectId = project.id
  const addWorkspaceMember = db.prepare(
    'INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (?, ?, ?)'
  )
  const addProjectMember = db.prepare(
    'INSERT INTO project_members (workspace_id, project_id, member_id, role) VALUES (?, ?, ?, ?)'
  )
  addWorkspaceMember.run(workspace.id, member.id, 15)
  addProjectMember.run(workspace.id, projectId, member.id, 15)
  addWorkspaceMember.run(workspace.id, guest.id, 5)
  addProjectMember.run(workspace.id, projectId, guest.id, 5)
  addWorkspaceMember.run(workspace.id, outsider.id, 15)
  db.prepare('UPDATE projects SET guest_view_all_features = 1 WHERE id = ?').run(projectId)

  const pages = `/api/v1/workspaces/${slug}/projects/${projectId}/pages`
  // No binary state yet: the first live load converts the stored HTML, like a page created by the API.
  publicPageId = (
    await json(
      await request(pages, { ...owner, method: 'POST', body: { name: 'Shared', description_html: '<p>Seed</p>' } }),
      201
    )
  ).id
  privatePageId = (
    await json(
      await request(pages, { ...owner, method: 'POST', body: { name: 'Private', description_html: '<p>Secret</p>' } }),
      201
    )
  ).id
  assert.equal(
    (await request(`${pages}/${privatePageId}/access`, { ...owner, method: 'POST', body: { access: 1 } })).status,
    204
  )
})

afterAll(() => {
  for (const provider of providers) provider.destroy()
  db?.close()
})

test('owner and member edit the same page at once and converge', async () => {
  const owner = open(users.owner, publicPageId)
  const member = open(users.member, publicPageId)
  await Promise.all([owner.synced(), member.synced()])
  assert.equal(owner.events.authenticated, 'read-write')
  assert.equal(member.events.authenticated, 'read-write')
  assert.deepEqual(texts(owner.doc), ['Seed'])

  // Concurrent edits: neither client has seen the other's change when it makes its own.
  addParagraph(owner.doc, 'from owner', { atStart: true })
  addParagraph(member.doc, 'from member')
  await waitFor(() => texts(owner.doc).length === 3 && texts(member.doc).length === 3, { message: 'both edits' })
  await waitFor(() => JSON.stringify(toJson(owner.doc)) === JSON.stringify(toJson(member.doc)), {
    message: 'convergence'
  })
  assert.deepEqual(texts(owner.doc), ['from owner', 'Seed', 'from member'])
  assertEditorDocument(owner.doc)

  await owner.close()
  await member.close()
  assert.deepEqual(await reopen(users.member, publicPageId), ['from owner', 'Seed', 'from member'])
})

test('a guest opens the page read-only and the server drops its edits', async () => {
  const owner = open(users.owner, publicPageId)
  const guest = open(users.guest, publicPageId)
  await Promise.all([owner.synced(), guest.synced()])
  assert.equal(guest.events.authenticated, 'readonly')
  assert.deepEqual(texts(guest.doc), ['from owner', 'Seed', 'from member'])

  addParagraph(guest.doc, 'from guest')
  addParagraph(owner.doc, 'owner after guest')
  // The owner's edit reaches the guest; the guest's edit never reaches the owner.
  await waitFor(() => texts(guest.doc).includes('owner after guest'), { message: 'owner edit at the guest' })
  await new Promise(resolve => setTimeout(resolve, 1_000))
  assert.ok(!texts(owner.doc).includes('from guest'))

  await guest.close()
  await owner.close()
  const content = await reopen(users.member, publicPageId)
  assert.deepEqual(content, ['from owner', 'Seed', 'from member', 'owner after guest'])
})

test('users without access to a page are refused with PermissionDenied', async () => {
  const cases = [
    [users.outsider, publicPageId, 'outsider on a public page'],
    [users.outsider, privatePageId, 'outsider on a private page'],
    [users.member, privatePageId, 'member on a private page'],
    [users.guest, privatePageId, 'guest on a private page']
  ]
  for (const [user, pageId, label] of cases) {
    const session = open(user, pageId)
    const reason = await waitFor(() => session.events.denied ?? false, { message: label })
    assert.equal(reason, 'AUTH_PAGE_ACCESS_DENIED', label)
    assert.equal(session.events.synced, false, label)
    assert.deepEqual(texts(session.doc), [], `${label} received content`)
    // The refused socket stays open, so the provider does not reconnect in a loop.
    await new Promise(resolve => setTimeout(resolve, 1_500))
    assert.equal(session.events.sockets, 1, `${label} reconnected`)
    await session.close()
  }
  // A token naming another user than the session is refused by the Durable Object.
  const impostor = open(users.member, publicPageId, { tokenUserId: users.owner.id })
  assert.equal(
    await waitFor(() => impostor.events.denied ?? false, { message: 'token mismatch' }),
    'AUTH_USER_MISMATCH'
  )
  assert.deepEqual(texts(impostor.doc), [])
  await impostor.close()
  // The owner still opens the private page.
  assert.deepEqual(await reopen(users.owner, privatePageId), ['Secret'])
})

test('the last disconnect saves the page to D1 in every format', async () => {
  const owner = open(users.owner, publicPageId)
  await owner.synced()
  addParagraph(owner.doc, 'saved on disconnect')
  const expected = toJson(owner.doc)
  await owner.close()

  const stored = await waitFor(
    () => {
      const page = storedPage(publicPageId)
      return page.hasBinary && texts(page.doc).includes('saved on disconnect') ? page : false
    },
    { message: 'the save in D1' }
  )
  assert.deepEqual(fragmentToJson(fragment(stored.doc)), expected)
  // The HTML is what duplicates, versions and API readers use: it holds the same document.
  assert.deepEqual(htmlToJson(stored.html), expected)
  Node.fromJSON(documentSchema, htmlToJson(stored.html)).check()
})

test('edits made offline reach the server after reconnecting', async () => {
  const owner = open(users.owner, publicPageId)
  const member = open(users.member, publicPageId)
  await Promise.all([owner.synced(), member.synced()])

  owner.provider.disconnect()
  await waitFor(() => owner.provider.configuration.websocketProvider.status === 'disconnected', {
    message: 'owner offline'
  })
  addParagraph(owner.doc, 'written offline')
  await new Promise(resolve => setTimeout(resolve, 1_000))
  assert.ok(!texts(member.doc).includes('written offline'), 'an offline edit must not travel')

  owner.events.synced = false
  await owner.provider.connect()
  await owner.synced()
  await waitFor(() => texts(member.doc).includes('written offline'), { message: 'offline edit at the member' })
  assert.equal(owner.provider.unsyncedChanges, 0)
  assertEditorDocument(member.doc)

  await owner.close()
  await member.close()
  const content = await reopen(users.member, publicPageId)
  assert.ok(content.includes('written offline'))
  assert.ok(texts(storedPage(publicPageId).doc).includes('written offline'))
})
