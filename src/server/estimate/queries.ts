import { and, asc, eq, isNull, type SQL } from 'drizzle-orm'
import { estimatePoints, estimates } from '@/db/schema/planning'
import type { LancityDb } from '@/types/database/schema'

/** Plane `ProjectEstimateAPIEndpoint.get_queryset`: estimates of one project, scoped to the workspace and not deleted. */
export function queryProjectEstimates(db: LancityDb, workspaceId: number, projectId: number) {
  return db
    .select()
    .from(estimates)
    .where(and(eq(estimates.workspaceId, workspaceId), eq(estimates.projectId, projectId), isNull(estimates.deletedAt)))
    .orderBy(asc(estimates.name))
}

/** Plane `EstimatePoint*APIEndpoint.get_queryset`: active points of one estimate (optionally one point). */
export function queryEstimatePoints(
  db: LancityDb,
  scope: { workspaceId: number; projectId: number; estimateId: number; pointId?: number }
) {
  return db
    .select()
    .from(estimatePoints)
    .where(
      and(
        eq(estimatePoints.workspaceId, scope.workspaceId),
        eq(estimatePoints.projectId, scope.projectId),
        eq(estimatePoints.estimateId, scope.estimateId),
        scope.pointId === undefined ? undefined : eq(estimatePoints.id, scope.pointId),
        isNull(estimatePoints.deletedAt)
      )
    )
    .orderBy(asc(estimatePoints.key))
}

/** Points for many estimates (Plane `prefetch_related("points")`). `where` selects the estimates. */
export function queryPointsOf(db: LancityDb, where: SQL | undefined) {
  return db
    .select()
    .from(estimatePoints)
    .where(and(where, isNull(estimatePoints.deletedAt)))
    .orderBy(asc(estimatePoints.key))
}
