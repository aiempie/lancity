import { liveLog } from '@/server/collaboration/logger'
import type { CollaborationDocument } from '@/server/collaboration/hocuspocus'
import type { RealtimeEvent } from '@/types/content/p4-live-schema'

/** The part of a running server that broadcast helpers need. In a Durable Object the instance is the object itself. */
export interface LiveInstance {
  document: CollaborationDocument | null
}

/** Plane editor `createRealtimeEvent`: the envelope every page event is wrapped in. */
export function createRealtimeEvent(opts: RealtimeEvent & { data: Record<string, unknown> }) {
  return {
    affectedPages: { currentPage: opts.page_id || '', parentPage: opts.parent_id || null, descendantPages: opts.descendants_ids || [] },
    workspace_slug: opts.workspace_slug,
    project_id: opts.project_id || '',
    teamspace_id: opts.teamspace_id || '',
    user_id: opts.user_id,
    timestamp: new Date().toISOString(),
    action: opts.action,
    data: opts.data
  }
}

/**
 * PD-2347, PD-2348: send an event to every client of a page. Redis pub/sub is not needed: all clients of a page are
 * connected to the same Durable Object, so the object broadcasts directly.
 */
export async function broadcastMessageToPage(instance: LiveInstance, documentName: string, eventData: unknown): Promise<boolean> {
  if (!instance.document) {
    liveLog('broadcast_unavailable', { documentName }, 'error')
    return false
  }
  try {
    instance.document.broadcastStateless(typeof eventData === 'string' ? eventData : JSON.stringify(eventData))
    return true
  } catch (error) {
    liveLog('broadcast_failed', { documentName, message: String(error) }, 'error')
    return false
  }
}
