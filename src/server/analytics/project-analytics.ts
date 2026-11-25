import { sql } from 'drizzle-orm'
import { buildAnalyticsChart } from '@/server/analytics/build-chart'
import {
  COMPLETION_SCHEMA,
  getFilteredCount as getFilteredCountAdvance,
  getFilteredCountsAdvanceAnalytics,
  getProjectIssuesStatsAdvanceAnalyticsStats,
  initializeWorkspaceAdvanceAnalyticsBase,
  invalidType,
  monthlyChartData,
  monthlyIssueStats,
  workItemCounts,
  type AdvanceContext,
  type CountSource
} from '@/server/analytics/advance'
import {
  createdOnDays,
  isoDay,
  projectIssuesWhere,
  STATE_GROUP_COUNTS,
  userDisplayName
} from '@/server/analytics/queries'
import { requireProjectRole, ROLE } from '@/server/common/permissions'
import type { AdvanceAnalyticsQuery } from '@/types/reporting/p3-analytics-schema'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

/** Which issues a project endpoint looks at: the whole project, or one of its cycles or modules. */
export type ProjectTarget = { projectId: number; cycleId?: number; moduleId?: number }

/** PD-0420 `ProjectAdvanceAnalyticsBaseView.initialize_workspace`: same filters as the workspace endpoints. */
export const initializeWorkspaceProjectAdvanceAnalyticsBase = initializeWorkspaceAdvanceAnalyticsBase

/** PD-0422 `get_filtered_count` of the project endpoint. */
export const getFilteredCount: (ctx: AdvanceContext, source: CountSource) => Promise<number> = getFilteredCountAdvance

/** PD-0421 `get_filtered_counts`. */
export const getFilteredCountsProjectAdvanceAnalytics = getFilteredCountsAdvanceAnalytics

/** PD-0423 `get_work_items_stats` of the overview endpoint. */
export function getWorkItemsStatsProjectAdvanceAnalytics(ctx: AdvanceContext, target: ProjectTarget) {
  return workItemCounts(ctx, projectIssuesWhere(ctx.scope, target))
}

/** PD-0424 `ProjectAdvanceAnalyticsEndpoint.get`. */
export async function getProjectAdvanceAnalytics(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  query: AdvanceAnalyticsQuery
) {
  const permission = await requireProjectRole(db, actor, slug, projectId, [ROLE.ADMIN, ROLE.MEMBER])
  const ctx = initializeWorkspaceProjectAdvanceAnalyticsBase(
    db,
    actor,
    slug,
    permission.workspaceId,
    'analytics',
    query
  )
  return getWorkItemsStatsProjectAdvanceAnalytics(ctx, {
    projectId,
    cycleId: query.cycle_id,
    moduleId: query.module_id
  })
}

/** PD-0425 `get_project_issues_stats`: per project counts by state group (Plane runs it over the whole workspace scope). */
export const getProjectIssuesStatsProjectAdvanceAnalyticsStats = getProjectIssuesStatsAdvanceAnalyticsStats

/** PD-0426 `get_work_items_stats` of the stats endpoint: counts by state group for every assignee. */
export function getWorkItemsStatsProjectAdvanceAnalyticsStats(ctx: AdvanceContext, target: ProjectTarget) {
  return ctx.db.all<Record<string, unknown>>(
    sql`select ${userDisplayName('u')} as display_name, ia.assignee_id as assignee_id, u.image as avatar_url, ${STATE_GROUP_COUNTS}
      from issues left join issue_assignees ia on ia.issue_id = issues.id and ia.deleted_at is null
        left join "user" u on u.id = ia.assignee_id left join states s on s.id = issues.state_id
      where ${projectIssuesWhere(ctx.scope, target)}
      group by ia.assignee_id, u.display_username, u.username, u.name, u.image
      order by display_name is null, display_name`
  )
}

/** PD-0427 `ProjectAdvanceAnalyticsStatsEndpoint.get`. */
export async function getProjectAdvanceAnalyticsStats(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  query: AdvanceAnalyticsQuery
) {
  const permission = await requireProjectRole(db, actor, slug, projectId, [ROLE.ADMIN, ROLE.MEMBER])
  const ctx = initializeWorkspaceProjectAdvanceAnalyticsBase(db, actor, slug, permission.workspaceId, 'chart', query)
  if ((query.type ?? 'work-items') === 'work-items')
    return getWorkItemsStatsProjectAdvanceAnalyticsStats(ctx, {
      projectId,
      cycleId: query.cycle_id,
      moduleId: query.module_id
    })
  throw invalidType('type')
}

const DAY_MS = 86_400_000

