import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { moduleLinks } from '@/db/schema/planning'
import { userFavorites } from '@/db/schema/notification'
import { sanitizeOrderBy } from '@/server/issue/filter'
import { LIVE_ISSUES } from '@/server/issue/list'
import type { LancityDb } from '@/types/database/schema'
import { MODULE_ORDER_BY_ALLOWLIST } from '@/types/planning/p2-module-schema'
import { numericEstimateExpr, numericEstimateOrZeroSql, numericEstimateSql } from '@/server/estimate/numeric'


/** A `modules` row with the computed columns of `moduleSelect`, snake_case as SQLite returns it. */
export type ModuleRow = Record<string, unknown>
export type ModuleScope = { workspaceId: number; projectId: number; userId: number }

const STATE_GROUPS = ['cancelled', 'completed', 'started', 'unstarted', 'backlog'] as const

const countGroup = (group: (typeof STATE_GROUPS)[number]) =>
  sql.raw(`sum(case when s."group" = '${group}' then 1 else 0 end) as ${group}_issues`)
const pointsGroup = (group: (typeof STATE_GROUPS)[number]) =>
  sql.raw(
    `sum(case when e.type = 'points' and s."group" = '${group}' then coalesce(${numericEstimateExpr('ep.value')}, 0) else 0 end) as ${group}_estimate_points`
  )

/**
 * Per-module counters of the live issues (Plane `completed_issues`, `total_issues` and the estimate point
 * subqueries of `ModuleViewSet.get_queryset`, PD-0666). One grouped join replaces the twelve correlated
 * subqueries. `scope` limits the module issues to a project or a workspace.
 */
export function moduleStatsJoin(scope: SQL) {
  return sql`left join (
    select mi.module_id as module_id, count(*) as total_issues,
      ${sql.join(STATE_GROUPS.map(countGroup), sql`, `)},
      sum(case when e.type = 'points' then ${numericEstimateOrZeroSql('ep.value')} else 0 end) as total_estimate_points,
      ${sql.join(STATE_GROUPS.map(pointsGroup), sql`, `)}
    from module_issues mi
    join issues on issues.id = mi.issue_id
    left join states s on s.id = issues.state_id
    left join estimate_points ep on ep.id = issues.estimate_point_id
    left join estimates e on e.id = ep.estimate_id
    where mi.deleted_at is null and ${scope} and ${LIVE_ISSUES}
    group by mi.module_id) st on st.module_id = modules.id`
}

/** Select list of a module row: the columns, the counters of `moduleStatsJoin`, `is_favorite` and `member_ids`. */
export function moduleSelect(userId: number) {
  const counters = [
    'total_issues',
    ...STATE_GROUPS.map(group => `${group}_issues`),
    'total_estimate_points',
    ...STATE_GROUPS.map(group => `${group}_estimate_points`)
  ].map(name => sql.raw(`coalesce(st.${name}, 0) as ${name}`))
  return sql`modules.*, ${sql.join(counters, sql`, `)},
    exists (select 1 from user_favorites f where f.user_id = ${userId} and f.entity_type = 'module'
      and f.entity_identifier = modules.id and f.deleted_at is null) as is_favorite,
    coalesce((select json_group_array(v) from (select distinct mm.member_id as v from module_members mm
      where mm.module_id = modules.id and mm.deleted_at is null)), '[]') as member_ids`
}

/** Order of the module lists. The app list floats favorites first, the API honours `order_by` from the allow-list. */
export function moduleOrderBy(orderBy: string | undefined, options: { favoriteFirst?: boolean } = {}) {
  const sanitized = sanitizeOrderBy(orderBy, MODULE_ORDER_BY_ALLOWLIST)
  const column = sql.raw(`modules.${sanitized.replace(/^-/, '')}`)
  const direction = sql.raw(sanitized.startsWith('-') ? 'desc' : 'asc')
  const order = sql`${column} ${direction}, modules.id desc`
  return options.favoriteFirst ? sql`is_favorite desc, ${order}` : order
}

export type ModuleQueryOptions = {
  /** `no` live modules (default), `only` archived modules, `any` both. */
  archived?: 'no' | 'only' | 'any'
  moduleId?: number
  orderBy?: SQL
  limit?: number
  offset?: number
}

function moduleWhere(scope: ModuleScope, options: ModuleQueryOptions) {
  const conds: SQL[] = [
    sql`modules.project_id = ${scope.projectId}`,
    sql`modules.workspace_id = ${scope.workspaceId}`,
    sql`modules.deleted_at is null`
  ]
  if ((options.archived ?? 'no') === 'no') conds.push(sql`modules.archived_at is null`)
  if (options.archived === 'only') conds.push(sql`modules.archived_at is not null`)
  if (options.moduleId !== undefined) conds.push(sql`modules.id = ${options.moduleId}`)
  return sql.join(conds, sql` and `)
}

