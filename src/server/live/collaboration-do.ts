import { DurableObject } from 'cloudflare:workers'
import * as Y from 'yjs'
import { getDb } from '@/db/client'
import { checkAuthToken } from '@/server/collaboration/access'
import { CloseCode, ForceCloseReason } from '@/server/collaboration/admin-commands'
import { PageDocumentService } from '@/server/collaboration/document'
import { AppError } from '@/server/collaboration/errors'
import { forceCloseDocumentAcrossServers } from '@/server/collaboration/force-close-handler'
import { CloseEvents, CollaborationConnection, CollaborationDocument, messages, readAuthToken } from '@/server/collaboration/hocuspocus'
import { liveLog } from '@/server/collaboration/logger'
import { fetchDocument, storeDocument } from '@/server/collaboration/persistence'
import { drainCollaborationServer, type DrainTarget, type LiveEnv } from '@/server/collaboration/runtime'
import { onStateless } from '@/server/collaboration/stateless'
import { TitleSyncExtension } from '@/server/collaboration/title-sync'
import {
  forceCloseBodySchema,
  liveContextHeaders,
  type ForceCloseBody,
  type LiveConnectionContext
} from '@/types/content/p4-live-schema'

/** Largest value written to one Durable Object SQLite row (the limit is 2 MB). */
const MAX_ROW_BYTES = 1_500_000
/** Number of stored updates after which they are folded into one snapshot. */
const COMPACT_AFTER = 100
/** Hocuspocus `debounce`: the database is written at most this often while a page is being edited. */
const STORE_DEBOUNCE_MS = 10_000
/** Retry delay after a failed save: 10 s doubling per failure, capped at one hour. Saves are retried without a count limit. */
const MAX_RETRY_MS = 60 * 60 * 1000
/** Unsaved state is kept in the object this long after the first failed save, then dropped with an error log. */
const MAX_KEEP_UNSAVED_MS = 14 * 24 * 60 * 60 * 1000
const MAX_CONNECTIONS = 200
/** Transaction origin of the state read when the document loads. It is not a change and is not stored again. */
const LOAD_ORIGIN = 'live-load'

type Meta = { pageId: number }
type Writer = Pick<LiveConnectionContext, 'userId' | 'workspaceSlug' | 'projectId'>

const toBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

/**
 * One Durable Object per page replaces a Hocuspocus server and its Redis (PD-2119 to PD-2123, PD-2243 to PD-2257).
 *
 * - WebSockets use the Hibernation API: an idle page costs nothing and the document is rebuilt on the next message.
 * - Unsaved changes are written to the object's SQLite storage as they arrive, so they survive eviction. The page row in D1
 *   is written by an alarm at most every 10 seconds and on the last disconnect, through the page service of the user who
 *   last edited (so lock, archive and permission rules still apply).
 * - The Worker authorizes every connection and passes the user and page context in trusted headers. The Durable Object
 *   is only reachable through that binding.
 */
export class CollaborationDO extends DurableObject<LiveEnv> {
  private document: CollaborationDocument | null = null
  private loading: Promise<CollaborationDocument> | null = null
  private unloading: Promise<void> | null = null
  private titleSync: TitleSyncExtension | null = null
  private connections = new Map<WebSocket, CollaborationConnection>()
  private version = 0
  private savedVersion = -1
  private updateCount = 0
  private storePromise: Promise<boolean> | null = null
  private closingCount = 0
  private editor: Writer | null = null

  /** The instance seen by the force close and drain helpers. Kept separate so no helper becomes a public RPC method. */
  private readonly target: DrainTarget

