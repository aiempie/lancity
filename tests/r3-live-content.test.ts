import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'
import * as Y from 'yjs'
import { PageDocumentService } from '../src/server/collaboration/document'
import { getBinaryDataFromHtml } from '../src/server/collaboration/codec'
import { forceCloseDocumentAcrossServers } from '../src/server/collaboration/force-close-handler'
import { ForceCloseReason } from '../src/server/collaboration/admin-commands'

// `cloudflare:workers` only exists inside the Workers runtime: resolve it to a minimal stub for Node.
const stub = 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env } }\nexport const env = {}\n'
const hooks = `export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,${encodeURIComponent(stub)}', shortCircuit: true }
  return next(specifier, context)
}`
register(`data:text/javascript,${encodeURIComponent(hooks)}`)

type Row = { id: number; data: ArrayBuffer }

/** In-memory stand-in for the Durable Object storage: SQLite rows, key/value and one alarm. */
function fakeContext() {
  const updates: Row[] = []
  let snapshot: Row[] = []
  let nextId = 1
  const kv = new Map<string, unknown>()
  let alarm: number | null = null
  let sockets: unknown[] = []
  const sql = {
    exec(query: string, ...args: unknown[]) {
      const q = query.trim()
      const rows = (list: Row[]) => ({ toArray: () => list.map(row => ({ data: row.data })) })
      if (q.startsWith('INSERT INTO yjs_updates')) updates.push({ id: nextId++, data: args[0] as ArrayBuffer })
      else if (q.startsWith('INSERT INTO yjs_snapshot')) snapshot.push({ id: args[0] as number, data: args[1] as ArrayBuffer })
      else if (q === 'DELETE FROM yjs_updates') updates.length = 0
      else if (q === 'DELETE FROM yjs_snapshot') snapshot = []
      else if (q.startsWith('SELECT data FROM yjs_snapshot')) return rows([...snapshot].sort((a, b) => a.id - b.id))
      else if (q.startsWith('SELECT data FROM yjs_updates')) return rows(updates)
      else if (q.startsWith('SELECT 1 FROM yjs_snapshot')) return { toArray: () => snapshot.map(() => ({ 1: 1 })) }
      return { toArray: () => [] }
    }
  }
  const ctx = {
    storage: {
      sql,
      kv: { get: (key: string) => kv.get(key), put: (key: string, value: unknown) => void kv.set(key, value), delete: (key: string) => void kv.delete(key) },
      transactionSync: (fn: () => void) => fn(),
      getAlarm: async () => alarm,
      setAlarm: async (time: number) => void (alarm = time),
      deleteAlarm: async () => void (alarm = null)
    },
    blockConcurrencyWhile: (fn: () => Promise<void>) => void fn(),
    getWebSockets: () => sockets
  }
  return { ctx, rowCount: () => updates.length + snapshot.length, alarm: () => alarm, kv, setSockets: (list: unknown[]) => (sockets = list) }
}

type Internals = {
  loadDocument(): Promise<{ doc: Y.Doc; connections: Set<unknown> }>
  storeNow(): Promise<boolean>
  alarm(): Promise<void>
  disconnect(ws: unknown): Promise<void>
  target: { unload(): Promise<void>; document: unknown }
  document: unknown
  fetch(request: Request): Promise<Response>
}

const calls = { stores: 0, failing: false, lastHtml: '' }
const original = {
  fetchBinary: PageDocumentService.prototype.fetchDescriptionBinary,
  fetchDetails: PageDocumentService.prototype.fetchDetails,
  update: PageDocumentService.prototype.updateDescriptionBinary,
  updateProps: PageDocumentService.prototype.updatePageProperties
}

test.before(() => {
  PageDocumentService.prototype.fetchDescriptionBinary = async () => getBinaryDataFromHtml('<p>hello</p>', 'Title')
  PageDocumentService.prototype.fetchDetails = async () => ({ name: 'Title', description_html: '<p>hello</p>' })
  PageDocumentService.prototype.updatePageProperties = async () => undefined
  PageDocumentService.prototype.updateDescriptionBinary = async (_pageId, data) => {
    if (calls.failing) throw new Error('D1 unavailable')
    calls.stores++
    calls.lastHtml = data.description_html
  }
})
test.after(() => Object.assign(PageDocumentService.prototype, {
  fetchDescriptionBinary: original.fetchBinary,
  fetchDetails: original.fetchDetails,
  updateDescriptionBinary: original.update,
  updatePageProperties: original.updateProps
}))

