import { and, eq, isNull } from 'drizzle-orm'
import { pageVersions } from '@/db/schema/content'
import { ServiceError } from '@/server/common/errors'
import { requirePageAccess } from '@/server/page/service'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

/**
 * PD-0732: one page version with the stored HTML, JSON and base64 Yjs state (PageVersionDetailSerializer).
 * The version is scoped to the page, and the page to an active link with the project in the URL.
 */
export async function getPageVersion(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  pageId: number,
  versionId: number
) {
  await requirePageAccess(db, actor, slug, projectId, pageId)
  const [version] = await db
    .select()
    .from(pageVersions)
    .where(and(eq(pageVersions.id, versionId), eq(pageVersions.pageId, pageId), isNull(pageVersions.deletedAt)))
  if (!version) throw new ServiceError(404, 'VERSION_NOT_FOUND', 'Page version not found')
  return {
    id: version.id,
    pageId: version.pageId,
    workspaceId: version.workspaceId,
    ownedById: version.ownedById,
    lastSavedAt: version.lastSavedAt,
    descriptionHtml: version.descriptionHtml,
    descriptionText: version.descriptionStripped,
    descriptionJson: version.descriptionJson,
    descriptionBinary: version.descriptionBinary ? Buffer.from(version.descriptionBinary).toString('base64') : null,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
    createdById: version.createdById,
    updatedById: version.updatedById
  }
}
