import { broadcastMessageToPage, createRealtimeEvent, type LiveInstance } from '@/server/collaboration/broadcast-message'
import { liveLog } from '@/server/collaboration/logger'

export type BroadcastErrorCode = 'content_too_large' | 'page_locked' | 'page_archived'

/** PD-2346: tell the clients of a page that loading or saving failed. */
export async function broadcastError(
  instance: LiveInstance,
  pageId: string,
  errorMessage: string,
  errorType: 'fetch' | 'store',
  context: { userId?: number | string; workspaceSlug?: string | null },
  errorCode?: BroadcastErrorCode,
  shouldDisconnect?: boolean
): Promise<void> {
  try {
    const userId = context.userId === undefined ? '' : String(context.userId)
    const event = createRealtimeEvent({
      action: 'error',
      page_id: pageId,
      descendants_ids: [],
      data: { error_message: errorMessage, error_type: errorType, error_code: errorCode, should_disconnect: shouldDisconnect, user_id: userId },
      workspace_slug: context.workspaceSlug || '',
      user_id: userId
    })
    await broadcastMessageToPage(instance, pageId, event)
  } catch (error) {
    liveLog('broadcast_error_failed', { pageId, message: String(error) }, 'error')
  }
}