/**
 * PD-0666 `ModuleViewSet.get_queryset`, PD-0200 `ModuleListCreateAPIEndpoint.get_queryset`, PD-0206
 * `ModuleDetailAPIEndpoint.get_queryset`, PD-0218 and PD-0660 (archived modules): the modules of one project
 * with their counters, favorite flag and member ids. Scoped to workspace and project, soft deleted rows excluded.
 */
export function queryModules(db: LancityDb, scope: ModuleScope, options: ModuleQueryOptions = {}) {
  const page = options.limit === undefined ? sql`` : sql` limit ${options.limit} offset ${options.offset ?? 0}`
  return db.all<ModuleRow>(
    sql`select ${moduleSelect(scope.userId)} from modules
      ${moduleStatsJoin(sql`mi.project_id = ${scope.projectId}`)}
      where ${moduleWhere(scope, options)} order by ${options.orderBy ?? moduleOrderBy(undefined)}${page}`
  )
}
/** Aliases for the checklist entries that only differ in the viewset that owned the queryset. */
export const queryModule = queryModules
export const queryModuleListCreateAPI = queryModules
export const queryModuleDetailAPI = queryModules
export const queryModuleArchiveUnarchive = queryModules
export const queryModuleArchiveUnarchiveAPI = queryModules

export async function countModules(db: LancityDb, scope: ModuleScope, options: ModuleQueryOptions = {}) {
  const [row] = await db.all<{ n: number }>(
    sql`select count(*) as n from modules where ${moduleWhere(scope, { ...options, moduleId: undefined })}`
  )
  return Number(row?.n ?? 0)
}

/** Modules the user can see in a workspace: live modules of the non-archived projects the user is an active member of. */
export function queryWorkspaceModules(db: LancityDb, workspaceId: number, userId: number, orderBy?: string) {
  return db.all<ModuleRow>(
    sql`select ${moduleSelect(userId)} from modules
      ${moduleStatsJoin(sql`mi.workspace_id = ${workspaceId}`)}
      where modules.workspace_id = ${workspaceId} and modules.deleted_at is null and modules.archived_at is null
        and exists (select 1 from project_members pm join projects p on p.id = pm.project_id
          where pm.project_id = modules.project_id and pm.member_id = ${userId} and pm.is_active = 1
            and pm.deleted_at is null and p.archived_at is null and p.deleted_at is null)
      order by ${moduleOrderBy(orderBy)}`
  )
}

/** PD-0679 `ModuleLinkViewSet.get_queryset`: links of one module, newest first. */
export function queryModuleLink(db: LancityDb, scope: ModuleScope, moduleId: number, linkId?: number) {
  return db
    .select()
    .from(moduleLinks)
    .where(
      and(
        eq(moduleLinks.workspaceId, scope.workspaceId),
        eq(moduleLinks.projectId, scope.projectId),
        eq(moduleLinks.moduleId, moduleId),
        linkId === undefined ? undefined : eq(moduleLinks.id, linkId),
        isNull(moduleLinks.deletedAt)
      )
    )
    .orderBy(desc(moduleLinks.createdAt), desc(moduleLinks.id))
}

/** PD-0681 `ModuleFavoriteViewSet.get_queryset`: the user's favorite modules of the project. */
export function queryModuleFavorite(db: LancityDb, scope: ModuleScope) {
  return db
    .select()
    .from(userFavorites)
    .where(
      and(
        eq(userFavorites.workspaceId, scope.workspaceId),
        eq(userFavorites.projectId, scope.projectId),
        eq(userFavorites.userId, scope.userId),
        eq(userFavorites.entityType, 'module'),
        isNull(userFavorites.deletedAt)
      )
    )
    .orderBy(desc(userFavorites.createdAt), desc(userFavorites.id))
}

/**
 * PD-0210, PD-0214 and PD-0690 `get_queryset` of the module issue endpoints: the id of the `module_issues` row
 * (Plane `bridge_id`) of each issue in a module. The issue rows come from the shared issue list with a
 * `module` filter (`moduleIssueQuery`).
 */
export async function queryModuleIssueBridges(db: LancityDb, scope: ModuleScope, moduleId: number, issueIds: number[]) {
  if (!issueIds.length) return new Map<number, number>()
  const rows = await db.all<{ id: number; issue_id: number }>(
    sql`select id, issue_id from module_issues where module_id = ${moduleId} and project_id = ${scope.projectId}
      and workspace_id = ${scope.workspaceId} and deleted_at is null
      and issue_id in (${sql.join(
        issueIds.map(issueId => sql`${issueId}`),
        sql`, `
      )})`
  )
  return new Map(rows.map(row => [row.issue_id, row.id]))
}

/** The issue list query that limits the shared issue list to one module. */
export const moduleIssueQuery = <T extends Record<string, unknown>>(query: T, moduleId: number) => ({
  ...query,
  module: String(moduleId)
})

// ------------------------------------------------------------------ detail: distributions and burndown

type Distribution = Record<string, unknown>
const notArchivedNotDraft = sql`issues.archived_at is null and issues.is_draft = 0`
const completed = sql`issues.completed_at is not null and ${notArchivedNotDraft}`
const pending = sql`issues.completed_at is null and ${notArchivedNotDraft}`

