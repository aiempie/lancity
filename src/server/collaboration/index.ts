import { TitleSyncExtension } from '@/server/collaboration/title-sync'
import type { TitleSaver } from '@/server/collaboration/title-update-manager'

/**
 * PD-2076 `getExtensions`: Plane registered Logger, Database, Redis, TitleSync and ForceCloseHandler. Here the database
 * and force close handler are called by `CollaborationDO`, the logger is `liveLog`, Redis does not exist, and the title
 * sync is the one real extension left.
 */
export function getExtensions(deps: { save: TitleSaver; fetchName: () => Promise<string | null> }) {
  return { titleSync: new TitleSyncExtension(deps.save, deps.fetchName) }
}

export * from '@/server/collaboration/admin-commands'
export { AppError } from '@/server/collaboration/errors'
export { convertDocument, getPageService, PageDocumentService } from '@/server/collaboration/document'
export { broadcastToLivePage, forceCloseLivePage } from '@/server/collaboration/runtime'
