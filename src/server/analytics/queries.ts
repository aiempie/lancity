import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { analyticViews } from '@/db/schema/notification'
import { parseError } from '@/server/common/errors'
import type { DateRange } from '@/server/common/date-utils'
import type { LancityDb } from '@/types/database/schema'

/**
 * Shared SQL building blocks of the analytics endpoints. Issue queries always read `from issues` without an alias,
 * because the issue filters (`issueFilters`, `issueFilterSet`) refer to `issues.<column>`.
 */
export type AnalyticsScope = { workspaceId: number; userId: number; projectIds?: number[] }

/** D1 allows 100 bound parameters per statement, so lists are capped well below that. */
const MAX_PROJECT_IDS = 80

export const raw = (text: string): SQL => sql.raw(text)
export const idList = (values: number[]): SQL =>
  sql.join(
    values.map(value => sql`${value}`),
    sql`, `
  )

/** Plane `user.display_name`. */
export const userDisplayName = (alias: string): SQL =>
  raw(`coalesce(nullif(${alias}.display_username, ''), ${alias}.username, ${alias}.name)`)

/**
 * Projects the user may see in analytics: active membership, project not deleted or archived
 * (`base_filters` of `get_analytics_filters`), optionally limited to `project_ids`.
 */
export function visibleProjectsSql(scope: AnalyticsScope): SQL {
  if ((scope.projectIds?.length ?? 0) > MAX_PROJECT_IDS)
    throw parseError(`At most ${MAX_PROJECT_IDS} project_ids are accepted`)
  const ids = scope.projectIds?.length ? sql` and sp.id in (${idList(scope.projectIds)})` : sql``
  return sql`select sp.id from projects sp join project_members spm on spm.project_id = sp.id
    where sp.workspace_id = ${scope.workspaceId} and sp.deleted_at is null and sp.archived_at is null
      and spm.member_id = ${scope.userId} and spm.is_active = 1 and spm.deleted_at is null${ids}`
}

/** `<column> in (visible projects)`. */
export const inVisibleProjects = (column: string, scope: AnalyticsScope): SQL =>
  sql`${raw(column)} in (${visibleProjectsSql(scope)})`

/** `Issue.issue_objects`: not deleted, archived or draft, and not a triage item. */
export const LIVE_ISSUES: SQL = sql`issues.deleted_at is null and issues.archived_at is null and issues.is_draft = 0
  and not exists (select 1 from states ts where ts.id = issues.state_id and ts."group" = 'triage')`

/** `Issue.issue_objects.filter(**base_filters)`. Extra conditions are ANDed. */
export function issuesWhere(scope: AnalyticsScope, extra: (SQL | undefined)[] = []): SQL {
  return and(
    sql`issues.workspace_id = ${scope.workspaceId}`,
    LIVE_ISSUES,
    inVisibleProjects('issues.project_id', scope),
    ...extra
  ) as SQL
}

/** Issues of a project, optionally of one cycle or module (the `cycle_issues` / `module_issues` subqueries of Plane). */
export function projectIssuesWhere(
  scope: AnalyticsScope,
  target: { projectId: number; cycleId?: number; moduleId?: number },
  extra: (SQL | undefined)[] = []
): SQL {
  let subset: SQL
  if (target.cycleId !== undefined)
    subset = sql`issues.id in (select ci.issue_id from cycle_issues ci where ci.cycle_id = ${target.cycleId}
      and ci.deleted_at is null and ci.workspace_id = ${scope.workspaceId} and ${inVisibleProjects('ci.project_id', scope)})`
  else if (target.moduleId !== undefined)
    subset = sql`issues.id in (select mi.issue_id from module_issues mi where mi.module_id = ${target.moduleId}
      and mi.deleted_at is null and mi.workspace_id = ${scope.workspaceId} and ${inVisibleProjects('mi.project_id', scope)})`
  else subset = sql`issues.project_id = ${target.projectId} and ${inVisibleProjects('issues.project_id', scope)}`
  return and(sql`issues.workspace_id = ${scope.workspaceId}`, LIVE_ISSUES, subset, ...extra) as SQL
}

/** Rows of `table` that belong to the visible projects, not soft deleted. */
export function projectRowsWhere(table: string, scope: AnalyticsScope): SQL {
  return and(
    sql`${raw(table)}.workspace_id = ${scope.workspaceId}`,
    sql`${raw(table)}.deleted_at is null`,
    inVisibleProjects(`${table}.project_id`, scope)
  ) as SQL
}

/** `created_at >= gte and created_at <= lte` on a millisecond timestamp column (`analytics_date_range`). */
export function createdWithin(column: string, range?: DateRange | null): SQL | undefined {
  return range ? sql`${raw(column)} >= ${range.gte.getTime()} and ${raw(column)} <= ${range.lte.getTime()}` : undefined
}

export const isoDay = (date: Date): string => date.toISOString().slice(0, 10)

/** `created_at__date__gte / __lte` (`chart_period_range`): UTC calendar days. */
export function createdOnDays(column: string, period?: [Date, Date] | null): SQL | undefined {
  return period
    ? sql`date(${raw(column)} / 1000, 'unixepoch') >= ${isoDay(period[0])} and date(${raw(column)} / 1000, 'unixepoch') <= ${isoDay(period[1])}`
    : undefined
}

export async function countRows(db: LancityDb, from: string, where: SQL): Promise<number> {
  const [row] = await db.all<{ n: number }>(sql`select count(*) as n from ${raw(from)} where ${where}`)
  return Number(row?.n ?? 0)
}

/** `Count("id", filter=Q(state__group=...))` columns for the five state groups, over an `issues` row set. */
export const STATE_GROUP_COUNTS: SQL = sql`count(*) filter (where s."group" = 'cancelled') as cancelled_work_items,
  count(*) filter (where s."group" = 'completed') as completed_work_items,
  count(*) filter (where s."group" = 'backlog') as backlog_work_items,
  count(*) filter (where s."group" = 'unstarted') as un_started_work_items,
  count(*) filter (where s."group" = 'started') as started_work_items`

/** PD-0415 `AnalyticViewViewset.get_queryset`: the live analytic views of a workspace, newest first. */
export function queryAnalyticView(db: LancityDb, workspaceId: number, id?: number) {
  return db
    .select()
    .from(analyticViews)
    .where(
      and(
        eq(analyticViews.workspaceId, workspaceId),
        isNull(analyticViews.deletedAt),
        id === undefined ? undefined : eq(analyticViews.id, id)
      )
    )
    .orderBy(desc(analyticViews.createdAt), desc(analyticViews.id))
}
