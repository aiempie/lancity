import { sql, type SQL } from 'drizzle-orm'
import { cycleAccess, loadCycle, type CycleRecord } from '@/server/cycle/access'
import { ISSUE_COUNTABLE, ISSUE_LIVE, projectUsesPoints } from '@/server/cycle/queries'
import { ServiceError } from '@/server/common/errors'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

type Scope = { cycleId: number; projectId: number; workspaceId: number }
type Row = Record<string, unknown>

const inCycle = (s: Scope): SQL =>
  sql`ci.cycle_id = ${s.cycleId} and ci.project_id = ${s.projectId} and ci.workspace_id = ${s.workspaceId}
    and ci.deleted_at is null and ${ISSUE_LIVE}`

const DAY_MS = 86_400_000
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * Assignee or label distribution of a cycle (the `assignee_distribution` and `label_distribution` queries of
 * `CycleAnalyticsEndpoint`, `transfer_cycle_issues` and the archive detail).
 *
 * - `metric: 'issues'` counts issues, `'points'` sums the numeric estimate point values.
 * - `countBy: 'dimension'` counts the assignee or label ids (Plane analytics, so the unassigned group counts 0);
 *   `'issue'` counts issue ids (Plane transfer and archive).
 * - A group is `completed` when `completed_at` is set and `pending` otherwise.
 */
export async function cycleDistribution(
  db: LancityDb,
  scope: Scope,
  kind: 'assignee' | 'label',
  metric: 'issues' | 'points',
  countBy: 'dimension' | 'issue' = 'dimension'
): Promise<Row[]> {
  const dim =
    kind === 'assignee'
      ? {
          select: sql`coalesce(nullif(u.display_username, ''), u.username, u.name) as display_name, u.name as first_name,
            '' as last_name, ia.assignee_id as assignee_id, u.image as avatar_url`,
          join: sql`left join issue_assignees ia on ia.issue_id = i.id and ia.deleted_at is null
            left join "user" u on u.id = ia.assignee_id`,
          group: sql`ia.assignee_id, u.display_username, u.username, u.name, u.image`,
          key: sql`ia.assignee_id`,
          order: sql`display_name`
        }
      : {
          select: sql`l.name as label_name, l.color as color, il.label_id as label_id`,
          join: sql`left join issue_labels il on il.issue_id = i.id and il.deleted_at is null
            left join labels l on l.id = il.label_id`,
          group: sql`il.label_id, l.name, l.color`,
          key: sql`il.label_id`,
          order: sql`label_name`
        }
  const counted = countBy === 'issue' ? sql`i.id` : dim.key
  const measures =
    metric === 'issues'
      ? sql`count(${counted}) as total_issues,
          count(${counted}) filter (where i.completed_at is not null) as completed_issues,
          count(${counted}) filter (where i.completed_at is null) as pending_issues`
      : sql`sum(cast(ep.value as real)) as total_estimates,
          sum(cast(ep.value as real)) filter (where i.completed_at is not null) as completed_estimates,
          sum(cast(ep.value as real)) filter (where i.completed_at is null) as pending_estimates`
  const points = metric === 'points' ? sql`left join estimate_points ep on ep.id = i.estimate_point_id` : sql``
  return db.all<Row>(
    sql`select ${dim.select}, ${measures}
      from cycle_issues ci join issues i on i.id = ci.issue_id and i.project_id = ci.project_id
      ${dim.join} ${points}
      where ${inCycle(scope)}
      group by ${dim.group} order by ${dim.order} asc nulls last`
  )
}

/**
 * Port of `burndown_plot` for cycles (PD-1695 target in `utils/analytics_plot.py`): remaining issues or points
 * for each UTC day between the cycle dates. Days after today are `null`. Empty without both dates.
 */
