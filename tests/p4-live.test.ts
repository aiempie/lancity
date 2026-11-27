import assert from 'node:assert/strict'
import { test } from 'vitest'
import * as encoding from 'lib0/encoding'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as Y from 'yjs'
import { checkAuthToken, verifySecretKey } from '../src/server/collaboration/access'
import { CloseCode, ForceCloseReason, getForceCloseMessage, isValidForceCloseReason } from '../src/server/collaboration/admin-commands'
import {
  convertHtmlDocumentToAllFormats,
  generateTitleProsemirrorJson,
  getAllDocumentFormatsFromBinary,
  getBinaryDataFromHtml,
  htmlToJson,
  jsonToHtml
} from '../src/server/collaboration/codec'
import { DebounceManager } from '../src/server/collaboration/debounce'
import { AppError } from '../src/server/collaboration/errors'
import { forceCloseDocumentAcrossServers } from '../src/server/collaboration/force-close-handler'
import {
  CollaborationConnection,
  CollaborationDocument,
  MessageType,
  messages,
  readAuthToken,
  readFrameHeader,
  type LiveSocket
} from '../src/server/collaboration/hocuspocus'
import { allowedOrigins, isAllowedOrigin, validateEnv, withinShutdownDeadline } from '../src/server/collaboration/runtime'
import { onStateless } from '../src/server/collaboration/stateless'
import { extractTextFromHTML } from '../src/server/collaboration/title-utils'
import {
  convertDocumentBodySchema,
  forceCloseBodySchema,
  liveConnectionQuerySchema,
  type LiveConnectionContext
} from '../src/types/content/p4-live-schema'

const context = (patch: Partial<LiveConnectionContext> = {}): LiveConnectionContext => ({
  userId: 1,
  userName: 'Ada',
  workspaceSlug: 'acme',
  projectId: 2,
  pageId: 7,
  readOnly: false,
  authenticated: true,
  awarenessIds: [],
  ...patch
})

type FakeSocket = LiveSocket & { sent: Uint8Array[]; closed: { code: number; reason: string }[] }
function fakeConnection(patch: Partial<LiveConnectionContext> = {}) {
  const socket: FakeSocket = {
    sent: [],
    closed: [],
    send(data) {
      this.sent.push(data)
    },
    close(code, reason) {
      this.closed.push({ code, reason })
    }
  }
  return { socket, connection: new CollaborationConnection(socket, context(patch)) }
}
const types = (socket: FakeSocket) => socket.sent.map(data => readFrameHeader(data).type)

test('codec: HTML round trips through the Yjs state with marks, lists and mentions', () => {
  const html =
    '<h2>Hi</h2><p>a <strong>b</strong> <a href="https://x.test">c</a> 1 &lt; 2 &amp; 3</p><ul><li>one</li></ul>' +
    '<p><mention-component id="m1" entity_identifier="5" entity_name="user_mention"></mention-component></p>'
  const { description_binary, description_html } = convertHtmlDocumentToAllFormats(html)
  assert.ok(description_binary.length > 0)
  assert.ok(description_html.includes('<h2>Hi</h2>'))
  assert.ok(description_html.includes('<strong>b</strong>'))
  assert.ok(description_html.includes('href="https://x.test"'))
  assert.ok(description_html.includes('1 &lt; 2 &amp; 3'))
  assert.ok(description_html.includes('<ul><li><p>one</p></li></ul>'))
  assert.ok(description_html.includes('entity_identifier="5"'))
})

test('codec: the title field is stored next to the content and read back as text', () => {
  const binary = getBinaryDataFromHtml('<p>x</p>', 'My title')
  assert.equal(getAllDocumentFormatsFromBinary(binary, true).titleHTML, 'My title')
  assert.equal(getAllDocumentFormatsFromBinary(getBinaryDataFromHtml('<p>x</p>'), true).titleHTML, '')
  assert.equal(jsonToHtml(generateTitleProsemirrorJson('T')), '<h1>T</h1>')
})

test('codec: bare text becomes a paragraph, scripts are dropped, tables keep their cells', () => {
  assert.deepEqual(htmlToJson('hello<script>alert(1)</script>').content, [
    { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }
  ])
  assert.deepEqual(htmlToJson('<p></p>').content, [{ type: 'paragraph' }])
  const table = jsonToHtml(htmlToJson('<table><tbody><tr><th>H</th></tr><tr><td>c</td></tr></tbody></table>'))
  assert.ok(table.includes('<th') && table.includes('<td') && table.includes('<p>H</p>'))
  assert.equal(htmlToJson('').content?.length, 1)
})

