import {
  CollaborationConnection,
  CollaborationDocument,
  messages,
  readAuthToken
} from '@/server/collaboration/hocuspocus'
import type { LiveConnectionContext } from '@/types/content/p4-live-schema'

// Test harness: a Hocuspocus "server" inside the page. Each document frame gets its own provider and Y.Doc,
// like two users in two browsers, and they meet here instead of in the Durable Object. The document logic is the one of
// the Worker (`CollaborationDocument`), so sync, read-only and awareness behave the same.

const documents = new Map<string, CollaborationDocument>()

/** The local live document of a page (created when missing): tests seed and read it like the server state. */
export function getLocalLiveDocument(name: string) {
  return documentFor(name)
}

/** Drop the server copy of a page, like a Durable Object that unloaded it (tests of the IndexedDB cache). */
export function forgetLocalLiveDocument(name: string) {
  documents.get(name)?.destroy()
  documents.delete(name)
}

function documentFor(name: string) {
  let document = documents.get(name)
  if (!document) {
    document = new CollaborationDocument(name)
    documents.set(name, document)
  }
  return document
}

/** Browser `WebSocket` surface that the Hocuspocus provider uses, wired to `documents` instead of the network. */
export class LocalLiveSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  binaryType: BinaryType = 'arraybuffer'
  readyState = LocalLiveSocket.CONNECTING
  readonly url: string
  private connection: CollaborationConnection | null = null
  private document: CollaborationDocument | null = null

  constructor(url: string | URL) {
    super()
    this.url = String(url)
    setTimeout(() => {
      if (this.readyState !== LocalLiveSocket.CONNECTING) return
      this.readyState = LocalLiveSocket.OPEN
      this.dispatchEvent(new Event('open'))
    }, 0)
  }

  send(data: ArrayBufferLike | ArrayBufferView) {
    if (this.readyState !== LocalLiveSocket.OPEN) return
    const bytes = new Uint8Array(
      ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data
    )
    // Like the network: the server sees the frame after the current call stack.
    queueMicrotask(() => this.receive(bytes))
  }

  close(code = 1000, reason = '') {
    if (this.readyState === LocalLiveSocket.CLOSED) return
    this.readyState = LocalLiveSocket.CLOSED
    if (this.connection && this.document) this.document.removeConnection(this.connection)
    this.connection = null
    setTimeout(() => this.dispatchEvent(Object.assign(new Event('close'), { code, reason, wasClean: true })), 0)
  }

  /** Server side of one client frame (what the Durable Object does in `webSocketMessage`). */
  private receive(data: Uint8Array) {
    if (this.readyState !== LocalLiveSocket.OPEN) return
    if (this.connection && this.document) return this.document.handleMessage(this.connection, data)
    const auth = readAuthToken(data)
    if (!auth) return
    const user = JSON.parse(auth.token) as { id?: string; name?: string; readOnly?: boolean }
    const context: LiveConnectionContext = {
      userId: Number(user.id) || 1,
      userName: user.name ?? '',
      workspaceSlug: 'harness',
      projectId: 1,
      pageId: Number(auth.documentName) || 1,
      readOnly: Boolean(user.readOnly),
      authenticated: true,
      awarenessIds: []
    }
    this.document = documentFor(auth.documentName)
    this.connection = new CollaborationConnection(
      { send: frame => this.deliver(frame), close: (code, reason) => this.close(code, reason) },
      context
    )
    this.deliver(messages.authenticated(auth.documentName, context.readOnly))
    this.document.addConnection(this.connection)
  }

  /** Server to client. */
  private deliver(frame: Uint8Array) {
    const copy = frame.slice().buffer
    queueMicrotask(() => {
      if (this.readyState === LocalLiveSocket.OPEN) this.dispatchEvent(new MessageEvent('message', { data: copy }))
    })
  }
}