export async function burndownPlot(
  db: LancityDb,
  scope: Scope,
  cycle: { startDate: Date | number | null; endDate: Date | number | null },
  plotType: 'issues' | 'points',
  now = Date.now()
): Promise<Record<string, number | null>> {
  const start = cycle.startDate === null ? null : new Date(cycle.startDate).getTime()
  const end = cycle.endDate === null ? null : new Date(cycle.endDate).getTime()
  if (start === null || end === null) return {}
  const days = Math.max(0, Math.floor(end / DAY_MS) - Math.floor(start / DAY_MS)) + 1
  const dates = Array.from({ length: days }, (_, offset) => dayOf(start + offset * DAY_MS))
  const today = dayOf(now)
  const chart: Record<string, number | null> = {}

  let total: number
  let completed: { date: string; amount: number }[]
  if (plotType === 'points') {
    if (!(await projectUsesPoints(db, scope.projectId))) return {}
    const rows = await db.all<{ d: string | null; value: string }>(
      sql`select date(i.completed_at / 1000, 'unixepoch') as d, ep.value as value
        from cycle_issues ci join issues i on i.id = ci.issue_id and i.project_id = ci.project_id
        join estimate_points ep on ep.id = i.estimate_point_id
        where ${inCycle(scope)} order by d`
    )
    total = rows.reduce((sum, row) => sum + Number(row.value), 0)
    completed = rows.filter(row => row.d).map(row => ({ date: row.d as string, amount: Number(row.value) }))
  } else {
    const [count] = await db.all<{ n: number }>(
      sql`select count(*) as n from cycle_issues ci join issues i on i.id = ci.issue_id and i.project_id = ci.project_id
        where ci.cycle_id = ${scope.cycleId} and ci.project_id = ${scope.projectId} and ci.deleted_at is null
          and ${ISSUE_COUNTABLE}`
    )
    total = Number(count?.n ?? 0)
    const rows = await db.all<{ d: string; n: number }>(
      sql`select date(i.completed_at / 1000, 'unixepoch') as d, count(*) as n
        from cycle_issues ci join issues i on i.id = ci.issue_id and i.project_id = ci.project_id
        where ${inCycle(scope)} and i.completed_at is not null group by d order by d`
    )
    completed = rows.map(row => ({ date: row.d, amount: Number(row.n) }))
  }
  for (const date of dates) {
    if (date > today) chart[date] = null
    else chart[date] = total - completed.filter(item => item.date <= date).reduce((sum, item) => sum + item.amount, 0)
  }
  return chart
}

/** Shared by `transfer_cycle_issues` and the archive detail: label and assignee distributions plus the chart. */
export async function cycleDistributions(
  db: LancityDb,
  scope: Scope,
  cycle: Pick<CycleRecord, 'startDate' | 'endDate'>,
  countBy: 'dimension' | 'issue' = 'issue'
) {
  const [labels, assignees, completionChart] = await Promise.all([
    cycleDistribution(db, scope, 'label', 'issues', countBy),
    cycleDistribution(db, scope, 'assignee', 'issues', countBy),
    burndownPlot(db, scope, cycle, 'issues')
  ])
  const usesPoints = await projectUsesPoints(db, scope.projectId)
  const estimate = usesPoints
    ? {
        labels: await cycleDistribution(db, scope, 'label', 'points', countBy),
        assignees: await cycleDistribution(db, scope, 'assignee', 'points', countBy),
        completion_chart: await burndownPlot(db, scope, cycle, 'points')
      }
    : {}
  return {
    distribution: { labels, assignees, completion_chart: completionChart },
    estimate_distribution: estimate
  }
}

const SNAPSHOT_COUNTS = [
  'backlog_issues',
  'unstarted_issues',
  'started_issues',
  'cancelled_issues',
  'completed_issues',
  'total_issues'
]

