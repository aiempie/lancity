import { sql, type SQL } from 'drizzle-orm'
import { getAnalyticsFilters, type AnalyticsFilters } from '@/server/common/date-utils'
import { ServiceError } from '@/server/common/errors'
import { requireWorkspaceRole, ROLE } from '@/server/common/permissions'
import {
  countRows,
  createdOnDays,
  createdWithin,
  inVisibleProjects,
  isoDay,
  issuesWhere,
  projectRowsWhere,
  STATE_GROUP_COUNTS,
  visibleProjectsSql,
  type AnalyticsScope
} from '@/server/analytics/queries'
import { buildAnalyticsChart } from '@/server/analytics/build-chart'
import type { AdvanceAnalyticsQuery } from '@/types/reporting/p3-analytics-schema'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

/** What one request needs: the workspace, the caller, the issue scope and the parsed date filters. */
export type AdvanceContext = {
  db: LancityDb
  slug: string
  workspaceId: number
  userId: number
  scope: AnalyticsScope
  filters: AnalyticsFilters
  now: Date
}

/** A table and the condition that selects its rows; `createdAt` is the column the date filters apply to. */
export type CountSource = { from: string; where: SQL; createdAt: string }

export const invalidType = (what: 'tab' | 'type') =>
  new ServiceError(400, `INVALID_${what.toUpperCase()}`, `Invalid ${what}`)

/**
 * PD-0395 `AdvanceAnalyticsBaseView.initialize_workspace`: `get_analytics_filters` for the caller. `analytics`
 * endpoints use the rolling date range, `chart` endpoints the chart period.
 */
export function initializeWorkspaceAdvanceAnalyticsBase(
  db: LancityDb,
  actor: Actor,
  slug: string,
  workspaceId: number,
  type: 'analytics' | 'chart',
  query: Pick<AdvanceAnalyticsQuery, 'date_filter' | 'project_ids'>,
  now = new Date()
): AdvanceContext {
  const filters = getAnalyticsFilters(slug, actor.userId, type, query.date_filter, query.project_ids, now)
  const scope: AnalyticsScope = { workspaceId, userId: actor.userId, projectIds: filters.baseFilters.projectIds }
  return { db, slug, workspaceId, userId: actor.userId, scope, filters, now }
}

/** PD-0397 `get_filtered_count`: rows of the source created in the current period (all rows without a date filter). */
export async function getFilteredCount(ctx: AdvanceContext, source: CountSource): Promise<number> {
  const range = ctx.filters.analyticsDateRange?.current
  return countRows(
    ctx.db,
    source.from,
    sql`${source.where}${range ? sql` and ${createdWithin(source.createdAt, range)}` : sql``}`
  )
}

/** PD-0398 `get_previous_count`: the same count for the previous period, 0 without one. Plane defines it but does not use it. */
export async function getPreviousCount(ctx: AdvanceContext, source: CountSource): Promise<number> {
  const previous = ctx.filters.analyticsDateRange?.previous
  if (!previous) return 0
  return countRows(ctx.db, source.from, sql`${source.where} and ${createdWithin(source.createdAt, previous)}`)
}

/** PD-0396 `get_filtered_counts`. */
export async function getFilteredCountsAdvanceAnalytics(ctx: AdvanceContext, source: CountSource) {
  return { count: await getFilteredCount(ctx, source) }
}

/** `Issue.issue_objects.filter(state__group=...)` as a count source. */
export const stateGroupCondition = (group: string): SQL =>
  sql`exists (select 1 from states sg where sg.id = issues.state_id and sg."group" = ${group})`

/** The five work item counts shared by the workspace and project endpoints (`get_work_items_stats`). */
export async function workItemCounts(ctx: AdvanceContext, baseWhere: SQL) {
  const count = (extra?: SQL) =>
    getFilteredCountsAdvanceAnalytics(ctx, {
      from: 'issues',
      where: extra ? sql`${baseWhere} and ${extra}` : baseWhere,
      createdAt: 'issues.created_at'
    })
  const [total, started, backlog, unStarted, completed] = await Promise.all([
    count(),
    count(stateGroupCondition('started')),
    count(stateGroupCondition('backlog')),
    count(stateGroupCondition('unstarted')),
    count(stateGroupCondition('completed'))
  ])
  return {
    total_work_items: total,
    started_work_items: started,
    backlog_work_items: backlog,
    un_started_work_items: unStarted,
    completed_work_items: completed
  }
}

