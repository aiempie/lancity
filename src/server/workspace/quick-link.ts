import { and, eq, isNull, ne } from 'drizzle-orm'
import { workspaceUserLinks } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import { requireProjectAccess } from '@/server/project/permissions'
import { getWorkspace } from '@/server/workspace/service'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { CreateQuickLink, UpdateQuickLink } from '@/types/workspace/schema'

/** WorkspaceUserLinkSerializer.create/update: one URL once per workspace and owner. */
async function assertUniqueUrl(
  db: LancityDb,
  workspaceId: number,
  ownerId: number,
  url: string | undefined,
  exceptId?: number
) {
  if (!url) return
  const [duplicate] = await db
    .select({ id: workspaceUserLinks.id })
    .from(workspaceUserLinks)
    .where(
      and(
        eq(workspaceUserLinks.url, url),
        eq(workspaceUserLinks.workspaceId, workspaceId),
        eq(workspaceUserLinks.ownerId, ownerId),
        isNull(workspaceUserLinks.deletedAt),
        exceptId ? ne(workspaceUserLinks.id, exceptId) : undefined
      )
    )
    .limit(1)
  if (duplicate) throw new ServiceError(400, 'QUICK_LINK_EXISTS', 'URL already exists for this workspace and owner')
}
export async function listQuickLinks(db: LancityDb, actor: Actor, slug: string) {
  const { workspace } = await getWorkspace(db, actor, slug)
  return db
    .select()
    .from(workspaceUserLinks)
    .where(
      and(
        eq(workspaceUserLinks.workspaceId, workspace.id),
        eq(workspaceUserLinks.ownerId, actor.userId),
        isNull(workspaceUserLinks.deletedAt)
      )
    )
}
export async function getQuickLink(db: LancityDb, actor: Actor, slug: string, id: number) {
  const { workspace } = await getWorkspace(db, actor, slug)
  const [link] = await db
    .select()
    .from(workspaceUserLinks)
    .where(
      and(
        eq(workspaceUserLinks.id, id),
        eq(workspaceUserLinks.workspaceId, workspace.id),
        eq(workspaceUserLinks.ownerId, actor.userId),
        isNull(workspaceUserLinks.deletedAt)
      )
    )
  if (!link) throw new ServiceError(404, 'QUICK_LINK_NOT_FOUND', 'Quick link not found')
  return link
}
export async function createQuickLink(db: LancityDb, actor: Actor, slug: string, input: CreateQuickLink) {
  const { workspace } = await getWorkspace(db, actor, slug)
  if (input.project_id) await requireProjectAccess(db, actor, slug, input.project_id)
  await assertUniqueUrl(db, workspace.id, actor.userId, input.url)
  const [link] = await db
    .insert(workspaceUserLinks)
    .values({
      url: input.url,
      title: input.title,
      projectId: input.project_id,
      workspaceId: workspace.id,
      ownerId: actor.userId,
      createdById: actor.userId,
      updatedById: actor.userId
    })
    .returning()
  return link
}
export async function updateQuickLink(db: LancityDb, actor: Actor, slug: string, id: number, input: UpdateQuickLink) {
  const link = await getQuickLink(db, actor, slug, id)
  if (input.project_id) await requireProjectAccess(db, actor, slug, input.project_id)
  await assertUniqueUrl(db, link.workspaceId, actor.userId, input.url, id)
  const [updated] = await db
    .update(workspaceUserLinks)
    .set({ url: input.url, title: input.title, projectId: input.project_id, updatedById: actor.userId })
    .where(
      and(
        eq(workspaceUserLinks.id, id),
        eq(workspaceUserLinks.workspaceId, link.workspaceId),
        eq(workspaceUserLinks.ownerId, actor.userId),
        isNull(workspaceUserLinks.deletedAt)
      )
    )
    .returning()
  return updated
}
export async function deleteQuickLink(db: LancityDb, actor: Actor, slug: string, id: number) {
  const link = await getQuickLink(db, actor, slug, id)
  await db
    .update(workspaceUserLinks)
    .set({ deletedAt: new Date(), updatedById: actor.userId })
    .where(
      and(
        eq(workspaceUserLinks.id, id),
        eq(workspaceUserLinks.workspaceId, link.workspaceId),
        eq(workspaceUserLinks.ownerId, actor.userId),
        isNull(workspaceUserLinks.deletedAt)
      )
    )
}
