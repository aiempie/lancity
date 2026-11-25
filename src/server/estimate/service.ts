import { outboxStatement, publishOutbox } from '@/server/common/outbox'
import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import { issues } from '@/db/schema/issue'
import { projectMembers, projects } from '@/db/schema/workspace'
import { draftIssues, estimatePoints, estimates } from '@/db/schema/planning'
import { ServiceError } from '@/server/common/errors'
import { requireWorkspaceRole, ROLE } from '@/server/common/permissions'
import { toEstimateRead } from '@/server/estimate/presenters'
import { queryPointsOf, queryProjectEstimates } from '@/server/estimate/queries'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type {
  BulkCreateEstimateInput,
  BulkUpdateEstimateInput,
  CreateEstimatePointInput
} from '@/types/planning/p2-estimate-schema'
import type { CreateEstimateInput, UpdateEstimateInput } from '@/types/planning/schema'

/** Plane `BulkEstimatePointEndpoint.list` (PD-0524): every project estimate with its points. */
export async function listEstimates(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId)
  const rows = await queryProjectEstimates(db, workspace.id, projectId)
  const points = await queryPointsOf(
    db,
    and(eq(estimatePoints.workspaceId, workspace.id), eq(estimatePoints.projectId, projectId))
  )
  return rows.map(row => toEstimateRead(row, points))
}
export async function getEstimate(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  estimateId: number,
  role: 5 | 15 | 20 = 5
) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, role)
  const [estimate] = await db
    .select()
    .from(estimates)
    .where(
      and(
        eq(estimates.id, estimateId),
        eq(estimates.workspaceId, workspace.id),
        eq(estimates.projectId, projectId),
        isNull(estimates.deletedAt)
      )
    )
  if (!estimate) throw new ServiceError(404, 'ESTIMATE_NOT_FOUND', 'Estimate not found')
  const points = await db
    .select()
    .from(estimatePoints)
    .where(
      and(
        eq(estimatePoints.estimateId, estimateId),
        eq(estimatePoints.projectId, projectId),
        isNull(estimatePoints.deletedAt)
      )
    )
    .orderBy(estimatePoints.key)
  return { ...estimate, points }
}
export async function createEstimate(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  input: CreateEstimateInput
) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 15)
  const existing = await db
    .select({ id: estimates.id })
    .from(estimates)
    .where(
      and(eq(estimates.projectId, projectId), eq(estimates.name, input.estimate.name), isNull(estimates.deletedAt))
    )
  if (existing.length) throw new ServiceError(409, 'ESTIMATE_EXISTS', 'Estimate name already exists')
  const create = db
    .insert(estimates)
    .values({
      name: input.estimate.name,
      description: input.estimate.description,
      type: input.estimate.type,
      lastUsed: input.estimate.last_used,
      projectId,
      workspaceId: workspace.id,
      createdById: actor.userId,
      updatedById: actor.userId
    })
    .returning()
  if (!input.estimate_points.length) return (await create)[0]
  const [created] = await db.batch([
    create,
    db.insert(estimatePoints).values(
      input.estimate_points.map(point => ({
        ...point,
        estimateId: sql`(select id from estimates where project_id = ${projectId} and name = ${input.estimate.name} and deleted_at is null)`,
        projectId,
        workspaceId: workspace.id,
        createdById: actor.userId,
        updatedById: actor.userId
      }))
    )
  ])
  return created[0]
}
export async function updateEstimate(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  estimateId: number,
  input: UpdateEstimateInput
) {
  await getEstimate(db, actor, slug, projectId, estimateId, 15)
  const [updated] = await db
    .update(estimates)
    .set({ ...input, updatedById: actor.userId })
    .where(and(eq(estimates.id, estimateId), eq(estimates.projectId, projectId), isNull(estimates.deletedAt)))
    .returning()
  return updated
}
export async function deleteEstimate(db: LancityDb, actor: Actor, slug: string, projectId: number, estimateId: number) {
  await getEstimate(db, actor, slug, projectId, estimateId, 15)
  const pointIds = db
    .select({ id: estimatePoints.id })
    .from(estimatePoints)
    .where(and(eq(estimatePoints.estimateId, estimateId), eq(estimatePoints.projectId, projectId)))
  await db.batch([
    db
      .update(projects)
      .set({ estimateId: null, updatedById: actor.userId })
      .where(and(eq(projects.id, projectId), eq(projects.estimateId, estimateId))),
    db
      .update(issues)
      .set({ estimatePointId: null, updatedById: actor.userId })
      .where(and(eq(issues.projectId, projectId), inArray(issues.estimatePointId, pointIds))),
    db
      .update(draftIssues)
      .set({ estimatePointId: null, updatedById: actor.userId })
      .where(and(eq(draftIssues.projectId, projectId), inArray(draftIssues.estimatePointId, pointIds))),
    db
      .update(estimatePoints)
      .set({ deletedAt: new Date(), updatedById: actor.userId })
      .where(
        and(
          eq(estimatePoints.estimateId, estimateId),
          eq(estimatePoints.projectId, projectId),
          isNull(estimatePoints.deletedAt)
        )
      ),
    db
      .update(estimates)
      .set({ deletedAt: new Date(), updatedById: actor.userId })
      .where(and(eq(estimates.id, estimateId), eq(estimates.projectId, projectId), isNull(estimates.deletedAt)))
  ])
}