  constructor(ctx: DurableObjectState, env: LiveEnv) {
    super(ctx, env)
    const current = () => this.document
    this.target = {
      get document() {
        return current()
      },
      unload: () => this.unloadAfterSave(),
      persist: async () => {
        await this.storeNow()
      },
      closeAllConnections: (code, reason) => this.document?.closeConnections(code, reason)
    }
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS yjs_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL)')
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS yjs_snapshot (part INTEGER PRIMARY KEY, data BLOB NOT NULL)')
    })
  }

  // ------------------------------------------------------------------ HTTP (only reachable through the binding)

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/socket') return this.acceptSocket(request)
    if (request.method === 'GET' && url.pathname === '/health')
      return Response.json({ status: 'OK', loaded: this.document !== null, connections: this.ctx.getWebSockets().length })
    if (request.method !== 'POST') return new Response('Not found', { status: 404 })
    if (url.pathname === '/force-close') {
      const body = this.parseForceClose(await request.json().catch(() => null))
      if (!body) return new Response('Invalid body', { status: 400 })
      this.closingCount++
      try {
        // Hibernation discards memory, but leaves both the sockets and unsaved state in storage.
        if (!this.document && (this.hasStoredState() || this.ctx.getWebSockets().length > 0)) {
          try {
            await this.loadDocument()
          } catch (error) {
            liveLog('force_close_load_failed', { pageId: body.page_id, message: String(error) }, 'error')
            if (this.hasStoredState()) await this.scheduleRetry()
          }
        }
        await forceCloseDocumentAcrossServers(this.target, String(body.page_id), body.reason as ForceCloseReason, body.code as CloseCode)
      } finally {
        // Also close unauthenticated sockets and sockets that could not be reattached.
        for (const socket of this.ctx.getWebSockets()) {
          try { socket.close(body.code, body.reason) } catch { /* Already closed. */ }
        }
        this.closingCount--
      }
      return new Response(null, { status: 204 })
    }
    if (url.pathname === '/broadcast') {
      this.document?.broadcastStateless(await request.text())
      return new Response(null, { status: 204 })
    }
    if (url.pathname === '/drain') {
      await drainCollaborationServer(this.target)
      return new Response(null, { status: 204 })
    }
    return new Response('Not found', { status: 404 })
  }

  private parseForceClose(raw: unknown): ForceCloseBody | null {
    const parsed = forceCloseBodySchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  }

  /** PD-2044: accept a socket the Worker has already authorized. The user must still prove the token in the first message. */
  private acceptSocket(request: Request): Response {
    if (this.closingCount > 0) return new Response('Document is closing', { status: 503 })
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket upgrade', { status: 426 })
    if (this.ctx.getWebSockets().length >= MAX_CONNECTIONS) return new Response('Too many connections', { status: 503 })
    const header = (name: string) => request.headers.get(name) ?? ''
    const userId = Number(header(liveContextHeaders.userId))
    const pageId = Number(header(liveContextHeaders.pageId))
    const projectId = Number(header(liveContextHeaders.projectId))
    if (!Number.isInteger(userId) || !Number.isInteger(pageId) || !Number.isInteger(projectId) || userId < 1 || pageId < 1)
      return new Response('Missing context', { status: 400 })
    const context: LiveConnectionContext = {
      userId,
      pageId,
      projectId,
      userName: decodeURIComponent(header(liveContextHeaders.userName)).slice(0, 100),
      workspaceSlug: decodeURIComponent(header(liveContextHeaders.workspaceSlug)).slice(0, 255),
      readOnly: header(liveContextHeaders.readOnly) === '1',
      authenticated: false,
      awarenessIds: []
    }
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment(context)
    this.ctx.storage.kv.put('meta', { pageId } satisfies Meta)
    return new Response(null, { status: 101, webSocket: client })
  }

  // ------------------------------------------------------------------ WebSocket (Hibernation API)

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (this.closingCount > 0) return
    if (typeof message === 'string') {
      ws.close(CloseCode.UNSUPPORTED_DATA, 'binary messages only')
      return
    }
    const data = new Uint8Array(message)
    const context = ws.deserializeAttachment() as LiveConnectionContext
    try {
      if (!context.authenticated) return await this.authenticate(ws, context, data)
      const document = await this.loadDocument()
      if (this.closingCount > 0) return
      document.handleMessage(this.connectionFor(ws, document), data)
    } catch (error) {
      liveLog('message_failed', { pageId: context.pageId, message: AppError.from(error).message }, 'error')
      try {
        ws.close(CloseCode.INTERNAL_ERROR, 'Internal server error')
      } catch {
        // Already closed.
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code >= 1000 && code !== 1005 && code !== 1006 && code !== 1015 ? code : 1000)
    } catch {
      // Already closed.
    }
    await this.disconnect(ws)
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    liveLog('socket_error', { message: String(error) }, 'error')
    await this.disconnect(ws)
  }

  /** PD-2125 to PD-2127: check the token in the first message, then answer `Authenticated` and attach to the document. */
  private async authenticate(ws: WebSocket, context: LiveConnectionContext, data: Uint8Array): Promise<void> {
    const auth = readAuthToken(data)
    if (!auth) return
    try {
      if (auth.documentName !== String(context.pageId)) throw new AppError('Invalid document', { code: 'AUTH_INVALID_DOCUMENT' })
      checkAuthToken(auth.token, context.userId)
    } catch (error) {
      ws.send(messages.permissionDenied(auth.documentName, AppError.from(error).code ?? 'permission-denied'))
      ws.close(CloseEvents.Forbidden.code, CloseEvents.Forbidden.reason)
      return
    }
    ws.serializeAttachment({ ...context, authenticated: true })
    ws.send(messages.authenticated(auth.documentName, context.readOnly))
    const document = await this.loadDocument()
    if (this.closingCount === 0) this.connectionFor(ws, document)
  }

  /** The connection object of a socket, rebuilt from the attachment after hibernation. */
  private connectionFor(ws: WebSocket, document: CollaborationDocument, sendAwareness = true): CollaborationConnection {
    let connection = this.connections.get(ws)
    if (connection) return connection
    const context = ws.deserializeAttachment() as LiveConnectionContext
    connection = new CollaborationConnection(
      { send: data => ws.send(data), close: (code, reason) => ws.close(code, reason) },
      context,
      next => ws.serializeAttachment(next)
    )
    this.connections.set(ws, connection)
    document.addConnection(connection, sendAwareness)
    return connection
  }

  /** Last client gone: save and unload so the next load reads whatever the REST API changed in between. */
  private async disconnect(ws: WebSocket): Promise<void> {
    const connection = this.connections.get(ws)
    this.connections.delete(ws)
    const document = this.document
    if (connection && document) document.removeConnection(connection)
    if (!document || document.connections.size > 0 || this.ctx.getWebSockets().some(socket => socket !== ws && this.isAuthenticated(socket)))
      return
    // A pending alarm means unsaved changes. When the save fails the document stays loaded and the alarm retries it.
    if ((await this.ctx.storage.getAlarm()) !== null && !(await this.storeNow())) return
    if (this.document && this.document.connections.size === 0) await this.unload({ discardStorage: true })
  }

  private isAuthenticated(ws: WebSocket) {
    return (ws.deserializeAttachment() as LiveConnectionContext | null)?.authenticated === true
  }

  // ------------------------------------------------------------------ document lifecycle

  private async loadDocument(): Promise<CollaborationDocument> {
    if (this.unloading) await this.unloading
    if (this.document) return this.document
    this.loading ??= this.createDocument().finally(() => {
      this.loading = null
    })
    return this.loading
  }

  private service(writer: Writer) {
    return new PageDocumentService(getDb(this.env.DB), {
      userId: writer.userId,
      workspaceSlug: writer.workspaceSlug,
      projectId: writer.projectId
    })
  }

  /** The user the page is read and saved as: the last editor, else any authenticated connection. */
  private writer(): Writer | null {
    if (this.editor) return this.editor
    const stored = this.ctx.storage.kv.get<Writer>('editor')
    if (stored) return (this.editor = stored)
    for (const ws of this.ctx.getWebSockets()) {
      const context = ws.deserializeAttachment() as LiveConnectionContext | null
      if (context?.authenticated) return context
    }
    return null
  }

  private async createDocument(): Promise<CollaborationDocument> {
    const meta = this.ctx.storage.kv.get<Meta>('meta')
    const writer = this.writer()
    if (!meta || !writer) throw new AppError('Document context missing', { code: 'LIVE_CONTEXT_MISSING' })
    const pageId = meta.pageId
    const document: CollaborationDocument = new CollaborationDocument(String(pageId), {
      onUpdate: (update, origin) => this.onUpdate(document, update, origin),
      onStateless: (connection, payload) => onStateless(document, connection, payload)
    })
    const service = this.service(writer)
    let state = this.readStoredState()
    const fromDatabase = state === null
    // A missing marker is legacy state and may contain unsaved edits.
    this.savedVersion = fromDatabase || this.ctx.storage.kv.get<boolean>('dirty') === false ? this.version : -1
    state ??= await fetchDocument(service, this.target, pageId, writer)
    Y.applyUpdate(document.doc, state, LOAD_ORIGIN)
    if (fromDatabase) this.writeSnapshot(document.doc, true)

    // PD-2076: the extensions Plane registered are the title sync (the others are Redis and logging, replaced here).
    this.titleSync = new TitleSyncExtension(
      (title, context, signal) => this.service(context).updatePageProperties(pageId, { data: { name: title }, abortSignal: signal }),
      async () => (await service.fetchDetails(pageId)).name
    )
    await this.titleSync.onLoadDocument(document)
    this.titleSync.afterLoadDocument(document)
    this.document = document
    // After hibernation the sockets are still open: reattach the authenticated ones.
    for (const ws of this.ctx.getWebSockets()) if (this.isAuthenticated(ws)) this.connectionFor(ws, document, false)
    liveLog('document_loaded', { pageId, source: fromDatabase ? 'database' : 'storage', bytes: state.byteLength })
    return document
  }

  /**
   * Save, then unload. The stored copy is dropped only when the save succeeded; otherwise it stays in the object and the
   * alarm keeps retrying. Used by force close and drain, so edits inside the debounce window are not lost.
   */
  private async unloadAfterSave(): Promise<void> {
    if (!this.document) return
    const saved = await this.storeNow()
    await this.unload({ discardStorage: saved })
  }

  /** Release the document from memory. The Durable Object storage is cleared only with `discardStorage`. */
  private async unload(options: { discardStorage?: boolean; abandon?: boolean } = {}): Promise<void> {
    const document = this.document
    if (!document) return
    const version = this.version
    this.unloading = (async () => {
      try {
        await this.titleSync?.beforeUnloadDocument()
      } catch (error) {
        liveLog('title_flush_failed', { message: String(error) }, 'error')
      }
      // An edit or a new connection can arrive while the title flush is in flight.
      if (this.version !== version || (options.discardStorage && !options.abandon && this.savedVersion !== this.version) || (this.closingCount === 0 && document.connections.size > 0)) {
        if (options.discardStorage && !options.abandon && this.savedVersion !== this.version) await this.scheduleStore()
        return
      }
      this.titleSync?.afterUnloadDocument()
      this.titleSync = null
      document.closeConnections(CloseCode.NORMAL, 'Document unloaded')
      document.destroy()
      this.document = null
      this.connections.clear()
      this.editor = null
      if (options.discardStorage) {
        this.clearStorage()
        await this.ctx.storage.deleteAlarm()
      }
    })().finally(() => {
      this.unloading = null
    })
    await this.unloading
  }

  // ------------------------------------------------------------------ persistence

  private onUpdate(document: CollaborationDocument, update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return
    this.version++
    // Mark dirty before persisting the update so eviction cannot mistake it for a clean cache.
    this.ctx.storage.kv.put('dirty', true)
    this.appendUpdate(document, update)
    if (origin instanceof CollaborationConnection && this.editor?.userId !== origin.context.userId) {
      const { userId, workspaceSlug, projectId } = origin.context
      this.editor = { userId, workspaceSlug, projectId }
      this.ctx.storage.kv.put('editor', this.editor)
    }
    void this.scheduleStore()
  }

  private async scheduleStore(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + STORE_DEBOUNCE_MS)
  }

  /**
   * PD-2062: write the database now. Returns true when the state is saved (or there is nothing to save) and false when
   * the write failed. A failed save keeps the state in the object storage and schedules a retry with backoff.
   */
  private async storeNow(): Promise<boolean> {
    if (this.storePromise) return this.storePromise
    const promise = this.storeUntilCurrent()
    this.storePromise = promise
    try {
      return await promise
    } finally {
      if (this.storePromise === promise) this.storePromise = null
    }
  }

  private async storeUntilCurrent(): Promise<boolean> {
    while (true) {
      const version = this.version
      if (!(await this.storeVersion())) return false
      if (this.version === version) return true
    }
  }

  private async storeVersion(): Promise<boolean> {
    const document = this.document
    if (!document) return true
    if (this.savedVersion === this.version && this.ctx.storage.kv.get<boolean>('dirty') === false) {
      const version = this.version
      await this.ctx.storage.deleteAlarm()
      if (this.version !== version) await this.scheduleStore()
      return true
    }
    const writer = this.writer()
    if (!writer) {
      liveLog('store_no_writer', { pageId: document.name }, 'error')
      await this.scheduleRetry()
      return false
    }
    const version = this.version
    const state = Y.encodeStateAsUpdate(document.doc)
    try {
      await storeDocument(this.service(writer), this.target, Number(document.name), state, writer)
    } catch (error) {
      liveLog('store_failed', { pageId: document.name, message: AppError.from(error).message, status: AppError.from(error).statusCode }, 'error')
      await this.scheduleRetry()
      return false
    }
    this.savedVersion = version
    if (this.version === version) this.ctx.storage.kv.put('dirty', false)
    this.ctx.storage.kv.delete('failure')
    if (this.document && this.version !== version) await this.ctx.storage.setAlarm(Date.now() + STORE_DEBOUNCE_MS)
    else {
      await this.ctx.storage.deleteAlarm()
      // An update may have arrived while the alarm deletion was in flight.
      if (this.document && this.version !== version) await this.scheduleStore()
    }
    return true
  }

  /** Retry a failed save later, doubling the delay with each failure. Never gives up while the state is within the keep window. */
  private async scheduleRetry(): Promise<void> {
    const now = Date.now()
    const previous = this.ctx.storage.kv.get<{ count: number; since: number }>('failure')
    const failure = { count: (previous?.count ?? 0) + 1, since: previous?.since ?? now }
    this.ctx.storage.kv.put('failure', failure)
    const delay = Math.min(STORE_DEBOUNCE_MS * 2 ** Math.min(failure.count - 1, 12), MAX_RETRY_MS)
    await this.ctx.storage.setAlarm(now + delay)
  }

  /** True once unsaved state has been failing to save for longer than the keep window. */
  private keepWindowExpired(): boolean {
    const failure = this.ctx.storage.kv.get<{ count: number; since: number }>('failure')
    return !!failure && Date.now() - failure.since > MAX_KEEP_UNSAVED_MS
  }

  async alarm(): Promise<void> {
    if (!this.document) {
      if (!this.hasStoredState()) return
      try {
        await this.loadDocument()
      } catch (error) {
        // For example the page is gone or the writer lost access. The stored copy stays until it can be saved.
        liveLog('alarm_load_failed', { message: AppError.from(error).message }, 'error')
        await this.scheduleRetry()
        if (this.keepWindowExpired()) await this.abandonStoredState()
        return
      }
    }
    if (await this.storeNow()) {
      if (this.document && this.document.connections.size === 0 && (await this.ctx.storage.getAlarm()) === null)
        await this.unload({ discardStorage: true })
      return
    }
    if (this.keepWindowExpired()) await this.abandonStoredState()
  }

  private async abandonStoredState(): Promise<void> {
    liveLog('store_abandoned', { pageId: this.document?.name, keptDays: MAX_KEEP_UNSAVED_MS / 86_400_000 }, 'error')
    if (this.document) await this.unload({ discardStorage: true, abandon: true })
    else {
      this.clearStorage()
      await this.ctx.storage.deleteAlarm()
    }
  }

  private appendUpdate(document: CollaborationDocument, update: Uint8Array): void {
    if (update.byteLength > MAX_ROW_BYTES || this.updateCount >= COMPACT_AFTER) {
      this.writeSnapshot(document.doc)
      return
    }
    this.ctx.storage.sql.exec('INSERT INTO yjs_updates (data) VALUES (?)', toBuffer(update))
    this.updateCount++
  }

  /** Replace the stored updates with one snapshot, split into rows below the SQLite row limit. */
  private writeSnapshot(doc: Y.Doc, clean = false): void {
    const state = Y.encodeStateAsUpdate(doc)
    this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql
      sql.exec('DELETE FROM yjs_updates')
      sql.exec('DELETE FROM yjs_snapshot')
      if (clean) this.ctx.storage.kv.put('dirty', false)
      for (let part = 0, offset = 0; offset < state.byteLength || part === 0; part++, offset += MAX_ROW_BYTES)
        sql.exec('INSERT INTO yjs_snapshot (part, data) VALUES (?, ?)', part, toBuffer(state.subarray(offset, offset + MAX_ROW_BYTES)))
    })
    this.updateCount = 0
  }

  private hasStoredState(): boolean {
    return this.ctx.storage.sql.exec('SELECT 1 FROM yjs_snapshot LIMIT 1').toArray().length > 0
  }

  /** State kept in the object from an earlier session, or null when the page must be read from the database. */
  private readStoredState(): Uint8Array | null {
    const sql = this.ctx.storage.sql
    const snapshotParts = sql.exec<{ data: ArrayBuffer }>('SELECT data FROM yjs_snapshot ORDER BY part').toArray()
    const updates = sql.exec<{ data: ArrayBuffer }>('SELECT data FROM yjs_updates ORDER BY id').toArray()
    if (!snapshotParts.length && !updates.length) return null
    const snapshot = new Uint8Array(snapshotParts.reduce((total, row) => total + row.data.byteLength, 0))
    let offset = 0
    for (const row of snapshotParts) {
      snapshot.set(new Uint8Array(row.data), offset)
      offset += row.data.byteLength
    }
    this.updateCount = updates.length
    return Y.mergeUpdates([...(snapshot.byteLength ? [snapshot] : []), ...updates.map(row => new Uint8Array(row.data))])
  }

  private clearStorage(): void {
    this.ctx.storage.sql.exec('DELETE FROM yjs_updates')
    this.ctx.storage.sql.exec('DELETE FROM yjs_snapshot')
    this.ctx.storage.kv.delete('editor')
    this.ctx.storage.kv.delete('dirty')
    this.ctx.storage.kv.delete('failure')
    this.updateCount = 0
  }
}
