import { and, eq, isNull } from 'drizzle-orm'
import { userFavorites } from '@/db/schema/notification'
import { ServiceError } from '@/server/common/errors'
import { moduleContext } from '@/server/module/access'
import { queryModuleFavorite } from '@/server/module/queries'
import { saveUserFavorite } from '@/server/workspace/model-rules'
import { getFavoriteEntities } from '@/server/workspace/presenters'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

/**
 * PD-0680 `ModuleFavoriteViewSet.list` and PD-0681 `get_queryset`: the caller's favorite modules of the project.
 * Plane's list has no serializer and fails, so this returns the favorite rows.
 */
export async function listModuleFavorites(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { scope } = await moduleContext(db, actor, slug, projectId)
  return queryModuleFavorite(db, scope)
}

/**
 * PD-0682 `ModuleFavoriteViewSet.create`: 404 unless the module is in the project and visible to the caller.
 * Favoriting twice is a no-op.
 */
export async function createModuleFavorite(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  moduleId: number
) {
  const { scope } = await moduleContext(db, actor, slug, projectId)
  const entity = await getFavoriteEntities(db, actor.userId, {
    entityType: 'module',
    entityIdentifier: moduleId,
    projectId,
    workspaceId: scope.workspaceId
  })
  if (!entity) throw new ServiceError(404, 'MODULE_NOT_FOUND', 'Module not found')
  await db
    .insert(userFavorites)
    .values({
      entityType: 'module',
      entityIdentifier: moduleId,
      sequence: await saveUserFavorite(db, scope.workspaceId),
      projectId,
      userId: actor.userId,
      workspaceId: scope.workspaceId,
      createdById: actor.userId,
      updatedById: actor.userId
    })
    .onConflictDoNothing()
}

/** PD-0683 `ModuleFavoriteViewSet.destroy`: remove the caller's favorite, 404 when there is none. */
export async function deleteModuleFavorite(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  moduleId: number
) {
  const { scope } = await moduleContext(db, actor, slug, projectId)
  const removed = await db
    .delete(userFavorites)
    .where(
      and(
        eq(userFavorites.entityType, 'module'),
        eq(userFavorites.entityIdentifier, moduleId),
        eq(userFavorites.projectId, projectId),
        eq(userFavorites.workspaceId, scope.workspaceId),
        eq(userFavorites.userId, actor.userId),
        isNull(userFavorites.deletedAt)
      )
    )
    .returning({ id: userFavorites.id })
  if (!removed.length) throw new ServiceError(404, 'FAVORITE_NOT_FOUND', 'Favorite not found')
}
