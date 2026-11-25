import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import type { LiveConnectionContext } from '@/types/content/p4-live-schema'

/**
 * Minimal Hocuspocus v3 wire protocol on top of `yjs` and `y-protocols` (PD-2119 to PD-2123, PD-2043 to PD-2045).
 * The Plane editor connects with `HocuspocusProvider`, so message framing must match: every message starts with the
 * document name, then the message type. No Node-only library is needed.
 */
export enum MessageType {
  Sync = 0,
  Awareness = 1,
  Auth = 2,
  QueryAwareness = 3,
  SyncReply = 4,
  Stateless = 5,
  BroadcastStateless = 6,
  CLOSE = 7,
  SyncStatus = 8
}

/** Auth sub-types (`@hocuspocus/common` `AuthMessageType`). */
export enum AuthMessageType {
  Token = 0,
  PermissionDenied = 1,
  Authenticated = 2
}

/** Hocuspocus close events: `Unauthorized` and `Forbidden` are what the provider expects on a refused connection. */
export const CloseEvents = {
  Unauthorized: { code: 4401, reason: 'Unauthorized' },
  Forbidden: { code: 4403, reason: 'Forbidden' },
  ResetConnection: { code: 4205, reason: 'Reset Connection' }
} as const

export interface LiveSocket {
  send(data: Uint8Array): void
  close(code: number, reason: string): void
}

// ------------------------------------------------------------------ outgoing messages

function frame(documentName: string, type: MessageType, write?: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarString(encoder, documentName)
  encoding.writeVarUint(encoder, type)
  write?.(encoder)
  return encoding.toUint8Array(encoder)
}

export const messages = {
  authenticated: (name: string, readOnly: boolean) =>
    frame(name, MessageType.Auth, e => {
      encoding.writeVarUint(e, AuthMessageType.Authenticated)
      encoding.writeVarString(e, readOnly ? 'readonly' : 'read-write')
    }),
  permissionDenied: (name: string, reason: string) =>
    frame(name, MessageType.Auth, e => {
      encoding.writeVarUint(e, AuthMessageType.PermissionDenied)
      encoding.writeVarString(e, reason)
    }),
  syncStep1: (name: string, doc: Y.Doc) => frame(name, MessageType.Sync, e => syncProtocol.writeSyncStep1(e, doc)),
  update: (name: string, update: Uint8Array) => frame(name, MessageType.Sync, e => syncProtocol.writeUpdate(e, update)),
  awareness: (name: string, awareness: awarenessProtocol.Awareness, clients?: number[]) =>
    frame(name, MessageType.Awareness, e =>
      encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(awareness, clients ?? [...awareness.getStates().keys()]))
    ),
  stateless: (name: string, payload: string) => frame(name, MessageType.Stateless, e => encoding.writeVarString(e, payload)),
  syncStatus: (name: string, saved: boolean) => frame(name, MessageType.SyncStatus, e => encoding.writeVarUint(e, saved ? 1 : 0)),
  close: (name: string, reason: string) => frame(name, MessageType.CLOSE, e => encoding.writeVarString(e, reason))
}

/** Read the document name and message type, for the Worker or tests that need to peek at a frame. */
export function readFrameHeader(data: Uint8Array): { documentName: string; type: number; decoder: decoding.Decoder } {
  const decoder = decoding.createDecoder(data)
  const documentName = decoding.readVarString(decoder)
  return { documentName, type: decoding.readVarUint(decoder), decoder }
}

// ------------------------------------------------------------------ connection and document

/** One client socket attached to a document. `context` is persisted by the owner when it changes. */
export class CollaborationConnection {
  constructor(
    readonly socket: LiveSocket,
    public context: LiveConnectionContext,
    private readonly persistContext: (context: LiveConnectionContext) => void = () => undefined
  ) {}

  get readOnly() {
    return this.context.readOnly
  }

  send(data: Uint8Array) {
    try {
      this.socket.send(data)
    } catch {
      // A closed socket is removed by its close event.
    }
  }

  update(patch: Partial<LiveConnectionContext>) {
    this.context = { ...this.context, ...patch }
    this.persistContext(this.context)
  }
}

export type DocumentHooks = {
  /** Called after every applied update. `origin` is the connection that sent it, or null. */
  onUpdate?: (update: Uint8Array, origin: unknown) => void
  /** PD-2216: a client sent a stateless message. */
  onStateless?: (connection: CollaborationConnection, payload: string) => void
}

/** The server side of one Yjs document: state, awareness and connected clients (Hocuspocus `Document`). */
export class CollaborationDocument {
  readonly doc = new Y.Doc()
  readonly awareness: awarenessProtocol.Awareness
  readonly connections = new Set<CollaborationConnection>()