test('codec: convert-document validation follows the Plane contract', () => {
  assert.equal(convertDocumentBodySchema.safeParse({ description_html: 'plain', variant: 'rich' }).success, false)
  assert.equal(convertDocumentBodySchema.safeParse({ description_html: '<p>x</p>', variant: 'other' }).success, false)
  assert.equal(convertDocumentBodySchema.safeParse({ description_html: '<p>x</p>', variant: 'document' }).success, true)
})

test('protocol: SyncStep1 is answered with SyncStep2 and the server asks for the client state', () => {
  const server = new CollaborationDocument('7')
  server.doc.getMap('m').set('k', 'v')
  const { socket, connection } = fakeConnection()
  server.addConnection(connection)
  const client = new Y.Doc()
  server.handleMessage(connection, messages.syncStep1('7', client))
  assert.deepEqual(types(socket), [MessageType.Sync, MessageType.Sync])
  assert.equal(socket.sent.length, 2)
  assert.equal(client.getMap('m').get('k'), undefined)
})

test('protocol: client updates apply, reach the other clients and are acknowledged', () => {
  const server = new CollaborationDocument('7')
  const a = fakeConnection({ userId: 1 })
  const b = fakeConnection({ userId: 2 })
  server.addConnection(a.connection)
  server.addConnection(b.connection)
  const client = new Y.Doc()
  let update: Uint8Array = new Uint8Array()
  client.on('update', (value: Uint8Array) => (update = value))
  client.getMap('m').set('k', 'v')
  server.handleMessage(a.connection, messages.update('7', update))
  assert.equal(server.doc.getMap('m').get('k'), 'v')
  assert.ok(types(b.socket).includes(MessageType.Sync), 'other client receives the update')
  assert.ok(!types(a.socket).includes(MessageType.Sync), 'the sender is not echoed')
  assert.ok(types(a.socket).includes(MessageType.SyncStatus), 'the sender gets an acknowledgement')
})

test('protocol: a read-only connection cannot change the document', () => {
  const server = new CollaborationDocument('7')
  const reader = fakeConnection({ readOnly: true })
  server.addConnection(reader.connection)
  const client = new Y.Doc()
  let update: Uint8Array = new Uint8Array()
  client.on('update', (value: Uint8Array) => (update = value))
  client.getMap('m').set('k', 'v')
  server.handleMessage(reader.connection, messages.update('7', update))
  assert.equal(server.doc.getMap('m').get('k'), undefined)
  const status = reader.socket.sent.find(data => readFrameHeader(data).type === MessageType.SyncStatus)
  assert.ok(status)
  assert.equal(readFrameHeader(status).decoder.arr[readFrameHeader(status).decoder.pos], 0)
})

test('protocol: frames for another document are ignored', () => {
  const server = new CollaborationDocument('7')
  const { socket, connection } = fakeConnection()
  server.addConnection(connection)
  server.handleMessage(connection, messages.syncStep1('8', new Y.Doc()))
  assert.equal(socket.sent.length, 0)
})

test('protocol: awareness states belong to a connection and go away with it', () => {
  const server = new CollaborationDocument('7')
  const a = fakeConnection()
  const b = fakeConnection({ userId: 2 })
  server.addConnection(a.connection)
  server.addConnection(b.connection)
  const clientAwareness = new awarenessProtocol.Awareness(new Y.Doc())
  clientAwareness.setLocalState({ name: 'Ada' })
  const encoder = encoding.createEncoder()
  encoding.writeVarString(encoder, '7')
  encoding.writeVarUint(encoder, MessageType.Awareness)
  encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(clientAwareness, [clientAwareness.clientID]))
  server.handleMessage(a.connection, encoding.toUint8Array(encoder))
  assert.deepEqual(a.connection.context.awarenessIds, [clientAwareness.clientID])
  assert.ok(types(b.socket).includes(MessageType.Awareness))
  assert.equal(server.awareness.getStates().has(clientAwareness.clientID), true)
  server.removeConnection(a.connection)
  assert.equal(server.awareness.getStates().has(clientAwareness.clientID), false)
  clientAwareness.destroy()
})

test('protocol: the auth token message is parsed and its user id is checked', () => {
  const frame = encoding.createEncoder()
  encoding.writeVarString(frame, '7')
  encoding.writeVarUint(frame, MessageType.Auth)
  encoding.writeVarUint(frame, 0)
  encoding.writeVarString(frame, JSON.stringify({ id: '1', cookie: 'x' }))
  const auth = readAuthToken(encoding.toUint8Array(frame))
  assert.equal(auth?.documentName, '7')
  assert.doesNotThrow(() => checkAuthToken(auth!.token, 1))
  assert.throws(() => checkAuthToken(auth!.token, 2), (error: unknown) => (error as AppError).code === 'AUTH_USER_MISMATCH')
  assert.throws(() => checkAuthToken('not json', 1), (error: unknown) => (error as AppError).code === 'AUTH_MISSING_CREDENTIALS')
  assert.throws(() => checkAuthToken('{}', 1), (error: unknown) => (error as AppError).code === 'AUTH_MISSING_CREDENTIALS')
  assert.equal(readAuthToken(messages.syncStep1('7', new Y.Doc())), null)
})