async function createObject() {
  const { CollaborationDO } = await import('../src/server/live/collaboration-do')
  const fake = fakeContext()
  fake.kv.set('meta', { pageId: 7 })
  fake.kv.set('editor', { userId: 1, workspaceSlug: 'acme', projectId: 2 })
  const object = new CollaborationDO(fake.ctx as never, { DB: {} } as never) as unknown as Internals
  const document = await object.loadDocument()
  // An edit arrives: it is stored in the object and the save alarm is set.
  document.doc.getXmlFragment('default').insert(0, [new Y.XmlText('edited')])
  await new Promise(resolve => setTimeout(resolve, 0))
  return { object, fake, document }
}

test('a failed save keeps the stored state and retries from the alarm without giving up', async () => {
  calls.failing = true
  const { object, fake } = await createObject()
  assert.ok(fake.rowCount() > 0, 'the edit is stored in the object')
  assert.notEqual(fake.alarm(), null)
  for (let attempt = 0; attempt < 12; attempt++) {
    await object.alarm()
    assert.ok(fake.rowCount() > 0, `storage kept after failure ${attempt + 1}`)
    assert.notEqual(fake.alarm(), null, 'a retry stays scheduled')
    assert.ok(object.document, 'document stays loaded')
  }
  assert.ok((fake.kv.get('failure') as { count: number }).count >= 12)
  // The database recovers: the state is saved and only then dropped from the object.
  calls.failing = false
  await object.alarm()
  assert.equal(calls.stores > 0, true)
  assert.equal(fake.rowCount(), 0)
  assert.equal(fake.kv.has('failure'), false)
})

test('the last disconnect does not drop unsaved state when the save fails', async () => {
  calls.failing = true
  const { object, fake } = await createObject()
  await object.disconnect({})
  assert.ok(fake.rowCount() > 0)
  assert.ok(object.document)
  assert.notEqual(fake.alarm(), null)
  calls.failing = false
  await object.disconnect({})
  assert.equal(fake.rowCount(), 0)
  assert.equal(object.document, null)
})

test('a stored state whose document cannot be loaded is kept and retried', async () => {
  const { object, fake } = await createObject()
  calls.failing = true
  await object.target.unload() // force close path: save fails, state stays
  assert.equal(object.document, null)
  assert.ok(fake.rowCount() > 0)
  assert.notEqual(fake.alarm(), null)
  PageDocumentService.prototype.fetchDetails = async () => {
    throw new Error('Page not found')
  }
  await object.alarm()
  assert.ok(fake.rowCount() > 0, 'a page that cannot be read does not erase the stored copy')
  assert.notEqual(fake.alarm(), null)
  PageDocumentService.prototype.fetchDetails = async () => ({ name: 'Title', description_html: '<p>hello</p>' })
})

test('force close saves edits made inside the debounce window before unloading', async () => {
  calls.failing = false
  calls.stores = 0
  const { object, fake } = await createObject()
  assert.notEqual(fake.alarm(), null, 'the edit is waiting for the debounced save')
  await forceCloseDocumentAcrossServers(object.target as never, '7', ForceCloseReason.ADMIN_REQUEST)
  assert.equal(calls.stores, 1, 'the page was saved by the force close')
  assert.match(calls.lastHtml, /edited/)
  assert.equal(object.document, null)
  assert.equal(fake.rowCount(), 0)
})

test('force close of a page that cannot be saved keeps the stored state', async () => {
  calls.failing = true
  const { object, fake } = await createObject()
  await forceCloseDocumentAcrossServers(object.target as never, '7', ForceCloseReason.ADMIN_REQUEST)
  assert.equal(object.document, null)
  assert.ok(fake.rowCount() > 0)
  assert.notEqual(fake.alarm(), null)
  calls.failing = false
})

test('duplicating a page keeps the description: the conversion runs in process without the live secret', async () => {
  const { syncWithExternalService, replaceAssetIds } = await import('../src/server/asset/jobs/copy-s3-object')
  const html = replaceAssetIds('<p>text</p><image-component src="5"></image-component>', 'image-component', [{ old_asset_id: 5, new_asset_id: 9 }])
  assert.match(html, /src="9"/)
  const converted = syncWithExternalService({} as never, 'PAGE', html)
  assert.ok(converted.description_binary && converted.description_json)
  const doc = new Y.Doc()
  Y.applyUpdate(doc, Buffer.from(converted.description_binary, 'base64'))
  assert.ok(doc.share.size > 0)
  // Invalid HTML is reported as an empty result, not thrown (the job keeps the HTML).
  assert.deepEqual(syncWithExternalService({} as never, 'PAGE', 'plain'), {})
})

