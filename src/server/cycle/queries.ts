import { sql, type SQL } from 'drizzle-orm'
import type { LancityDb } from '@/types/database/schema'

/** Issues Plane counts in cycle annotations: not deleted, archived or draft. Alias `i`. */
export const ISSUE_COUNTABLE = sql`i.deleted_at is null and i.archived_at is null and i.is_draft = 0`
/** `Issue.issue_objects`: the countable issues without triage items. Alias `i`. */
export const ISSUE_LIVE = sql`${ISSUE_COUNTABLE} and not exists (select 1 from states ts where ts.id = i.state_id and ts."group" = 'triage')`

export type CycleSqlRow = Record<string, unknown>

/** Sum of numeric estimate points of the live issues of cycle `c`, optionally limited to one state group. */
function pointsOf(group: string | null): SQL {
  const only = group ? sql` and s."group" = ${group}` : sql``
  return sql`(select coalesce(sum(cast(ep.value as real)), 0) from cycle_issues pc
    join issues i on i.id = pc.issue_id and i.project_id = pc.project_id
    join estimate_points ep on ep.id = i.estimate_point_id
    join estimates e on e.id = ep.estimate_id and e.type = 'points'
    left join states s on s.id = i.state_id
    where pc.cycle_id = c.id and pc.deleted_at is null and ${ISSUE_LIVE}${only})`
}

export type AnnotatedCycleOptions = {
  userId: number
  /** Limits the issue counts to one workspace. Omit it for a query across workspaces (the snapshot cron). */
  workspaceId?: number
  now: number
  /** Predicate on `cycles c`. */
  where: SQL
  order: SQL
  limit?: number
  offset?: number
  /** Add the per-group estimate point sums (archive views and progress). */
  estimates?: boolean
}

/**
 * Port of the shared `get_queryset` annotations (PD-0080, PD-0090, PD-0094, PD-0494, PD-0489): favorite flag, issue
 * counts per state group, assignee ids, `status` and the project timezone.
 */
export function annotatedCyclesSql(opts: AnnotatedCycleOptions): SQL {
  const estimates = opts.estimates
    ? sql`, ${pointsOf('backlog')} as backlog_estimate_points, ${pointsOf('unstarted')} as unstarted_estimate_points,
      ${pointsOf('started')} as started_estimate_points, ${pointsOf('cancelled')} as cancelled_estimate_points,
      ${pointsOf('completed')} as completed_estimate_points, ${pointsOf(null)} as total_estimate_points`
    : sql``
  const inWorkspace = opts.workspaceId === undefined ? sql`1 = 1` : sql`ci.workspace_id = ${opts.workspaceId}`
  const page = opts.limit === undefined ? sql`` : sql` limit ${opts.limit} offset ${opts.offset ?? 0}`
  return sql`select c.id, c.workspace_id, c.project_id, c.name, c.description, c.start_date, c.end_date, c.owned_by_id,
      c.view_props, c.sort_order, c.external_source, c.external_id, c.progress_snapshot, c.logo_props, c.archived_at,
      c.timezone, c.version, c.created_at, c.updated_at, c.created_by_id, c.updated_by_id,
      (select p.timezone from projects p where p.id = c.project_id) as project_timezone,
      exists (select 1 from user_favorites f where f.user_id = ${opts.userId} and f.entity_type = 'cycle'
        and f.entity_identifier = c.id and f.project_id = c.project_id and f.deleted_at is null) as is_favorite,
      coalesce(a.total, 0) as total_issues, coalesce(a.completed, 0) as completed_issues,
      coalesce(a.cancelled, 0) as cancelled_issues, coalesce(a.started, 0) as started_issues,
      coalesce(a.unstarted, 0) as unstarted_issues, coalesce(a.backlog, 0) as backlog_issues,
      case when c.start_date <= ${opts.now} and c.end_date >= ${opts.now} then 'CURRENT'
        when c.start_date > ${opts.now} then 'UPCOMING'
        when c.end_date < ${opts.now} then 'COMPLETED' else 'DRAFT' end as status,
      coalesce((select json_group_array(v) from (select distinct ia.assignee_id as v from cycle_issues ac
        join issues i on i.id = ac.issue_id and i.project_id = ac.project_id
        join issue_assignees ia on ia.issue_id = ac.issue_id and ia.deleted_at is null
        where ac.cycle_id = c.id and ac.deleted_at is null and ${ISSUE_COUNTABLE})), '[]') as assignee_ids${estimates}
    from cycles c
    left join (select ci.cycle_id, count(*) as total,
        sum(case when s."group" = 'completed' then 1 else 0 end) as completed,
        sum(case when s."group" = 'cancelled' then 1 else 0 end) as cancelled,
        sum(case when s."group" = 'started' then 1 else 0 end) as started,
        sum(case when s."group" = 'unstarted' then 1 else 0 end) as unstarted,
        sum(case when s."group" = 'backlog' then 1 else 0 end) as backlog
      from cycle_issues ci join issues i on i.id = ci.issue_id and i.project_id = ci.project_id
      left join states s on s.id = i.state_id
      where ${inWorkspace} and ci.deleted_at is null and ${ISSUE_COUNTABLE}
      group by ci.cycle_id) a on a.cycle_id = c.id
    where ${opts.where} order by ${opts.order}${page}`
}

/** Base predicate of every cycle query: workspace, project and soft delete. */
export function cycleScope(workspaceId: number, projectId: number): SQL {
  return sql`c.workspace_id = ${workspaceId} and c.project_id = ${projectId} and c.deleted_at is null`
}

export function joinAnd(parts: SQL[]): SQL {
  return sql.join(
    parts.map(part => sql`(${part})`),
    sql` and `
  )
}

export async function runCycleQuery(db: LancityDb, query: SQL): Promise<CycleSqlRow[]> {
  return db.all<CycleSqlRow>(query)
}

export async function countCycles(db: LancityDb, where: SQL): Promise<number> {
  const [row] = await db.all<{ n: number }>(sql`select count(*) as n from cycles c where ${where}`)
  return Number(row?.n ?? 0)
}

/** Number of live sub-issues (issues with a parent) of a cycle, the `sub_issues` annotation of the detail views. */
export async function countCycleSubIssues(db: LancityDb, projectId: number, cycleId: number): Promise<number> {
  const [row] = await db.all<{ n: number }>(
    sql`select count(*) as n from cycle_issues ci join issues i on i.id = ci.issue_id and i.project_id = ci.project_id
      where ci.cycle_id = ${cycleId} and ci.project_id = ${projectId} and ci.deleted_at is null
        and i.parent_id is not null and ${ISSUE_LIVE}`
  )
  return Number(row?.n ?? 0)
}

/** True when the project estimates in points (`estimate__type = "points"`). */
export async function projectUsesPoints(db: LancityDb, projectId: number): Promise<boolean> {
  const rows = await db.all<{ one: number }>(
    sql`select 1 as one from projects p join estimates e on e.id = p.estimate_id
      where p.id = ${projectId} and e.type = 'points' and e.deleted_at is null limit 1`
  )
  return rows.length > 0
}