/** Plane `member__is_bot=False`: bot flag lives in `user_security`. */
const notBot = (column: string) =>
  sql`not exists (select 1 from user_security us where us.user_id = ${sql.raw(column)} and us.is_bot = 1)`

/** PD-0399 `get_overview_data`: members, projects, work items, cycles and intake counts. */
export async function getOverviewDataAdvanceAnalytics(ctx: AdvanceContext, hasProjectIds: boolean) {
  // With `project_ids` the members are those of the selected projects, otherwise the workspace members.
  const members = (role?: number): CountSource =>
    hasProjectIds
      ? {
          from: 'project_members',
          where: sql`project_members.project_id in (${visibleProjectsSql(ctx.scope)}) and project_members.is_active = 1
            and project_members.deleted_at is null and ${notBot('project_members.member_id')}${role === undefined ? sql`` : sql` and project_members.role = ${role}`}`,
          createdAt: 'project_members.created_at'
        }
      : {
          from: 'workspace_members',
          where: sql`workspace_members.workspace_id = ${ctx.workspaceId} and workspace_members.is_active = 1
            and workspace_members.deleted_at is null and ${notBot('workspace_members.member_id')}${role === undefined ? sql`` : sql` and workspace_members.role = ${role}`}`,
          createdAt: 'workspace_members.created_at'
        }
  const count = (source: CountSource) => getFilteredCountsAdvanceAnalytics(ctx, source)
  const [users, admins, membersCount, guests, projects, workItems, cycles, intake] = await Promise.all([
    count(members()),
    count(members(ROLE.ADMIN)),
    count(members(ROLE.MEMBER)),
    count(members(ROLE.GUEST)),
    count({
      from: 'projects',
      where: sql`projects.id in (${visibleProjectsSql(ctx.scope)})`,
      createdAt: 'projects.created_at'
    }),
    count({ from: 'issues', where: issuesWhere(ctx.scope), createdAt: 'issues.created_at' }),
    count({ from: 'cycles', where: projectRowsWhere('cycles', ctx.scope), createdAt: 'cycles.created_at' }),
    // `Issue.objects` (triage items included) that have an intake record in a known status.
    count({
      from: 'issues',
      where: sql`issues.workspace_id = ${ctx.workspaceId} and issues.deleted_at is null and ${inVisibleProjects('issues.project_id', ctx.scope)}
        and exists (select 1 from intake_issues ii where ii.issue_id = issues.id and ii.deleted_at is null and ii.status in (-2, -1, 0, 1, 2))`,
      createdAt: 'issues.created_at'
    })
  ])
  return {
    total_users: users,
    total_admins: admins,
    total_members: membersCount,
    total_guests: guests,
    total_projects: projects,
    total_work_items: workItems,
    total_cycles: cycles,
    total_intake: intake
  }
}

/** PD-0400 `get_work_items_stats` of the overview tab. */
export function getWorkItemsStatsAdvanceAnalytics(ctx: AdvanceContext) {
  return workItemCounts(ctx, issuesWhere(ctx.scope))
}

/** PD-0401 `AdvanceAnalyticsEndpoint.get`: tabs `overview` (default) and `work-items`. */
export async function getAdvanceAnalytics(db: LancityDb, actor: Actor, slug: string, query: AdvanceAnalyticsQuery) {
  const permission = await requireWorkspaceRole(db, actor, slug, [ROLE.ADMIN, ROLE.MEMBER])
  const ctx = initializeWorkspaceAdvanceAnalyticsBase(db, actor, slug, permission.workspaceId, 'analytics', query)
  const tab = query.tab ?? 'overview'
  if (tab === 'overview') return getOverviewDataAdvanceAnalytics(ctx, Boolean(query.project_ids))
  if (tab === 'work-items') return getWorkItemsStatsAdvanceAnalytics(ctx)
  throw invalidType('tab')
}

