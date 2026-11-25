import {
  AdminCommand,
  CloseCode,
  getForceCloseMessage,
  isForceCloseCommand,
  type AdminCommandData,
  type ClientForceCloseMessage,
  type ForceCloseCommandData,
  type ForceCloseReason
} from '@/server/collaboration/admin-commands'
import type { LiveInstance } from '@/server/collaboration/broadcast-message'
import { liveLog } from '@/server/collaboration/logger'

/** A running document that can be unloaded (flush title, drop memory and Durable Object storage). */
export interface ForceCloseTarget extends LiveInstance {
  unload(): Promise<void>
}

const MESSAGE_DELIVERY_MS = 50

/**
 * PD-2064 to PD-2069: the handler Plane registered on the Redis admin channel. Here the Durable Object calls it
 * directly, because every client of the page is connected to the same object.
 */
export async function handleForceCloseCommand(instance: ForceCloseTarget, data: AdminCommandData): Promise<void> {
  if (!isForceCloseCommand(data)) {
    liveLog('force_close_invalid_command', { command: (data as { command?: string }).command }, 'error')
    return
  }
  const { docId, reason, code } = data
  const document = instance.document
  // Not our document: ignore, like a server that does not hold it.
  if (!document) return
  const connectionCount = document.connections.size
  const message: ClientForceCloseMessage = {
    type: 'force_close',
    reason,
    code,
    message: getForceCloseMessage(reason),
    timestamp: new Date().toISOString()
  }
  // Step 1: tell every client first. Step 2: close the sockets after the messages had time to arrive.
  document.broadcastStateless(JSON.stringify(message))
  await new Promise(resolve => setTimeout(resolve, MESSAGE_DELIVERY_MS))
  document.closeConnections(code, reason)
  liveLog('force_close_connections_closed', { docId, connectionCount })
}

/**
 * PD-2070 to PD-2075: close all connections of a page, then unload the document. Plane also published the command to
 * other servers and waited 800 ms; with one Durable Object per page there are no other servers to notify.
 */
export async function forceCloseDocumentAcrossServers(
  instance: ForceCloseTarget,
  pageId: string,
  reason: ForceCloseReason,
  code: CloseCode = CloseCode.FORCE_CLOSE
): Promise<void> {
  if (!instance.document) {
    liveLog('force_close_already_unloaded', { pageId })
    return
  }
  const command: ForceCloseCommandData = {
    command: AdminCommand.FORCE_CLOSE,
    docId: pageId,
    reason,
    code,
    originServer: 'durable-object',
    timestamp: new Date().toISOString()
  }
  await handleForceCloseCommand(instance, command)
  try {
    await instance.unload()
  } catch (error) {
    liveLog('force_close_unload_failed', { pageId, message: String(error) }, 'error')
  }
  if (instance.document) liveLog('force_close_still_loaded', { pageId }, 'error')
  else liveLog('force_close_complete', { pageId })
}