test('stateless: page events are turned into client events, read-only clients are ignored', () => {
  const server = new CollaborationDocument('7')
  const writer = fakeConnection()
  const other = fakeConnection({ userId: 2 })
  const reader = fakeConnection({ userId: 3, readOnly: true })
  for (const item of [writer, other, reader]) server.addConnection(item.connection)
  onStateless(server, writer.connection, 'lock')
  assert.equal(other.socket.sent.length, 1)
  assert.equal(readFrameHeader(other.socket.sent[0]).type, MessageType.Stateless)
  onStateless(server, reader.connection, 'lock')
  onStateless(server, writer.connection, 'constructor')
  onStateless(server, writer.connection, 'unknown')
  assert.equal(other.socket.sent.length, 1)
})

test('force close: clients are told, closed with the code, and the document is unloaded', async () => {
  const server = new CollaborationDocument('7')
  const a = fakeConnection()
  server.addConnection(a.connection)
  const instance = {
    document: server as CollaborationDocument | null,
    unload: async () => {
      instance.document = null
    }
  }
  await forceCloseDocumentAcrossServers(instance, '7', ForceCloseReason.DOCUMENT_TOO_LARGE, CloseCode.DOCUMENT_TOO_LARGE)
  assert.equal(readFrameHeader(a.socket.sent[0]).type, MessageType.Stateless)
  assert.deepEqual(a.socket.closed, [{ code: 4001, reason: 'document_too_large' }])
  assert.equal(instance.document, null)
  assert.ok(isValidForceCloseReason('admin_request') && !isValidForceCloseReason('nope'))
  assert.ok(getForceCloseMessage(ForceCloseReason.SERVER_SHUTDOWN).includes('shutting down'))
})

test('debounce: only the last call runs, flush runs it now, cancel drops it', async () => {
  const calls: unknown[][] = []
  const run = async (...args: unknown[]) => void calls.push(args.slice(0, -1))
  const debounce = new DebounceManager({ wait: 20 })
  debounce.schedule(run, 'a')
  debounce.schedule(run, 'b')
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.deepEqual(calls, [['b']])
  debounce.schedule(run, 'c')
  await debounce.flush(run)
  assert.deepEqual(calls, [['b'], ['c']])
  debounce.schedule(run, 'd')
  debounce.cancel()
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(calls.length, 2)
})

test('runtime: origins, environment and shutdown deadline', async () => {
  const env = { BETTER_AUTH_URL: 'https://app.test/x', LIVE_CORS_ALLOWED_ORIGINS: ' https://m.test , ' } as never
  assert.deepEqual(allowedOrigins(env), ['https://m.test', 'https://app.test'])
  assert.ok(isAllowedOrigin('https://app.test', env) && isAllowedOrigin(null, env))
  assert.ok(!isAllowedOrigin('https://evil.test', env))
  assert.equal(validateEnv({}).APP_VERSION, '1.0.0')
  assert.equal(validateEnv({ LIVE_SERVER_SECRET_KEY: 'short' } as never).ok, false)
  assert.equal(await withinShutdownDeadline(async () => 5, 50), 5)
  await assert.rejects(withinShutdownDeadline(() => new Promise(() => undefined), 20), /timed out/)
})

test('secret key check is exact and rejects an unset key', async () => {
  assert.equal(await verifySecretKey('abcdefghijklmnopq', 'abcdefghijklmnopq'), true)
  assert.equal(await verifySecretKey('abcdefghijklmnopq', 'abcdefghijklmnopr'), false)
  assert.equal(await verifySecretKey('', ''), false)
  assert.equal(await verifySecretKey('x', undefined), false)
})

test('schemas: connection query, force close body and title text', () => {
  assert.equal(liveConnectionQuerySchema.safeParse({ workspaceSlug: 'a', documentType: 'project_page', pageId: '9' }).success, true)
  assert.equal(liveConnectionQuerySchema.safeParse({ workspaceSlug: 'a', documentType: 'issue', pageId: '9' }).success, false)
  assert.equal(liveConnectionQuerySchema.safeParse({ workspaceSlug: 'a', documentType: 'project_page', pageId: null }).success, false)
  assert.deepEqual(forceCloseBodySchema.parse({ page_id: 3 }), { page_id: 3, reason: 'admin_request', code: 4000 })
  assert.equal(forceCloseBodySchema.safeParse({ page_id: 3, code: 1000 }).success, false)
  assert.equal(extractTextFromHTML('<heading level="1">Plan <bold>2</bold></heading>'), 'Plan 2')
})
