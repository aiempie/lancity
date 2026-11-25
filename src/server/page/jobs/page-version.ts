import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { pageVersions, pages } from '@/db/schema/content'
import type { InfraEnv } from '@/server/common/env'
import { MAX_PAGE_VERSIONS, PAGE_VERSION_TASK_TIMEOUT } from '@/server/page/model-rules'
import type { PageVersionJob } from '@/types/content/p2-page-schema'
import type { LancityDb } from '@/types/database/schema'

/**
 * PD-1215: `track_page_version`. The service enqueues it only when the description HTML changed.
 * A version saved by the same user within 10 minutes is updated in place, otherwise a new one is added,
 * and only the newest 20 versions are kept.
 */
export async function trackPageVersion(db: LancityDb, input: PageVersionJob, now = new Date()): Promise<void> {
  const [page] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.id, input.pageId), isNull(pages.deletedAt)))
  if (!page) return
  const [latest] = await db
    .select({ id: pageVersions.id, ownedById: pageVersions.ownedById, lastSavedAt: pageVersions.lastSavedAt })
    .from(pageVersions)
    .where(and(eq(pageVersions.pageId, page.id), isNull(pageVersions.deletedAt)))
    .orderBy(desc(pageVersions.lastSavedAt), desc(pageVersions.id))
    .limit(1)
  const snapshot = {
    descriptionHtml: page.descriptionHtml,
    descriptionBinary: page.descriptionBinary,
    descriptionJson: page.descriptionJson,
    descriptionStripped: page.descriptionStripped,
    subPagesData: {}
  }
  if (
    latest &&
    latest.ownedById === input.userId &&
    (now.getTime() - latest.lastSavedAt.getTime()) / 1000 <= PAGE_VERSION_TASK_TIMEOUT
  )
    await db.update(pageVersions).set(snapshot).where(eq(pageVersions.id, latest.id))
  else
    await db.insert(pageVersions).values({
      ...snapshot,
      pageId: page.id,
      workspaceId: page.workspaceId,
      ownedById: input.userId,
      createdById: input.userId,
      lastSavedAt: now
    })
  const [{ total }] = await db
    .select({ total: count() })
    .from(pageVersions)
    .where(and(eq(pageVersions.pageId, page.id), isNull(pageVersions.deletedAt)))
  if (total <= MAX_PAGE_VERSIONS) return
  const oldest = await db
    .select({ id: pageVersions.id })
    .from(pageVersions)
    .where(and(eq(pageVersions.pageId, page.id), isNull(pageVersions.deletedAt)))
    .orderBy(asc(pageVersions.lastSavedAt), asc(pageVersions.id))
    .limit(total - MAX_PAGE_VERSIONS)
  await db
    .update(pageVersions)
    .set({ deletedAt: now })
    .where(
      inArray(
        pageVersions.id,
        oldest.map(row => row.id)
      )
    )
}

export async function pageVersionTask(env: InfraEnv, payload: PageVersionJob): Promise<void> {
  await trackPageVersion(getDb(env.DB), payload)
}