/** Every day from `start` to `end`, both `YYYY-MM-DD`. */
function daysBetween(start: string, end: string): string[] {
  const from = Date.parse(`${start}T00:00:00Z`)
  const to = Date.parse(`${end}T00:00:00Z`)
  if (Number.isNaN(from) || Number.isNaN(to)) return []
  return Array.from({ length: Math.max(0, Math.round((to - from) / DAY_MS) + 1) }, (_, offset) =>
    isoDay(new Date(from + offset * DAY_MS))
  )
}

/**
 * PD-0428 `work_item_completion_chart`: per day for a cycle or module (links created and links whose issue is
 * completed, between its dates), per month for the whole project. Without dates a cycle or module chart is empty.
 */
export async function workItemCompletionChartProjectAdvanceAnalyticsChart(ctx: AdvanceContext, target: ProjectTarget) {
  const entity = target.cycleId !== undefined ? 'cycle' : target.moduleId !== undefined ? 'module' : null
  if (entity) {
    const id = (entity === 'cycle' ? target.cycleId : target.moduleId) as number
    // Plane looks the cycle up by id only; the workspace condition keeps other workspaces' dates out.
    const [row] = await ctx.db.all<{ start_date: number | string | null; end_date: number | string | null }>(
      entity === 'cycle'
        ? sql`select start_date, end_date from cycles where id = ${id} and workspace_id = ${ctx.workspaceId} and deleted_at is null`
        : sql`select start_date, target_date as end_date from modules where id = ${id} and workspace_id = ${ctx.workspaceId} and deleted_at is null`
    )
    if (!row || row.start_date === null || row.end_date === null) return { data: [], schema: {} }
    const toDay = (value: number | string) =>
      typeof value === 'number' ? isoDay(new Date(value)) : String(value).slice(0, 10)
    const link = entity === 'cycle' ? 'cycle_issues' : 'module_issues'
    const column = entity === 'cycle' ? 'cycle_id' : 'module_id'
    const rows = await ctx.db.all<{ day: string; created_count: number; completed_count: number }>(
      sql`select date(l.created_at / 1000, 'unixepoch') as day, count(*) as created_count,
          count(*) filter (where s."group" = 'completed') as completed_count
        from ${sql.raw(link)} l join issues i on i.id = l.issue_id and i.deleted_at is null
          left join states s on s.id = i.state_id
        where l.${sql.raw(column)} = ${id} and l.deleted_at is null and l.workspace_id = ${ctx.workspaceId}
          and l.project_id in (select sp.id from projects sp join project_members spm on spm.project_id = sp.id
            where sp.workspace_id = ${ctx.workspaceId} and sp.deleted_at is null and sp.archived_at is null
              and spm.member_id = ${ctx.userId} and spm.is_active = 1 and spm.deleted_at is null)
        group by day`
    )
    const stats = new Map(rows.map(item => [item.day, item]))
    const data = daysBetween(toDay(row.start_date), toDay(row.end_date)).map(day => {
      const item = stats.get(day)
      const created = Number(item?.created_count ?? 0)
      const completed = Number(item?.completed_count ?? 0)
      return { key: day, name: day, count: created + completed, completed_issues: completed, created_issues: created }
    })
    return { data, schema: COMPLETION_SCHEMA }
  }
  const [project] = await ctx.db.all<{ created_at: number }>(
    sql`select created_at from projects where id = ${target.projectId}`
  )
  if (!project) return { data: [], schema: {} }
  const created = new Date(Number(project.created_at))
  let start = new Date(Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), 1))
  const period = ctx.filters.chartPeriodRange
  if (period) start = period[0]
  const stats = await monthlyIssueStats(
    ctx.db,
    projectIssuesWhere(ctx.scope, target, [createdOnDays('issues.created_at', period)])
  )
  return { data: monthlyChartData(stats, start, ctx.now), schema: COMPLETION_SCHEMA }
}

/** PD-0429 `ProjectAdvanceAnalyticsChartEndpoint.get`: types `projects` (default, rejected), `custom-work-items` and `work-items`. */
export async function getProjectAdvanceAnalyticsChart(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  query: AdvanceAnalyticsQuery
) {
  const permission = await requireProjectRole(db, actor, slug, projectId, [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
  const ctx = initializeWorkspaceProjectAdvanceAnalyticsBase(db, actor, slug, permission.workspaceId, 'chart', query)
  const target: ProjectTarget = { projectId, cycleId: query.cycle_id, moduleId: query.module_id }
  const type = query.type ?? 'projects'
  if (type === 'custom-work-items')
    // A cycle or module narrows the project's issues; the project condition still applies.
    return buildAnalyticsChart(
      db,
      projectIssuesWhere(ctx.scope, target, [
        sql`issues.project_id = ${projectId}`,
        createdOnDays('issues.created_at', ctx.filters.chartPeriodRange)
      ]),
      query.x_axis ?? 'PRIORITY',
      query.group_by
    )
  if (type === 'work-items') return workItemCompletionChartProjectAdvanceAnalyticsChart(ctx, target)
  throw invalidType('type')
}