test('overlapping saves serialize and include edits made while D1 is writing', async () => {
  calls.failing = false
  const { object, fake, document } = await createObject()
  const writes: string[] = []
  let releaseFirst!: () => void
  let started!: () => void
  const firstStarted = new Promise<void>(resolve => { started = resolve })
  const firstRelease = new Promise<void>(resolve => { releaseFirst = resolve })
  let active = 0
  let maxActive = 0
  PageDocumentService.prototype.updateDescriptionBinary = async (_pageId, data) => {
    active++
    maxActive = Math.max(maxActive, active)
    writes.push(data.description_html)
    if (writes.length === 1) {
      started()
      await firstRelease
    }
    active--
  }
  try {
    const first = object.storeNow()
    await firstStarted
    document.doc.getXmlFragment('default').insert(0, [new Y.XmlText('later edit')])
    const second = object.storeNow()
    releaseFirst()
    assert.deepEqual(await Promise.all([first, second]), [true, true])
    assert.equal(maxActive, 1)
    assert.equal(writes.length, 2)
    assert.match(writes[1], /later edit/)
    assert.ok(fake.rowCount() > 0, 'state remains until safe unload')
    await object.disconnect({})
    assert.equal(fake.rowCount(), 0)
  } finally {
    PageDocumentService.prototype.updateDescriptionBinary = async (_pageId, data) => {
      if (calls.failing) throw new Error('D1 unavailable')
      calls.stores++
      calls.lastHtml = data.description_html
    }
  }
})

test('force close restores hibernated state, flushes it and closes hibernated sockets', async () => {
  calls.failing = false
  calls.stores = 0
  const { fake } = await createObject()
  const closed: { code: number; reason: string }[] = []
  let attachment = { userId: 1, workspaceSlug: 'acme', projectId: 2, pageId: 7, userName: 'User', readOnly: false, authenticated: true, awarenessIds: [] }
  const socket = {
    deserializeAttachment: () => attachment,
    serializeAttachment: (next: typeof attachment) => { attachment = next },
    send: () => {},
    close: (code: number, reason: string) => { closed.push({ code, reason }) }
  }
  fake.setSockets([socket])
  const { CollaborationDO } = await import('../src/server/live/collaboration-do')
  const resumed = new CollaborationDO(fake.ctx as never, { DB: {} } as never) as unknown as Internals
  const response = await resumed.fetch(new Request('https://live.internal/force-close', {
    method: 'POST', body: JSON.stringify({ page_id: 7, reason: 'admin_request', code: 4000 })
  }))
  assert.equal(response.status, 204)
  assert.equal(calls.stores, 1)
  assert.match(calls.lastHtml, /edited/)
  assert.ok(closed.some(item => item.code === 4000))
  assert.equal(fake.rowCount(), 0)
  assert.equal(resumed.document, null)
})

test('force close does not overwrite an external edit with a clean hibernated snapshot', async () => {
  const fake = fakeContext()
  fake.kv.set('meta', { pageId: 7 })
  fake.kv.set('editor', { userId: 1, workspaceSlug: 'acme', projectId: 2 })
  let databaseHtml = '<p>initial</p>'
  let writes = 0
  PageDocumentService.prototype.fetchDescriptionBinary = async () => getBinaryDataFromHtml(databaseHtml, 'Title')
  PageDocumentService.prototype.updateDescriptionBinary = async (_pageId, data) => {
    writes++
    databaseHtml = data.description_html
  }
  try {
    const { CollaborationDO } = await import('../src/server/live/collaboration-do')
    const initial = new CollaborationDO(fake.ctx as never, { DB: {} } as never) as unknown as Internals
    await initial.loadDocument()
    assert.equal(fake.kv.get('dirty'), false)
    databaseHtml = '<p>edited through REST</p>'
    const resumed = new CollaborationDO(fake.ctx as never, { DB: {} } as never) as unknown as Internals
    const response = await resumed.fetch(new Request('https://live.internal/force-close', {
      method: 'POST', body: JSON.stringify({ page_id: 7, reason: 'admin_request', code: 4000 })
    }))
    assert.equal(response.status, 204)
    assert.equal(writes, 0)
    assert.equal(databaseHtml, '<p>edited through REST</p>')
    assert.equal(fake.rowCount(), 0)
  } finally {
    PageDocumentService.prototype.fetchDescriptionBinary = async () => getBinaryDataFromHtml('<p>hello</p>', 'Title')
    PageDocumentService.prototype.updateDescriptionBinary = async (_pageId, data) => {
      if (calls.failing) throw new Error('D1 unavailable')
      calls.stores++
      calls.lastHtml = data.description_html
    }
  }
})

test('unmarked legacy stored state is treated as unsaved after hibernation', async () => {
  calls.failing = false
  calls.stores = 0
  const { fake } = await createObject()
  fake.kv.delete('dirty')
  const { CollaborationDO } = await import('../src/server/live/collaboration-do')
  const resumed = new CollaborationDO(fake.ctx as never, { DB: {} } as never) as unknown as Internals
  await resumed.fetch(new Request('https://live.internal/force-close', {
    method: 'POST', body: JSON.stringify({ page_id: 7, reason: 'admin_request', code: 4000 })
  }))
  assert.equal(calls.stores, 1)
  assert.match(calls.lastHtml, /edited/)
})
