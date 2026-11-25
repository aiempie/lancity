import { and, asc, count, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { issueLabels, issues, states } from '@/db/schema/issue'
import { intakeIssues, intakes } from '@/db/schema/planning'
import { buildOrderBy } from '@/server/common/filters'
import type { LancityDb } from '@/types/database/schema'

const CHUNK = 80 // D1 allows 100 bind parameters per statement

/** Issue columns an intake card needs; the full issue is read only for the detail view. */
export const intakeIssueColumns = {
  id: issues.id,
  name: issues.name,
  priority: issues.priority,
  sequenceId: issues.sequenceId,
  projectId: issues.projectId,
  createdAt: issues.createdAt,
  createdById: issues.createdById
}

/** `INTAKE_ISSUE_ORDER_BY_ALLOWLIST` of Plane, as the SQL expression each name sorts on. */
const ORDER_COLUMNS = {
  issue__created_at: issues.createdAt,
  issue__updated_at: issues.updatedAt,
  issue__sequence_id: issues.sequenceId,
  issue__sort_order: issues.sortOrder,
  issue__target_date: issues.targetDate,
  issue__start_date: issues.startDate,
  issue__priority: issues.priority,
  issue__state__name: states.name,
  created_at: intakeIssues.createdAt,
  updated_at: intakeIssues.updatedAt,
  status: intakeIssues.status
}

/** `order_by` limited to the allow-list; anything else falls back to `fallback` (Plane `sanitize_order_by`). */
export function intakeIssueOrder(orderBy: string | null | undefined, fallback = '-issue__created_at'): SQL {
  return buildOrderBy(orderBy, ORDER_COLUMNS, fallback, intakeIssues.createdAt)
}

/** PD-0544 `IntakeViewSet.get_queryset`: live intakes of a project with their pending issue count, by name. */
export function queryIntake(db: LancityDb, workspaceId: number, projectId: number, intakeId?: number) {
  return db
    .select({
      intake: intakes,
      pendingIssueCount: sql<number>`(select count(*) from intake_issues ii where ii.intake_id = ${sql.raw('"intakes"."id"')} and ii.status = -2 and ii.deleted_at is null)`
    })
    .from(intakes)
    .where(
      and(
        eq(intakes.workspaceId, workspaceId),
        eq(intakes.projectId, projectId),
        isNull(intakes.deletedAt),
        intakeId === undefined ? undefined : eq(intakes.id, intakeId)
      )
    )
    .orderBy(asc(intakes.name), asc(intakes.id))
}

/** The project's first live intake (`Intake.objects.filter(...).first()`, ordered by name). */
export async function firstProjectIntake(db: LancityDb, workspaceId: number, projectId: number) {
  const [row] = await queryIntake(db, workspaceId, projectId).limit(1)
  return row?.intake ?? null
}

/**
 * PD-0118, PD-0122, PD-0548: intake issues joined with their issue, for one intake. `where` adds the caller's
 * filters. Soft-deleted rows of either table are never returned.
 */
export function queryIntakeIssue(db: LancityDb, intakeId: number, projectId: number, where: (SQL | undefined)[] = []) {
  const conditions = and(
    eq(intakeIssues.intakeId, intakeId),
    eq(intakeIssues.projectId, projectId),
    isNull(intakeIssues.deletedAt),
    isNull(issues.deletedAt),
    ...where
  )
  return {
    page: (order: SQL) => (offset: number, limit: number) =>
      db
        .select({ row: intakeIssues, issue: intakeIssueColumns })
        .from(intakeIssues)
        .innerJoin(issues, eq(issues.id, intakeIssues.issueId))
        .leftJoin(states, eq(states.id, issues.stateId))
        .where(conditions)
        .orderBy(order)
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [total] = await db
        .select({ n: count() })
        .from(intakeIssues)
        .innerJoin(issues, eq(issues.id, intakeIssues.issueId))
        .leftJoin(states, eq(states.id, issues.stateId))
        .where(conditions)
      return total?.n ?? 0
    }
  }
}

/** Live label ids per issue (`label_ids` annotation, which skips soft-deleted links). */
export async function labelIdsByIssue(db: LancityDb, issueIds: number[]) {
  const result = new Map<number, number[]>()
  for (let i = 0; i < issueIds.length; i += CHUNK) {
    const rows = await db
      .select({ issueId: issueLabels.issueId, labelId: issueLabels.labelId })
      .from(issueLabels)
      .where(and(inArray(issueLabels.issueId, issueIds.slice(i, i + CHUNK)), isNull(issueLabels.deletedAt)))
      .orderBy(asc(issueLabels.id))
    for (const row of rows) result.set(row.issueId, [...(result.get(row.issueId) ?? []), row.labelId])
  }
  return result
}

/** One intake issue of a project by its work item id (`IntakeIssue.objects.get(issue_id=pk, ...)`). */
export async function findIntakeIssue(db: LancityDb, intakeId: number, projectId: number, issueId: number) {
  const [row] = await db
    .select()
    .from(intakeIssues)
    .where(
      and(
        eq(intakeIssues.issueId, issueId),
        eq(intakeIssues.intakeId, intakeId),
        eq(intakeIssues.projectId, projectId),
        isNull(intakeIssues.deletedAt)
      )
    )
    .limit(1)
  return row ?? null
}