export async function createEstimatePoints(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  estimateId: number,
  points: import('@/types/planning/schema').EstimatePointInput[]
) {
  const estimate = await getEstimate(db, actor, slug, projectId, estimateId, 15)
  return db
    .insert(estimatePoints)
    .values(
      points.map(point => ({
        ...point,
        estimateId,
        projectId,
        workspaceId: estimate.workspaceId,
        createdById: actor.userId,
        updatedById: actor.userId
      }))
    )
    .returning()
}
export async function updateEstimatePoint(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  estimateId: number,
  pointId: number,
  input: import('@/types/planning/schema').UpdateEstimatePointInput
) {
  await getEstimate(db, actor, slug, projectId, estimateId, 15)
  const [point] = await db
    .update(estimatePoints)
    .set({ ...input, updatedById: actor.userId })
    .where(
      and(
        eq(estimatePoints.id, pointId),
        eq(estimatePoints.estimateId, estimateId),
        eq(estimatePoints.projectId, projectId),
        isNull(estimatePoints.deletedAt)
      )
    )
    .returning()
  if (!point) throw new ServiceError(404, 'ESTIMATE_POINT_NOT_FOUND', 'Estimate point not found')
  return point
}
/** Plane `generate_random_name` (PD-0522): ten random lowercase letters. */
export function generateRandomName(length = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, byte => String.fromCharCode(97 + (byte % 26))).join('')
}

/**
 * Plane `EstimatePointEndpoint.destroy` (PD-0531). Issues that used the point move to `newPointId` (or lose their
 * estimate), points with a higher key shift down by one, and the updated points are returned.
 */
export async function deleteEstimatePoint(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  estimateId: number,
  pointId: number,
  newPointId?: number | null
) {
  const estimate = await getEstimate(db, actor, slug, projectId, estimateId, 15)
  const point = estimate.points.find(item => item.id === pointId)
  if (!point) throw new ServiceError(404, 'ESTIMATE_POINT_NOT_FOUND', 'Estimate point not found')
  if (newPointId && !estimate.points.some(item => item.id === newPointId && item.id !== pointId))
    throw new ServiceError(404, 'ESTIMATE_POINT_NOT_FOUND', 'Replacement estimate point not found')
  const affected = await db
    .select({ id: issues.id, estimatePointId: issues.estimatePointId })
    .from(issues)
    .where(and(eq(issues.projectId, projectId), eq(issues.estimatePointId, pointId), isNull(issues.deletedAt)))
  const activityKeys = affected.map(() => crypto.randomUUID())
  await db.batch([
    db
      .update(issues)
      .set({ estimatePointId: newPointId ?? null, updatedById: actor.userId })
      .where(and(eq(issues.projectId, projectId), eq(issues.estimatePointId, pointId))),
    db
      .update(draftIssues)
      .set({ estimatePointId: null, updatedById: actor.userId })
      .where(and(eq(draftIssues.projectId, projectId), eq(draftIssues.estimatePointId, pointId))),
    db
      .update(estimatePoints)
      .set({ key: sql`${estimatePoints.key} - 1`, updatedById: actor.userId })
      .where(
        and(
          eq(estimatePoints.estimateId, estimateId),
          eq(estimatePoints.projectId, projectId),
          isNull(estimatePoints.deletedAt),
          gt(estimatePoints.key, point.key)
        )
      ),
    db
      .update(estimatePoints)
      .set({ deletedAt: new Date(), updatedById: actor.userId })
      .where(
        and(
          eq(estimatePoints.id, pointId),
          eq(estimatePoints.estimateId, estimateId),
          eq(estimatePoints.projectId, projectId),
          isNull(estimatePoints.deletedAt)
        )
      ),
    ...affected.map((row, index) => outboxStatement(db, activityKeys[index], 'issue.activity', {
      type: 'issue.activity.updated', requestedData: { estimate_point: newPointId ?? null },
      currentInstance: { estimate_point: row.estimatePointId }, issueId: row.id,
      actorId: actor.userId, projectId, epoch: Math.floor(Date.now() / 1000)
    }))
  ])
  for (const key of activityKeys) await publishOutbox(db, key)
  return estimate.points
    .filter(item => item.key > point.key)
    .map(item => ({ ...item, key: item.key - 1 }))
}