function snapshotOf(cycle: CycleRecord): Record<string, unknown> {
  const value = cycle.progressSnapshot
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** PD-0508 `CycleProgressEndpoint.get`: estimate sums are live, issue counts come from the transfer snapshot when there is one. */
export async function getCycleProgress(db: LancityDb, actor: Actor, slug: string, projectId: number, cycleId: number) {
  const { workspace } = await cycleAccess(db, actor, slug, projectId, 5)
  const cycle = await loadCycle(db, workspace.id, projectId, cycleId)
  const scope = { cycleId, projectId, workspaceId: workspace.id }
  const [points] = await db.all<Row>(
    sql`select
        sum(case when s."group" = 'backlog' then cast(ep.value as real) else 0 end) as backlog,
        sum(case when s."group" = 'unstarted' then cast(ep.value as real) else 0 end) as unstarted,
        sum(case when s."group" = 'started' then cast(ep.value as real) else 0 end) as started,
        sum(case when s."group" = 'cancelled' then cast(ep.value as real) else 0 end) as cancelled,
        sum(case when s."group" = 'completed' then cast(ep.value as real) else 0 end) as completed,
        coalesce(sum(cast(ep.value as real)), 0) as total
      from cycle_issues ci join issues i on i.id = ci.issue_id and i.project_id = ci.project_id
      join estimate_points ep on ep.id = i.estimate_point_id
      join estimates e on e.id = ep.estimate_id and e.type = 'points'
      left join states s on s.id = i.state_id
      where ${inCycle(scope)}`
  )
  const snapshot = snapshotOf(cycle)
  let counts: Record<string, number>
  if (Object.keys(snapshot).length) {
    counts = Object.fromEntries(SNAPSHOT_COUNTS.map(key => [key, Number(snapshot[key] ?? 0)]))
  } else {
    const [live] = await db.all<Row>(
      sql`select count(*) as total_issues,
          sum(case when s."group" = 'backlog' then 1 else 0 end) as backlog_issues,
          sum(case when s."group" = 'unstarted' then 1 else 0 end) as unstarted_issues,
          sum(case when s."group" = 'started' then 1 else 0 end) as started_issues,
          sum(case when s."group" = 'cancelled' then 1 else 0 end) as cancelled_issues,
          sum(case when s."group" = 'completed' then 1 else 0 end) as completed_issues
        from cycle_issues ci join issues i on i.id = ci.issue_id and i.project_id = ci.project_id
        left join states s on s.id = i.state_id
        where ${inCycle(scope)}`
    )
    counts = Object.fromEntries(SNAPSHOT_COUNTS.map(key => [key, Number(live?.[key] ?? 0)]))
  }
  const point = (key: string) => Number(points?.[key] ?? 0)
  return {
    backlog_estimate_points: point('backlog'),
    unstarted_estimate_points: point('unstarted'),
    started_estimate_points: point('started'),
    cancelled_estimate_points: point('cancelled'),
    completed_estimate_points: point('completed'),
    total_estimate_points: point('total'),
    ...counts
  }
}

/**
 * PD-0509 `CycleAnalyticsEndpoint.get`. A cycle with a transfer snapshot answers from it (the points view uses the
 * estimate distribution when the snapshot has one; Plane returns the issue distribution for both). Without a
 * snapshot the distributions and the burndown chart are computed live. Cycles need both dates.
 */
export async function getCycleAnalytics(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  cycleId: number,
  type: 'issues' | 'points' = 'issues'
) {
  const { workspace } = await cycleAccess(db, actor, slug, projectId, 5)
  const cycle = await loadCycle(db, workspace.id, projectId, cycleId)
  if (!cycle.startDate || !cycle.endDate)
    throw new ServiceError(400, 'CYCLE_HAS_NO_DATES', 'Cycle has no start or end date')
  const snapshot = snapshotOf(cycle)
  if (Object.keys(snapshot).length) {
    const estimate = snapshot.estimate_distribution as Record<string, unknown> | undefined
    const source = (
      type === 'points' && estimate && Object.keys(estimate).length ? estimate : snapshot.distribution
    ) as Record<string, unknown> | undefined
    return {
      labels: source?.labels ?? [],
      assignees: source?.assignees ?? [],
      completion_chart: source?.completion_chart ?? {}
    }
  }
  const scope = { cycleId, projectId, workspaceId: workspace.id }
  const metric =
    type === 'points' && (await projectUsesPoints(db, projectId)) ? 'points' : type === 'points' ? null : 'issues'
  if (!metric) return { assignees: [], labels: [], completion_chart: {} }
  const [assignees, labels, completionChart] = await Promise.all([
    cycleDistribution(db, scope, 'assignee', metric, 'dimension'),
    cycleDistribution(db, scope, 'label', metric, 'dimension'),
    burndownPlot(db, scope, cycle, metric)
  ])
  return { assignees, labels, completion_chart: completionChart }
}
