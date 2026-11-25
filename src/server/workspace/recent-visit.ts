import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { userRecentVisits } from '@/db/schema/notification'
import { ServiceError } from '@/server/common/errors'
import { getEntityDataWorkspaceRecentVisit } from '@/server/workspace/presenters'
import { getWorkspace } from '@/server/workspace/service'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { RecordRecentVisit } from '@/types/workspace/schema'

const MAX_RECENT_VISITS = 20

/** UserRecentVisitViewSet.list: the latest 20 visits of issues, pages and projects, with entity data. */
export async function listUserRecentVisits(
  db: LancityDb,
  actor: Actor,
  slug: string,
  entityName?: 'issue' | 'page' | 'project'
) {
  const { workspace } = await getWorkspace(db, actor, slug)
  const rows = await db
    .select()
    .from(userRecentVisits)
    .where(
      and(
        eq(userRecentVisits.workspaceId, workspace.id),
        eq(userRecentVisits.userId, actor.userId),
        isNull(userRecentVisits.deletedAt),
        entityName ? eq(userRecentVisits.entityName, entityName) : undefined,
        inArray(userRecentVisits.entityName, ['issue', 'page', 'project'])
      )
    )
    .orderBy(desc(userRecentVisits.createdAt), desc(userRecentVisits.id))
    .limit(MAX_RECENT_VISITS)
  return Promise.all(
    rows.map(async row => ({
      id: row.id,
      entity_name: row.entityName,
      entity_identifier: row.entityIdentifier,
      entity_data: await getEntityDataWorkspaceRecentVisit(db, actor.userId, {
        entityType: row.entityName,
        entityIdentifier: row.entityIdentifier,
        projectId: row.projectId,
        workspaceId: row.workspaceId
      }),
      visited_at: row.visitedAt
    }))
  )
}

/**
 * bgtasks/recent_visited_task.py: bump the visit time of an existing entry, otherwise insert one and evict the
 * oldest entry once the user holds 20 in the workspace.
 */
export async function recordRecentVisit(
  db: LancityDb,
  input: RecordRecentVisit & { userId: number; workspaceId: number }
) {
  const projectId = input.project_id ?? null
  const where = and(
    eq(userRecentVisits.entityName, input.entity_name),
    eq(userRecentVisits.entityIdentifier, input.entity_identifier),
    eq(userRecentVisits.userId, input.userId),
    eq(userRecentVisits.workspaceId, input.workspaceId),
    projectId === null ? isNull(userRecentVisits.projectId) : eq(userRecentVisits.projectId, projectId),
    isNull(userRecentVisits.deletedAt)
  )
  const [existing] = await db.select({ id: userRecentVisits.id }).from(userRecentVisits).where(where).limit(1)
  if (existing) {
    await db.update(userRecentVisits).set({ visitedAt: new Date() }).where(eq(userRecentVisits.id, existing.id))
    return
  }
  const own = and(
    eq(userRecentVisits.userId, input.userId),
    eq(userRecentVisits.workspaceId, input.workspaceId),
    isNull(userRecentVisits.deletedAt)
  )
  const held = await db
    .select({ id: userRecentVisits.id })
    .from(userRecentVisits)
    .where(own)
    .orderBy(asc(userRecentVisits.createdAt), asc(userRecentVisits.id))
  const evict = held.slice(0, Math.max(0, held.length - (MAX_RECENT_VISITS - 1))).map(row => row.id)
  const insert = db.insert(userRecentVisits).values({
    entityName: input.entity_name,
    entityIdentifier: input.entity_identifier,
    projectId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    visitedAt: new Date(),
    createdById: input.userId,
    updatedById: input.userId
  })
  // Delete and insert together so a concurrent task cannot leave the user above the cap.
  if (evict.length) await db.batch([db.delete(userRecentVisits).where(inArray(userRecentVisits.id, evict)), insert])
  else await insert
}

/** Request-side entry: check the actor may see the entity, then record the visit synchronously. */
export async function createRecentVisit(db: LancityDb, actor: Actor, slug: string, input: RecordRecentVisit) {
  const { workspace } = await getWorkspace(db, actor, slug)
  const ref = {
    entityType: input.entity_name,
    entityIdentifier: input.entity_identifier,
    projectId: input.project_id ?? (input.entity_name === 'project' ? input.entity_identifier : null),
    workspaceId: workspace.id
  }
  if (!(await getEntityDataWorkspaceRecentVisit(db, actor.userId, ref)))
    throw new ServiceError(404, 'ENTITY_NOT_FOUND', 'Recent visit entity not found')
  await recordRecentVisit(db, {
    ...input,
    project_id: ref.projectId,
    userId: actor.userId,
    workspaceId: workspace.id
  })
  return { message: 'Recorded' }
}
