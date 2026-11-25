import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { issues } from '@/db/schema/issue'
import { issueViews, userFavorites } from '@/db/schema/notification'
import { cycles, modules } from '@/db/schema/planning'
import { ServiceError } from '@/server/common/errors'
import { requireProjectAccess } from '@/server/project/permissions'
import { saveUserFavorite } from '@/server/workspace/model-rules'
import { getEntityDataUserFavorite, getFavoriteEntities } from '@/server/workspace/presenters'
import { getWorkspace } from '@/server/workspace/service'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { CreateWorkspaceFavorite, UpdateWorkspaceFavorite } from '@/types/workspace/schema'

async function findFavorite(db: LancityDb, actor: Actor, workspaceId: number, id: number) {
  const [favorite] = await db
    .select()
    .from(userFavorites)
    .where(
      and(
        eq(userFavorites.id, id),
        eq(userFavorites.workspaceId, workspaceId),
        eq(userFavorites.userId, actor.userId),
        isNull(userFavorites.deletedAt)
      )
    )
  if (!favorite) throw new ServiceError(404, 'FAVORITE_NOT_FOUND', 'Favorite not found')
  return favorite
}
type FavoriteRow = typeof userFavorites.$inferSelect
/** UserFavoriteSerializer: add the entity data (null when the entity is gone or hidden from the user). */
async function withEntityData(db: LancityDb, favorites: FavoriteRow[]) {
  return Promise.all(
    favorites.map(async favorite => ({
      ...favorite,
      entityData: await getEntityDataUserFavorite(db, favorite.userId, {
        entityType: favorite.entityType,
        entityIdentifier: favorite.entityIdentifier,
        projectId: favorite.projectId,
        workspaceId: favorite.workspaceId
      })
    }))
  )
}
async function validateFolder(db: LancityDb, actor: Actor, workspaceId: number, parent: number | null | undefined) {
  if (!parent) return
  const folder = await findFavorite(db, actor, workspaceId, parent)
  if (!folder.isFolder) throw new ServiceError(400, 'INVALID_FOLDER', 'Parent must be your folder')
}
export async function listWorkspaceFavorites(db: LancityDb, actor: Actor, slug: string, parent: number | null = null) {
  const { workspace } = await getWorkspace(db, actor, slug, 15)
  if (parent) await validateFolder(db, actor, workspace.id, parent)
  const rows = await db
    .select()
    .from(userFavorites)
    .where(
      and(
        eq(userFavorites.workspaceId, workspace.id),
        eq(userFavorites.userId, actor.userId),
        isNull(userFavorites.deletedAt),
        parent ? eq(userFavorites.parentId, parent) : isNull(userFavorites.parentId),
        or(
          // Plane hides workspace-level favorites of pages; only project pages are listed.
          and(isNull(userFavorites.projectId), parent ? undefined : sql`${userFavorites.entityType} != 'page'`),
          sql`exists (select 1 from project_members pm join projects p on p.id = pm.project_id where pm.project_id = ${sql.raw('"user_favorites"."project_id"')} and pm.workspace_id = ${workspace.id} and pm.member_id = ${actor.userId} and pm.is_active = 1 and pm.deleted_at is null and p.deleted_at is null and p.archived_at is null)`
        )
      )
    )
    .orderBy(userFavorites.sequence)
  return withEntityData(db, rows)
}
export async function createWorkspaceFavorite(
  db: LancityDb,
  actor: Actor,
  slug: string,
  input: CreateWorkspaceFavorite
) {
  const { workspace } = await getWorkspace(db, actor, slug, 15)
  await validateFolder(db, actor, workspace.id, input.parent)
  if (input.entity_type === 'folder') {
    if (input.parent) throw new ServiceError(400, 'INVALID_FOLDER', 'Folders cannot be nested')
    const [folder] = await db
      .insert(userFavorites)
      .values({
        entityType: 'folder',
        name: input.name,
        isFolder: true,
        sequence: await saveUserFavorite(db, workspace.id),
        workspaceId: workspace.id,
        userId: actor.userId,
        createdById: actor.userId,
        updatedById: actor.userId
      })
      .returning()
    return (await withEntityData(db, [folder]))[0]
  }
  const projectId = input.project_id ?? (input.entity_type === 'project' ? input.entity_identifier : null)
  if (input.entity_type !== 'view' && !projectId) throw new ServiceError(400, 'PROJECT_REQUIRED', 'Project is required')
  if (projectId) {
    const { project, membership, workspaceMembership } = await requireProjectAccess(db, actor, slug, projectId)
    if (project.archivedAt) throw new ServiceError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    const restricted = membership.role === 5 && workspaceMembership.role !== 20 && !project.guestViewAllFeatures
    let found = false
    if (input.entity_type === 'project') found = input.entity_identifier === projectId
    if (input.entity_type === 'issue')
      found =
        (
          await db
            .select({ id: issues.id })
            .from(issues)
            .where(
              and(
                eq(issues.id, input.entity_identifier),
                eq(issues.projectId, projectId),
                eq(issues.workspaceId, workspace.id),
                isNull(issues.deletedAt),
                isNull(issues.archivedAt),
                restricted ? eq(issues.createdById, actor.userId) : undefined
              )
            )
            .limit(1)
        ).length > 0
    if (input.entity_type === 'cycle')
      found =
        (
          await db
            .select({ id: cycles.id })
            .from(cycles)
            .where(
              and(
                eq(cycles.id, input.entity_identifier),
                eq(cycles.projectId, projectId),
                eq(cycles.workspaceId, workspace.id),
                isNull(cycles.deletedAt),
                isNull(cycles.archivedAt)
              )
            )
            .limit(1)
        ).length > 0
    if (input.entity_type === 'module')
      found =
        (
          await db
            .select({ id: modules.id })
            .from(modules)
            .where(
              and(
                eq(modules.id, input.entity_identifier),
                eq(modules.projectId, projectId),
                eq(modules.workspaceId, workspace.id),
                isNull(modules.deletedAt),
                isNull(modules.archivedAt)
              )
            )
            .limit(1)
        ).length > 0
    if (input.entity_type === 'page')
      found = Boolean(
        await getFavoriteEntities(db, actor.userId, {
          entityType: 'page',
          entityIdentifier: input.entity_identifier,
          projectId,
          workspaceId: workspace.id
        })
      )
    if (input.entity_type === 'view')
      found =
        (
          await db
            .select({ id: issueViews.id })
            .from(issueViews)
            .where(
              and(
                eq(issueViews.id, input.entity_identifier),
                eq(issueViews.projectId, projectId),
                eq(issueViews.workspaceId, workspace.id),
                isNull(issueViews.deletedAt),
                isNull(issueViews.archivedAt),
                restricted
                  ? eq(issueViews.ownedById, actor.userId)
                  : or(eq(issueViews.ownedById, actor.userId), eq(issueViews.access, 1))
              )
            )
            .limit(1)
        ).length > 0
    if (!found) throw new ServiceError(404, 'ENTITY_NOT_FOUND', 'Favorite entity not found')
  } else {
    const [view] = await db
      .select({ id: issueViews.id })
      .from(issueViews)
      .where(
        and(
          eq(issueViews.id, input.entity_identifier),
          eq(issueViews.workspaceId, workspace.id),
          isNull(issueViews.projectId),
          isNull(issueViews.deletedAt),
          isNull(issueViews.archivedAt),
          or(eq(issueViews.ownedById, actor.userId), eq(issueViews.access, 1))
        )
      )
    if (!view) throw new ServiceError(404, 'ENTITY_NOT_FOUND', 'Favorite entity not found')
  }
  const [existing] = await db
    .select()
    .from(userFavorites)
    .where(
      and(
        eq(userFavorites.entityType, input.entity_type),
        eq(userFavorites.entityIdentifier, input.entity_identifier),
        eq(userFavorites.workspaceId, workspace.id),
        eq(userFavorites.userId, actor.userId),
        isNull(userFavorites.deletedAt)
      )
    )
  if (existing) return (await withEntityData(db, [existing]))[0]
  const [favorite] = await db
    .insert(userFavorites)
    .values({
      entityType: input.entity_type,
      entityIdentifier: input.entity_identifier,
      sequence: await saveUserFavorite(db, workspace.id),
      name: input.name,
      parentId: input.parent,
      projectId,
      workspaceId: workspace.id,
      userId: actor.userId,
      createdById: actor.userId,
      updatedById: actor.userId
    })
    .returning()
  return (await withEntityData(db, [favorite]))[0]
}
export async function updateWorkspaceFavorite(
  db: LancityDb,
  actor: Actor,
  slug: string,
  id: number,
  input: UpdateWorkspaceFavorite
) {
  const { workspace } = await getWorkspace(db, actor, slug, 15)
  const favorite = await findFavorite(db, actor, workspace.id, id)
  if (favorite.isFolder && input.parent) throw new ServiceError(400, 'INVALID_FOLDER', 'Folders cannot be nested')
  await validateFolder(db, actor, workspace.id, input.parent)
  const [updated] = await db
    .update(userFavorites)
    .set({ name: input.name, sequence: input.sequence, parentId: input.parent, updatedById: actor.userId })
    .where(
      and(
        eq(userFavorites.id, id),
        eq(userFavorites.workspaceId, workspace.id),
        eq(userFavorites.userId, actor.userId),
        isNull(userFavorites.deletedAt)
      )
    )
    .returning()
  return (await withEntityData(db, [updated]))[0]
}
export async function deleteWorkspaceFavorite(db: LancityDb, actor: Actor, slug: string, id: number) {
  const { workspace } = await getWorkspace(db, actor, slug, 15)
  await findFavorite(db, actor, workspace.id, id)
  await db
    .delete(userFavorites)
    .where(
      and(eq(userFavorites.id, id), eq(userFavorites.workspaceId, workspace.id), eq(userFavorites.userId, actor.userId))
    )
}
