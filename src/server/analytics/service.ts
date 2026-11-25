import { and, count, eq, isNull, sql } from 'drizzle-orm'
import { analyticExports } from '@/db/schema/ext-p3-analytics'
import { issues, states } from '@/db/schema/issue'
import { analyticViews } from '@/db/schema/notification'
import { user } from '@/db/schema/auth'
import { buildGraphPlot, VALID_ANALYTICS_FIELDS, VALID_YAXIS } from '@/server/analytics/analytics-plot'
import { ANALYTICS_JOB } from '@/server/analytics/events'
import { filterParamsOf, loadPlotDetails } from '@/server/analytics/export'
import { presentAnalyticView } from '@/server/analytics/presenters'
import { countRows, issuesWhere, LIVE_ISSUES, queryAnalyticView, type AnalyticsScope } from '@/server/analytics/queries'
import type { InfraEnv } from '@/server/common/env'
import { notFoundError, ServiceError } from '@/server/common/errors'
import { enqueueJob } from '@/server/common/jobs'
import { requireWorkspaceRole, ROLE } from '@/server/common/permissions'
import { auditFields } from '@/server/common/mutations'
import { issueFilters, type FilterParams } from '@/server/issue/filter'
import { requireProjectAccess } from '@/server/project/permissions'
import type {
  AnalyticViewInput,
  AnalyticViewUpdate,
  ExportAnalyticsInput,
  ProjectStatsQuery
} from '@/types/reporting/p3-analytics-schema'
import type { Actor } from '@/types/auth/schema'
import type { JsonValue, LancityDb } from '@/types/database/schema'

export async function projectIssueMetrics(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 15)
  const rows = await db
    .select({ stateId: issues.stateId, state: states.name, group: states.group, count: count() })
    .from(issues)
    .leftJoin(states, eq(states.id, issues.stateId))
    .where(
      and(
        eq(issues.workspaceId, workspace.id),
        eq(issues.projectId, projectId),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt),
        eq(issues.isDraft, false)
      )
    )
    .groupBy(issues.stateId, states.name, states.group)
  return { total: rows.reduce((sum, row) => sum + row.count, 0), states: rows }
}

const ANALYST_ROLES = [ROLE.ADMIN, ROLE.MEMBER] as const

const textParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[value.length - 1] : value

/**
 * The axis checks shared by the analytics, saved analytic and export endpoints. Both axes are required and valid,
 * and a segment must be valid and differ from the x axis.
 */
export function validateAxes(xAxis: unknown, yAxis: unknown, segment: unknown): void {
  const validX = typeof xAxis === 'string' && (VALID_ANALYTICS_FIELDS as readonly string[]).includes(xAxis)
  const validY = typeof yAxis === 'string' && (VALID_YAXIS as readonly string[]).includes(yAxis)
  if (!validX || !validY)
    throw new ServiceError(
      400,
      'INVALID_AXIS',
      'x-axis and y-axis dimensions are required and the values should be valid'
    )
  if (
    segment &&
    (typeof segment !== 'string' ||
      !(VALID_ANALYTICS_FIELDS as readonly string[]).includes(segment) ||
      segment === xAxis)
  )
    throw new ServiceError(400, 'INVALID_SEGMENT', 'Both segment and x axis cannot be same and segment should be valid')
}

/** PD-0408 `AnalyticsEndpoint.get`: total issues, the distribution for the axes and the lookups that name the ids. */
export async function getAnalytics(db: LancityDb, actor: Actor, slug: string, params: FilterParams) {
  const permission = await requireWorkspaceRole(db, actor, slug, ANALYST_ROLES)
  const xAxis = textParam(params.x_axis)
  const yAxis = textParam(params.y_axis)
  const segment = textParam(params.segment) || false
  validateAxes(xAxis, yAxis, segment)
  // Only issues of projects the user is an active member of.
  const where = issuesWhere({ workspaceId: permission.workspaceId, userId: actor.userId }, issueFilters(params, 'GET'))
  const [total, distribution, details] = await Promise.all([
    countRows(db, 'issues', where),
    buildGraphPlot(db, where, xAxis as string, yAxis as string, segment),
    loadPlotDetails(db, where, xAxis as string, segment)
  ])
  const used = (field: string) => xAxis === field || segment === field
  return {
    total,
    distribution,
    extras: {
      state_details: used('state_id') ? details.state : {},
      assignee_details: used('assignees__id') ? details.assignee : {},
      label_details: used('labels__id') ? details.label : {},
      cycle_details: used('issue_cycle__cycle_id') ? details.cycle : {},
      module_details: used('issue_module__module_id') ? details.module : {}
    }
  }
}