/** PD-0402 `get_project_issues_stats`: per project counts by state group within the chart period. */
export function getProjectIssuesStatsAdvanceAnalyticsStats(ctx: AdvanceContext) {
  return ctx.db.all<Record<string, unknown>>(
    sql`select issues.project_id as project_id, p.name as project__name, ${STATE_GROUP_COUNTS}
      from issues join projects p on p.id = issues.project_id left join states s on s.id = issues.state_id
      where ${issuesWhere(ctx.scope, [createdOnDays('issues.created_at', ctx.filters.chartPeriodRange)])}
      group by issues.project_id, p.name order by issues.project_id`
  )
}

/** PD-0403 `get_work_items_stats` of the stats endpoint: the same per project counts without a date filter. */
export function getWorkItemsStatsAdvanceAnalyticsStats(ctx: AdvanceContext) {
  return ctx.db.all<Record<string, unknown>>(
    sql`select issues.project_id as project_id, p.name as project__name, ${STATE_GROUP_COUNTS}
      from issues join projects p on p.id = issues.project_id left join states s on s.id = issues.state_id
      where ${issuesWhere(ctx.scope)}
      group by issues.project_id, p.name order by issues.project_id`
  )
}

/** PD-0404 `AdvanceAnalyticsStatsEndpoint.get`. */
export async function getAdvanceAnalyticsStats(
  db: LancityDb,
  actor: Actor,
  slug: string,
  query: AdvanceAnalyticsQuery
) {
  const permission = await requireWorkspaceRole(db, actor, slug, [ROLE.ADMIN, ROLE.MEMBER])
  const ctx = initializeWorkspaceAdvanceAnalyticsBase(db, actor, slug, permission.workspaceId, 'chart', query)
  if ((query.type ?? 'work-items') === 'work-items') return getWorkItemsStatsAdvanceAnalyticsStats(ctx)
  throw invalidType('type')
}

/** Python `str.title()` of a `snake_case` key. */
export const titleCase = (key: string): string =>
  key.replaceAll('_', ' ').replace(/[A-Za-z]+/g, word => word[0].toUpperCase() + word.slice(1).toLowerCase())

/** PD-0405 `project_chart`: how many work items, cycles, modules, intake items, members, pages and views exist. */
export async function projectChartAdvanceAnalyticsChart(ctx: AdvanceContext) {
  const period = ctx.filters.chartPeriodRange
  const count = (from: string, where: SQL, column: string) =>
    countRows(ctx.db, from, sql`${where}${period ? sql` and ${createdOnDays(column, period)}` : sql``}`)
  const [workItems, cycles, modules, intake, members, pages, views] = await Promise.all([
    count('issues', issuesWhere(ctx.scope), 'issues.created_at'),
    count('cycles', projectRowsWhere('cycles', ctx.scope), 'cycles.created_at'),
    count('modules', projectRowsWhere('modules', ctx.scope), 'modules.created_at'),
    count(
      'issues',
      sql`issues.workspace_id = ${ctx.workspaceId} and issues.deleted_at is null and ${inVisibleProjects('issues.project_id', ctx.scope)}
        and exists (select 1 from intake_issues ii where ii.issue_id = issues.id and ii.deleted_at is null)`,
      'issues.created_at'
    ),
    count(
      'workspace_members',
      sql`workspace_members.workspace_id = ${ctx.workspaceId} and workspace_members.is_active = 1 and workspace_members.deleted_at is null`,
      'workspace_members.created_at'
    ),
    count('project_pages', projectRowsWhere('project_pages', ctx.scope), 'project_pages.created_at'),
    count('issue_views', projectRowsWhere('issue_views', ctx.scope), 'issue_views.created_at')
  ])
  const data = { work_items: workItems, cycles, modules, intake, members, pages, views }
  return Object.entries(data).map(([key, value]) => ({ key, name: titleCase(key), count: value || 0 }))
}