  constructor(
    readonly name: string,
    private readonly hooks: DocumentHooks = {}
  ) {
    this.awareness = new awarenessProtocol.Awareness(this.doc)
    this.awareness.setLocalState(null)
    // The outdated-state timer would keep a hibernating Durable Object awake; states are removed on disconnect instead.
    clearInterval((this.awareness as unknown as { _checkInterval: ReturnType<typeof setInterval> })._checkInterval)
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      for (const connection of this.connections) if (connection !== origin) connection.send(messages.update(this.name, update))
      this.hooks.onUpdate?.(update, origin)
    })
    this.awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        if (origin instanceof CollaborationConnection) {
          const ids = new Set(origin.context.awarenessIds)
          added.forEach(id => ids.add(id))
          removed.forEach(id => ids.delete(id))
          origin.update({ awarenessIds: [...ids] })
        }
        const message = messages.awareness(this.name, this.awareness, [...added, ...updated, ...removed])
        for (const connection of this.connections) connection.send(message)
      }
    )
  }

  /** Hocuspocus `Document.isEmpty`: true when the field holds no content. */
  isEmpty(field: string): boolean {
    return this.doc.getXmlFragment(field).length === 0
  }

  addConnection(connection: CollaborationConnection, sendAwareness = true) {
    this.connections.add(connection)
    if (sendAwareness && this.awareness.getStates().size) connection.send(messages.awareness(this.name, this.awareness))
  }

  /** Remove a client and drop the awareness states it controlled. */
  removeConnection(connection: CollaborationConnection) {
    if (!this.connections.delete(connection)) return
    awarenessProtocol.removeAwarenessStates(this.awareness, connection.context.awarenessIds, null)
  }

  broadcastStateless(payload: string) {
    const message = messages.stateless(this.name, payload)
    for (const connection of this.connections) connection.send(message)
  }

  /** PD-2045: handle one frame from an authenticated client (Hocuspocus `MessageReceiver.apply`). */
  handleMessage(connection: CollaborationConnection, data: Uint8Array) {
    const { documentName, type, decoder } = readFrameHeader(data)
    if (documentName !== this.name) return
    switch (type) {
      case MessageType.Sync:
      case MessageType.SyncReply:
        this.readSyncMessage(connection, decoder)
        break
      case MessageType.Awareness:
        // A read-only client may still announce its cursor, like in Hocuspocus.
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), connection)
        break
      case MessageType.QueryAwareness:
        connection.send(messages.awareness(this.name, this.awareness))
        break
      case MessageType.Stateless:
        this.hooks.onStateless?.(connection, decoding.readVarString(decoder))
        break
      case MessageType.BroadcastStateless:
        // Same rule as the stateless hook: a read-only connection may not announce events to the other clients.
        if (!connection.readOnly) this.broadcastStateless(decoding.readVarString(decoder))
        break
      case MessageType.CLOSE:
        connection.socket.close(1000, 'provider_initiated')
        break
      default:
        break
    }
  }

  private readSyncMessage(connection: CollaborationConnection, decoder: decoding.Decoder) {
    const syncType = decoding.readVarUint(decoder)
    switch (syncType) {
      case syncProtocol.messageYjsSyncStep1: {
        // Reply with SyncStep2, then ask for the client state with our own SyncStep1.
        const encoder = encoding.createEncoder()
        encoding.writeVarString(encoder, this.name)
        encoding.writeVarUint(encoder, MessageType.Sync)
        syncProtocol.readSyncStep1(decoder, encoder, this.doc)
        connection.send(encoding.toUint8Array(encoder))
        connection.send(messages.syncStep1(this.name, this.doc))
        break
      }
      case syncProtocol.messageYjsSyncStep2:
      case syncProtocol.messageYjsUpdate: {
        if (connection.readOnly) {
          const update = decoding.readVarUint8Array(decoder)
          let known = false
          try {
            known = Y.snapshotContainsUpdate(Y.snapshot(this.doc), update)
          } catch {
            known = false
          }
          connection.send(messages.syncStatus(this.name, known))
          break
        }
        // Both messages carry one update after the type, which `readSyncStep2` applies.
        syncProtocol.readSyncStep2(decoder, this.doc, connection)
        connection.send(messages.syncStatus(this.name, true))
        break
      }
      default:
        throw new Error(`Received a sync message with an unknown type: ${syncType}`)
    }
  }

  /** Close every client with a Hocuspocus CLOSE frame, then the socket. */
  closeConnections(code: number, reason: string) {
    for (const connection of [...this.connections]) {
      connection.send(messages.close(this.name, reason))
      this.removeConnection(connection)
      try {
        connection.socket.close(code, reason.slice(0, 120))
      } catch {
        // Already closed.
      }
    }
  }

  destroy() {
    this.awareness.destroy()
    this.doc.destroy()
  }
}

/** PD-2127: parse the token the editor sends (`{ id, cookie? }`) and compare the user id to the authenticated one. */
export function readAuthToken(data: Uint8Array): { documentName: string; token: string } | null {
  const { documentName, type, decoder } = readFrameHeader(data)
  if (type !== MessageType.Auth || decoding.readVarUint(decoder) !== AuthMessageType.Token) return null
  return { documentName, token: decoding.readVarString(decoder) }
}