const OPEN_GROUPS = sql`s."group" in ('backlog', 'unstarted', 'started')`

/** PD-0418 `DefaultAnalyticsEndpoint.get`: state totals, completions per month, top creators and assignees, estimate sums. */
export async function getDefaultAnalytics(
  db: LancityDb,
  actor: Actor,
  slug: string,
  params: FilterParams,
  now = new Date()
) {
  const permission = await requireWorkspaceRole(db, actor, slug, [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
  const where = issuesWhere({ workspaceId: permission.workspaceId, userId: actor.userId }, issueFilters(params, 'GET'))
  const base = sql`from issues left join states s on s.id = issues.state_id where ${where}`
  const open = sql`${base} and ${OPEN_GROUPS}`
  const userCols = (
    alias: string
  ) => sql`u.name as ${sql.raw(`${alias}__first_name`)}, '' as ${sql.raw(`${alias}__last_name`)},
    coalesce(nullif(u.display_username, ''), u.username, u.name) as ${sql.raw(`${alias}__display_name`)}, u.image as ${sql.raw(`${alias}__avatar_url`)}`
  const [totals, classified, openTotals, openClassified, monthWise, created, closed, pending, estimates] =
    await Promise.all([
      db.all<{ n: number }>(sql`select count(*) as n ${base}`),
      db.all(
        sql`select s."group" as state_group, count(s."group") as state_count ${base} group by s."group" order by s."group"`
      ),
      db.all<{ n: number }>(sql`select count(*) as n ${open}`),
      db.all(
        sql`select s."group" as state_group, count(s."group") as state_count ${open} group by s."group" order by s."group"`
      ),
      db.all(
        sql`select cast(strftime('%m', issues.completed_at / 1000, 'unixepoch') as integer) as month, count(*) as count ${base}
        and strftime('%Y', issues.completed_at / 1000, 'unixepoch') = ${String(now.getUTCFullYear())}
        group by month order by month`
      ),
      db.all(
        sql`select ${userCols('created_by')}, issues.created_by_id as created_by__id, count(issues.id) as count
        from issues left join states s on s.id = issues.state_id join "user" u on u.id = issues.created_by_id
        where ${where} group by issues.created_by_id order by count desc limit 5`
      ),
      db.all(
        sql`select ${userCols('assignees')}, ia.assignee_id as assignees__id, count(issues.id) as count
        from issues left join states s on s.id = issues.state_id
          join issue_assignees ia on ia.issue_id = issues.id and ia.deleted_at is null join "user" u on u.id = ia.assignee_id
        where ${where} and issues.completed_at is not null group by ia.assignee_id order by count desc limit 5`
      ),
      db.all(
        sql`select ${userCols('assignees')}, ia.assignee_id as assignees__id, count(issues.id) as count
        from issues left join states s on s.id = issues.state_id
          left join issue_assignees ia on ia.issue_id = issues.id and ia.deleted_at is null left join "user" u on u.id = ia.assignee_id
        where ${where} and issues.completed_at is null group by ia.assignee_id order by count desc`
      ),
      db.all<{ open_sum: number | null; total_sum: number | null }>(
        sql`select sum(issues.point) filter (where ${OPEN_GROUPS}) as open_sum, sum(issues.point) as total_sum ${base}`
      )
    ])
  return {
    total_issues: Number(totals[0]?.n ?? 0),
    total_issues_classified: classified,
    open_issues: Number(openTotals[0]?.n ?? 0),
    open_issues_classified: openClassified,
    issue_completed_month_wise: monthWise,
    most_issue_created_user: created,
    most_issue_closed_user: closed,
    pending_issue_user: pending,
    open_estimate_sum: estimates[0]?.open_sum ?? null,
    total_estimate_sum: estimates[0]?.total_sum ?? null
  }
}

const PROJECT_STAT_FIELDS = [
  'total_issues',
  'completed_issues',
  'total_members',
  'total_cycles',
  'total_modules'
] as const

/**
 * PD-0419 `ProjectStatsEndpoint.get`: counts per project for the requested `fields` (all by default). Admins see every
 * project, members the projects they belong to plus public ones, guests only their own. `project_ids` narrows the list.
 */
export async function getProjectStats(db: LancityDb, actor: Actor, slug: string, query: ProjectStatsQuery) {
  const permission = await requireWorkspaceRole(db, actor, slug, [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
  const asked = new Set((query.fields ?? '').split(','))
  const requested = PROJECT_STAT_FIELDS.filter(field => asked.has(field))
  const fields = requested.length ? requested : PROJECT_STAT_FIELDS
  const memberOf = sql`p.id in (select pm.project_id from project_members pm where pm.workspace_id = ${permission.workspaceId}
    and pm.member_id = ${actor.userId} and pm.is_active = 1 and pm.deleted_at is null)`
  const visible =
    permission.workspaceRole === ROLE.ADMIN
      ? sql`1 = 1`
      : permission.workspaceRole === ROLE.MEMBER
        ? sql`(${memberOf} or p.network = 2)`
        : memberOf
  const ids = (query.project_ids ?? '')
    .split(',')
    .map(Number)
    .filter(id => Number.isSafeInteger(id) && id > 0)
    .slice(0, 80)
  const idFilter = ids.length
    ? sql` and p.id in (${sql.join(
        ids.map(id => sql`${id}`),
        sql`, `
      )})`
    : sql``
  const columns = {
    total_issues: sql`(select count(*) from issues where issues.project_id = p.id and ${LIVE_ISSUES}) as total_issues`,
    completed_issues: sql`(select count(*) from issues join states cs on cs.id = issues.state_id
      where issues.project_id = p.id and ${LIVE_ISSUES} and cs."group" in ('completed', 'cancelled')) as completed_issues`,
    total_cycles: sql`(select count(*) from cycles c where c.project_id = p.id and c.deleted_at is null) as total_cycles`,
    total_modules: sql`(select count(*) from modules m where m.project_id = p.id and m.deleted_at is null) as total_modules`,
    total_members: sql`(select count(*) from project_members pmc where pmc.project_id = p.id and pmc.is_active = 1
      and pmc.deleted_at is null and not exists (select 1 from user_security us where us.user_id = pmc.member_id and us.is_bot = 1)) as total_members`
  }
  return db.all(
    sql`select p.id as id, ${sql.join(
      fields.map(field => columns[field]),
      sql`, `
    )} from projects p
      where p.workspace_id = ${permission.workspaceId} and p.deleted_at is null and ${visible}${idFilter}
      order by p.created_at desc, p.id desc`
  )
}

/** What `AnalyticViewSerializer` stores in `query`: the filters of `query_dict`, without the axes. */
function analyticQuery(queryDict: Record<string, JsonValue> | undefined): Record<string, JsonValue> {
  if (!queryDict || !Object.keys(queryDict).length) return {}
  return Object.fromEntries(Object.entries(queryDict).filter(([key]) => !['x_axis', 'y_axis', 'segment'].includes(key)))
}

/** PD-0415 and PD-0411 `AnalyticViewViewset.list`. */
export async function listAnalyticViews(db: LancityDb, actor: Actor, slug: string) {
  const { workspaceId } = await requireWorkspaceRole(db, actor, slug, ANALYST_ROLES)
  return (await queryAnalyticView(db, workspaceId)).map(presentAnalyticView)
}

/** PD-0413 `AnalyticViewViewset.retrieve`. */
export async function getAnalyticView(db: LancityDb, actor: Actor, slug: string, viewId: number) {
  const { workspaceId } = await requireWorkspaceRole(db, actor, slug, ANALYST_ROLES)
  const [row] = await queryAnalyticView(db, workspaceId, viewId)
  if (!row) throw notFoundError()
  return presentAnalyticView(row)
}

/** PD-0414 `perform_create` with PD-0294 `AnalyticViewSerializer.create`: `query` is derived from `query_dict`. */
export async function createAnalyticView(db: LancityDb, actor: Actor, slug: string, input: AnalyticViewInput) {
  const { workspaceId } = await requireWorkspaceRole(db, actor, slug, ANALYST_ROLES)
  const [row] = await db
    .insert(analyticViews)
    .values({
      name: input.name,
      description: input.description ?? '',
      queryDict: input.query_dict ?? {},
      query: analyticQuery(input.query_dict),
      workspaceId,
      ...auditFields(actor, 'insert')
    })
    .returning()
  return presentAnalyticView(row)
}

/**
 * PD-0295 `AnalyticViewSerializer.update`. Plane reads the filters from `query_data`, a key nobody sends, so every
 * update emptied `query`. Here `query` follows `query_dict` when it is sent and is kept otherwise.
 */
export async function updateAnalyticView(
  db: LancityDb,
  actor: Actor,
  slug: string,
  viewId: number,
  input: AnalyticViewUpdate
) {
  const { workspaceId } = await requireWorkspaceRole(db, actor, slug, ANALYST_ROLES)
  const [existing] = await queryAnalyticView(db, workspaceId, viewId)
  if (!existing) throw notFoundError()
  const [row] = await db
    .update(analyticViews)
    .set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.query_dict === undefined
        ? {}
        : { queryDict: input.query_dict, query: analyticQuery(input.query_dict) }),
      ...auditFields(actor, 'update')
    })
    .where(
      and(eq(analyticViews.id, viewId), eq(analyticViews.workspaceId, workspaceId), isNull(analyticViews.deletedAt))
    )
    .returning()
  return presentAnalyticView(row)
}

/** PD-0410 `AnalyticViewViewset.destroy`: soft delete. */
export async function deleteAnalyticView(db: LancityDb, actor: Actor, slug: string, viewId: number) {
  const { workspaceId } = await requireWorkspaceRole(db, actor, slug, ANALYST_ROLES)
  const [existing] = await queryAnalyticView(db, workspaceId, viewId)
  if (!existing) throw notFoundError()
  await db
    .update(analyticViews)
    .set({ deletedAt: new Date(), ...auditFields(actor, 'update') })
    .where(eq(analyticViews.id, viewId))
}

/** PD-0416 `SavedAnalyticEndpoint.get`: the distribution of a saved view, with an optional `segment` from the request. */
export async function getSavedAnalytic(
  db: LancityDb,
  actor: Actor,
  slug: string,
  analyticId: number,
  params: FilterParams
) {
  const { workspaceId } = await requireWorkspaceRole(db, actor, slug, ANALYST_ROLES)
  const [view] = await queryAnalyticView(db, workspaceId, analyticId)
  if (!view) throw notFoundError()
  const saved = view.query && typeof view.query === 'object' && !Array.isArray(view.query) ? view.query : {}
  const dict =
    view.queryDict && typeof view.queryDict === 'object' && !Array.isArray(view.queryDict) ? view.queryDict : {}
  const scope: AnalyticsScope = { workspaceId, userId: actor.userId }
  const where = issuesWhere(scope, issueFilters(filterParamsOf(saved), 'POST'))
  const xAxis = dict.x_axis
  const yAxis = dict.y_axis
  const segment = textParam(params.segment) || false
  validateAxes(xAxis, yAxis, segment)
  const [distribution, total] = await Promise.all([
    buildGraphPlot(db, where, xAxis as string, yAxis as string, segment),
    countRows(db, 'issues', where)
  ])
  return { total, distribution }
}

/**
 * PD-0417 `ExportAnalyticsEndpoint.post`: validates the axes, records the export and queues the job that emails the CSV.
 * `env` is the Worker env of the request (the queue binding).
 */
export async function exportAnalytics(
  db: LancityDb,
  actor: Actor,
  slug: string,
  body: ExportAnalyticsInput,
  env: InfraEnv
) {
  const { workspaceId } = await requireWorkspaceRole(db, actor, slug, ANALYST_ROLES)
  validateAxes(body.x_axis, body.y_axis, body.segment)
  const [account] = await db.select({ email: user.email }).from(user).where(eq(user.id, actor.userId)).limit(1)
  if (!account) throw notFoundError()
  const [row] = await db
    .insert(analyticExports)
    .values({ workspaceId, userId: actor.userId, email: account.email, params: body as Record<string, unknown> })
    .returning({ id: analyticExports.id })
  await enqueueJob(env, { type: ANALYTICS_JOB.exportPlot, payload: { exportId: row.id } })
  return { message: `Once the export is ready it will be emailed to you at ${account.email}`, exportId: row.id }
}

/** The completed export `exportId` of the caller, for the download route. Other users' exports are 404. */
export async function getAnalyticExport(db: LancityDb, actor: Actor, slug: string, exportId: number) {
  const { workspaceId } = await requireWorkspaceRole(db, actor, slug, ANALYST_ROLES)
  const [row] = await db
    .select()
    .from(analyticExports)
    .where(
      and(
        eq(analyticExports.id, exportId),
        eq(analyticExports.workspaceId, workspaceId),
        eq(analyticExports.userId, actor.userId)
      )
    )
    .limit(1)
  if (!row || row.status !== 'completed' || !row.objectKey) throw notFoundError('The export is not available.')
  return row
}