/** Plane `EstimatePointEndpoint.create` (PD-0529): one point for an existing estimate. */
export async function createEstimatePoint(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  estimateId: number,
  input: CreateEstimatePointInput
) {
  const [point] = await createEstimatePoints(db, actor, slug, projectId, estimateId, [input])
  return point
}

/** Plane `BulkEstimatePointEndpoint.create` (PD-0525): random name when none is given, returns estimate + points. */
export async function bulkCreateEstimate(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  input: BulkCreateEstimateInput
) {
  const created = await createEstimate(db, actor, slug, projectId, {
    ...input,
    estimate: { ...input.estimate, name: input.estimate.name ?? generateRandomName() }
  })
  return getEstimate(db, actor, slug, projectId, created.id, 15)
}

/**
 * Plane `BulkEstimatePointEndpoint.partial_update` (PD-0527): optional name/type change plus key/value updates of the
 * listed points. Ids that do not belong to the estimate are ignored, as in Plane.
 */
export async function bulkUpdateEstimate(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  estimateId: number,
  input: BulkUpdateEstimateInput
) {
  await getEstimate(db, actor, slug, projectId, estimateId, 15)
  const estimateSet = {
    ...(input.estimate?.name === undefined ? {} : { name: input.estimate.name }),
    ...(input.estimate?.type === undefined ? {} : { type: input.estimate.type })
  }
  const updates = [
    ...(Object.keys(estimateSet).length
      ? [
          db
            .update(estimates)
            .set({ ...estimateSet, updatedById: actor.userId })
            .where(and(eq(estimates.id, estimateId), eq(estimates.projectId, projectId), isNull(estimates.deletedAt)))
        ]
      : []),
    ...input.estimate_points
      .filter(point => point.key !== undefined || point.value !== undefined)
      .map(point =>
        db
          .update(estimatePoints)
          .set({
            ...(point.key === undefined ? {} : { key: point.key }),
            ...(point.value === undefined ? {} : { value: point.value }),
            updatedById: actor.userId
          })
          .where(
            and(
              eq(estimatePoints.id, point.id),
              eq(estimatePoints.estimateId, estimateId),
              eq(estimatePoints.projectId, projectId),
              isNull(estimatePoints.deletedAt)
            )
          )
      )
  ]
  if (updates.length) await db.batch(updates as [(typeof updates)[number], ...(typeof updates)[number][]])
  return getEstimate(db, actor, slug, projectId, estimateId, 15)
}

/** Plane `ProjectEstimatePointEndpoint.get` (PD-0523): points of the estimate the project currently uses. */
export async function getProjectEstimatePoints(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { workspace, project } = await requireProjectAccess(db, actor, slug, projectId, 15)
  if (!project.estimateId) return []
  return db
    .select()
    .from(estimatePoints)
    .where(
      and(
        eq(estimatePoints.estimateId, project.estimateId),
        eq(estimatePoints.projectId, projectId),
        eq(estimatePoints.workspaceId, workspace.id),
        isNull(estimatePoints.deletedAt)
      )
    )
    .orderBy(asc(estimatePoints.key))
}

/**
 * Plane `WorkspaceEstimatesEndpoint.get` (PD-0891): estimates of visible projects. Admins see every project, members
 * see projects they belong to plus public ones (network 2), guests only projects they belong to. Plane caches this
 * for two hours; here every call reads D1 so no invalidation is needed.
 */
export async function getWorkspaceEstimates(db: LancityDb, actor: Actor, slug: string) {
  const { workspaceId, workspaceRole } = await requireWorkspaceRole(db, actor, slug, [
    ROLE.ADMIN,
    ROLE.MEMBER,
    ROLE.GUEST
  ])
  const memberProjects = db
    .select({ id: projectMembers.projectId })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.workspaceId, workspaceId),
        eq(projectMembers.memberId, actor.userId),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt)
      )
    )
  const visible =
    workspaceRole === ROLE.ADMIN
      ? undefined
      : workspaceRole === ROLE.MEMBER
        ? or(inArray(projects.id, memberProjects), eq(projects.network, 2))
        : inArray(projects.id, memberProjects)
  const estimateIds = db
    .select({ id: projects.estimateId })
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt), sql`${projects.estimateId} is not null`, visible))
  const where = and(
    eq(estimates.workspaceId, workspaceId),
    isNull(estimates.deletedAt),
    inArray(estimates.id, estimateIds)
  )
  const rows = await db.select().from(estimates).where(where).orderBy(asc(estimates.name))
  const points = await queryPointsOf(
    db,
    and(eq(estimatePoints.workspaceId, workspaceId), inArray(estimatePoints.estimateId, db.select({ id: estimates.id }).from(estimates).where(where)))
  )
  return rows.map(row => toEstimateRead(row, points))
}
