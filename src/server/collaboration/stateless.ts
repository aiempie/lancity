import type { CollaborationConnection, CollaborationDocument } from '@/server/collaboration/hocuspocus'

/** Plane `DocumentCollaborativeEvents`: the server event a client sends and the client event it is turned into. */
export const DocumentCollaborativeEvents = {
  lock: 'locked',
  unlock: 'unlocked',
  archive: 'archived',
  unarchive: 'unarchived',
  'make-public': 'made-public',
  'make-private': 'made-private',
  delete: 'deleted',
  move: 'moved',
  duplicate: 'duplicated',
  property_update: 'property_updated',
  restore: 'restored',
  error: 'error'
} as const satisfies Record<string, string>

/**
 * PD-2216: broadcast the client event to all the clients so they can update their state. A read-only connection may
 * not announce page events to the other clients.
 */
export function onStateless(document: CollaborationDocument, connection: CollaborationConnection, payload: string): void {
  const response = Object.hasOwn(DocumentCollaborativeEvents, payload)
    ? DocumentCollaborativeEvents[payload as keyof typeof DocumentCollaborativeEvents]
    : undefined
  if (response && !connection.readOnly) document.broadcastStateless(response)
}