function moduleIssuesFrom(moduleId: number, projectId: number) {
  return sql`from module_issues mi join issues on issues.id = mi.issue_id
    left join estimate_points ep on ep.id = issues.estimate_point_id
    where mi.module_id = ${moduleId} and mi.project_id = ${projectId} and mi.deleted_at is null and ${LIVE_ISSUES}`
}

/** Assignee and label breakdown of the module detail (`distribution`, or `estimate_distribution` for points). */
export async function queryModuleDistribution(
  db: LancityDb,
  scope: Pick<ModuleScope, 'projectId'>,
  moduleId: number,
  kind: 'issues' | 'points'
): Promise<{ assignees: Distribution[]; labels: Distribution[] }> {
  const value = numericEstimateSql('ep.value')
  const measures =
    kind === 'issues'
      ? sql`sum(case when ${notArchivedNotDraft} then 1 else 0 end) as total_issues,
        sum(case when ${completed} then 1 else 0 end) as completed_issues,
        sum(case when ${pending} then 1 else 0 end) as pending_issues`
      : sql`sum(${value}) as total_estimates,
        sum(case when ${completed} then ${value} end) as completed_estimates,
        sum(case when ${pending} then ${value} end) as pending_estimates`
  const [assignees, labels] = await Promise.all([
    db.all<Distribution>(
      sql`select p.first_name as first_name, p.last_name as last_name, u.id as assignee_id, u.image as avatar_url,
        coalesce(u.username, u.name) as display_name, ${measures}
        from module_issues mi join issues on issues.id = mi.issue_id
        left join estimate_points ep on ep.id = issues.estimate_point_id
        left join issue_assignees ia on ia.issue_id = issues.id and ia.deleted_at is null
        left join "user" u on u.id = ia.assignee_id
        left join profiles p on p.user_id = u.id
        where mi.module_id = ${moduleId} and mi.project_id = ${scope.projectId} and mi.deleted_at is null and ${LIVE_ISSUES}
        group by u.id order by p.first_name is null, p.first_name, p.last_name`
    ),
    db.all<Distribution>(
      sql`select l.name as label_name, l.color as color, l.id as label_id, ${measures}
        from module_issues mi join issues on issues.id = mi.issue_id
        left join estimate_points ep on ep.id = issues.estimate_point_id
        left join issue_labels il on il.issue_id = issues.id and il.deleted_at is null
        left join labels l on l.id = il.label_id
        where mi.module_id = ${moduleId} and mi.project_id = ${scope.projectId} and mi.deleted_at is null and ${LIVE_ISSUES}
        group by l.id order by l.name is null, l.name`
    )
  ])
  return { assignees, labels }
}

/** Number of live sub issues in a module (`sub_issues` annotation of the module detail). */
export async function countModuleSubIssues(db: LancityDb, scope: Pick<ModuleScope, 'projectId'>, moduleId: number) {
  const [row] = await db.all<{ n: number }>(
    sql`select count(*) as n ${moduleIssuesFrom(moduleId, scope.projectId)} and issues.parent_id is not null`
  )
  return Number(row?.n ?? 0)
}

const DAY = 86_400_000
const MAX_CHART_DAYS = 3660

/**
 * PD-1695 `burndown_plot` for a module: remaining issues (or points) per day between the start and the target
 * date. Days after today are null. Returns an empty chart when a date is missing.
 */
export async function queryModuleBurndown(
  db: LancityDb,
  scope: Pick<ModuleScope, 'projectId'>,
  moduleId: number,
  module: { startDate: string | null; targetDate: string | null; totalIssues: number },
  plotType: 'issues' | 'points'
): Promise<Record<string, number | null>> {
  const chart: Record<string, number | null> = {}
  if (!module.startDate || !module.targetDate) return chart
  const first = Date.parse(`${module.startDate}T00:00:00Z`)
  const days = Math.round((Date.parse(`${module.targetDate}T00:00:00Z`) - first) / DAY) + 1
  if (!(days > 0)) return chart
  const rows = await db.all<{ day: string | null; amount: number }>(
    plotType === 'points'
      ? sql`select date(issues.completed_at / 1000, 'unixepoch') as day, ${numericEstimateOrZeroSql('ep.value')} as amount
          ${moduleIssuesFrom(moduleId, scope.projectId)} and issues.estimate_point_id is not null`
      : sql`select date(issues.completed_at / 1000, 'unixepoch') as day, 1 as amount
          ${moduleIssuesFrom(moduleId, scope.projectId)}`
  )
  const total = plotType === 'points' ? rows.reduce((sum, row) => sum + row.amount, 0) : module.totalIssues
  const today = new Date().toISOString().slice(0, 10)
  for (let index = 0; index < Math.min(days, MAX_CHART_DAYS); index++) {
    const date = new Date(first + index * DAY).toISOString().slice(0, 10)
    const done = rows.reduce((sum, row) => (row.day !== null && row.day <= date ? sum + row.amount : sum), 0)
    chart[date] = date > today ? null : total - done
  }
  return chart
}