export type MonthStats = Record<string, { created_count: number; completed_count: number }>

/** Same day next month; a day that does not exist there (31st into a 30 day month) moves to the month's last day. */
export function addMonth(date: Date): Date {
  const year = date.getUTCFullYear() + (date.getUTCMonth() === 11 ? 1 : 0)
  const month = (date.getUTCMonth() + 1) % 12
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), last)))
}

/**
 * The month by month rows of the work item completion charts. Plane starts at `start`, adds one month at a time up
 * to the first day of the current month, and looks each step up by its date string, so a start that is not the 1st
 * (a chart period) finds no counts.
 */
export function monthlyChartData(stats: MonthStats, start: Date, now: Date) {
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const data: { key: string; name: string; count: number; completed_issues: number; created_issues: number }[] = []
  for (let current = start; current <= lastMonth; current = addMonth(current)) {
    const key = isoDay(current)
    const item = stats[key] ?? { created_count: 0, completed_count: 0 }
    data.push({
      key,
      name: key,
      count: item.created_count,
      completed_issues: item.completed_count,
      created_issues: item.created_count
    })
  }
  return data
}

export const COMPLETION_SCHEMA = { completed_issues: 'completed_issues', created_issues: 'created_issues' }

/** Issues per creation month with how many are in a completed state, keyed `YYYY-MM-01`. */
export async function monthlyIssueStats(db: LancityDb, where: SQL): Promise<MonthStats> {
  const rows = await db.all<{ month: string; created_count: number; completed_count: number }>(
    sql`select strftime('%Y-%m-01', issues.created_at / 1000, 'unixepoch') as month, count(*) as created_count,
        count(*) filter (where s."group" = 'completed') as completed_count
      from issues left join states s on s.id = issues.state_id where ${where} group by month order by month`
  )
  return Object.fromEntries(
    rows.map(row => [
      row.month,
      { created_count: Number(row.created_count), completed_count: Number(row.completed_count) }
    ])
  )
}

/** PD-0406 `work_item_completion_chart`: created and completed work items per month since the workspace was created. */
export async function workItemCompletionChartAdvanceAnalyticsChart(ctx: AdvanceContext) {
  const [workspace] = await ctx.db.all<{ created_at: number }>(
    sql`select created_at from workspaces where id = ${ctx.workspaceId}`
  )
  const created = new Date(Number(workspace?.created_at ?? ctx.now.getTime()))
  let start = new Date(Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), 1))
  const period = ctx.filters.chartPeriodRange
  if (period) start = period[0]
  const stats = await monthlyIssueStats(ctx.db, issuesWhere(ctx.scope, [createdOnDays('issues.created_at', period)]))
  return { data: monthlyChartData(stats, start, ctx.now), schema: COMPLETION_SCHEMA }
}

/** PD-0407 `AdvanceAnalyticsChartEndpoint.get`: types `projects` (default), `custom-work-items` and `work-items`. */
export async function getAdvanceAnalyticsChart(
  db: LancityDb,
  actor: Actor,
  slug: string,
  query: AdvanceAnalyticsQuery
) {
  const permission = await requireWorkspaceRole(db, actor, slug, [ROLE.ADMIN, ROLE.MEMBER])
  const ctx = initializeWorkspaceAdvanceAnalyticsBase(db, actor, slug, permission.workspaceId, 'chart', query)
  const type = query.type ?? 'projects'
  if (type === 'projects') return projectChartAdvanceAnalyticsChart(ctx)
  if (type === 'custom-work-items')
    return buildAnalyticsChart(
      db,
      issuesWhere(ctx.scope, [createdOnDays('issues.created_at', ctx.filters.chartPeriodRange)]),
      query.x_axis ?? 'PRIORITY',
      query.group_by
    )
  if (type === 'work-items') return workItemCompletionChartAdvanceAnalyticsChart(ctx)
  throw invalidType('type')
}
