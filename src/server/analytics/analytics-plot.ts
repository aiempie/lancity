import { sql, type SQL } from 'drizzle-orm'
import { burndownPlot as cycleBurndownPlot } from '@/server/cycle/progress'
import { ISSUE_COUNTABLE, ISSUE_LIVE, projectUsesPoints } from '@/server/cycle/queries'
import { raw } from '@/server/analytics/queries'
import { VALID_ANALYTICS_FIELDS, VALID_YAXIS, type AnalyticsField } from '@/types/reporting/p3-analytics-schema'
import type { LancityDb } from '@/types/database/schema'

export { VALID_ANALYTICS_FIELDS, VALID_YAXIS }

/** One entry of a plot: `count` for `issue_count`, `estimate` for `estimate`. `segment` only with a segment axis. */
export type PlotRow = {
  dimension: string | number
  segment?: string | number | null
  count?: number
  estimate?: number
}
export type Distribution = Record<string, PlotRow[]>

const DATE_FIELDS = new Set<string>(['created_at', 'start_date', 'target_date', 'completed_at'])
/** Millisecond timestamp columns. `start_date` and `target_date` are `YYYY-MM-DD` text. */
const TIMESTAMP_FIELDS = new Set<string>(['created_at', 'completed_at'])

/**
 * PD-1689 `annotate_with_monthly_dimension`: the `year-month` label (month without a leading zero, like Plane's
 * `Concat(year, "-", month)`) of a date field. Django annotates the queryset, here the result is the SQL expression.
 */
export function annotateWithMonthlyDimension(field: string): SQL {
  const date = TIMESTAMP_FIELDS.has(field) ? `issues.${field} / 1000, 'unixepoch'` : `issues.${field}`
  return raw(`strftime('%Y', ${date}) || '-' || cast(strftime('%m', ${date}) as integer)`)
}

/** PD-1690 `extract_axis`: the SQL of the dimension (and the join it needs) for an axis field. Rejects unknown fields. */
export function extractAxis(field: string, alias: string): { dimension: SQL; join?: SQL } {
  if (!(VALID_ANALYTICS_FIELDS as readonly string[]).includes(field)) throw new Error(`Invalid x_axis value: ${field}`)
  if (DATE_FIELDS.has(field)) return { dimension: annotateWithMonthlyDimension(field) }
  const join = (table: string, on: string) => raw(`left join ${table} ${alias} on ${on.replaceAll('$', alias)}`)
  switch (field as AnalyticsField) {
    case 'state__group':
      return { join: join('states', '$.id = issues.state_id'), dimension: raw(`${alias}."group"`) }
    case 'labels__id':
      return {
        join: join('issue_labels', '$.issue_id = issues.id and $.deleted_at is null'),
        dimension: raw(`${alias}.label_id`)
      }
    case 'assignees__id':
      return {
        join: join('issue_assignees', '$.issue_id = issues.id and $.deleted_at is null'),
        dimension: raw(`${alias}.assignee_id`)
      }
    case 'estimate_point__value':
      return { join: join('estimate_points', '$.id = issues.estimate_point_id'), dimension: raw(`${alias}.value`) }
    case 'issue_cycle__cycle_id':
      return {
        join: join('cycle_issues', '$.issue_id = issues.id and $.deleted_at is null'),
        dimension: raw(`${alias}.cycle_id`)
      }
    case 'issue_module__module_id':
      return {
        join: join('module_issues', '$.issue_id = issues.id and $.deleted_at is null'),
        dimension: raw(`${alias}.module_id`)
      }
    case 'priority':
      return { dimension: raw('issues.priority') }
    default:
      return { dimension: raw(`issues.${field}`) }
  }
}

const PRIORITY_ORDER = ['low', 'medium', 'high', 'urgent', 'none']

/**
 * PD-1691 and PD-1692 `sort_data`: priorities in severity order (unknown keys dropped), every other axis sorted by
 * key with `"none"` last. Note JSON objects list integer-like keys in ascending numeric order whatever is inserted.
 */
export function sortData(data: Map<string, PlotRow[]>, axis: string): Distribution {
  if (axis === 'priority')
    return Object.fromEntries(PRIORITY_ORDER.filter(key => data.has(key)).map(key => [key, data.get(key)!]))
  const keys = [...data.keys()].sort(
    (a, b) => Number(a === 'none') - Number(b === 'none') || (a < b ? -1 : a > b ? 1 : 0)
  )
  return Object.fromEntries(keys.map(key => [key, data.get(key)!]))
}

/**
 * PD-1693 and PD-1694 `build_graph_plot`: issues of `where` (a condition on `issues`) grouped by `x_axis` and an
 * optional `segment`, as issue counts or the sum of numeric estimate point values. Rows with an empty x value are
 * dropped (Plane always excludes a null dimension). Issues with several labels, assignees, cycles or modules are
 * counted once per link, as in Plane.
 */
export async function buildGraphPlot(
  db: LancityDb,
  where: SQL,
  xAxis: string,
  yAxis: string,
  segment?: string | false | null
): Promise<Distribution> {
  if (!(VALID_ANALYTICS_FIELDS as readonly string[]).includes(xAxis)) throw new Error(`Invalid x_axis value: ${xAxis}`)
  if (!(VALID_YAXIS as readonly string[]).includes(yAxis)) throw new Error(`Invalid y_axis value: ${yAxis}`)
  if (segment && !(VALID_ANALYTICS_FIELDS as readonly string[]).includes(segment))
    throw new Error(`Invalid segment value: ${segment}`)

  const x = extractAxis(xAxis, 'ax')
  const seg = segment ? extractAxis(segment, 'sg') : null
  const estimate = yAxis === 'estimate'
  const measure = estimate ? sql`sum(cast(ey.value as real)) as estimate` : sql`count(*) as count`
  const rows = await db.all<PlotRow>(
    sql`select ${x.dimension} as dimension, ${seg ? sql`${seg.dimension} as segment,` : sql``} ${measure}
      from issues ${x.join ?? sql``} ${seg?.join ?? sql``}
      ${estimate ? sql`left join estimate_points ey on ey.id = issues.estimate_point_id` : sql``}
      where ${where} and ${x.dimension} is not null
      group by ${x.dimension}${seg ? sql`, ${seg.dimension}` : sql``}
      order by ${x.dimension}${seg ? sql`, ${seg.dimension}` : sql``}`
  )
  const grouped = new Map<string, PlotRow[]>()
  for (const row of rows) {
    const key = String(row.dimension)
    const list = grouped.get(key)
    if (list) list.push(row)
    else grouped.set(key, [row])
  }
  return sortData(grouped, xAxis)
}

const DAY_MS = 86_400_000
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * PD-1695 `burndown_plot`: remaining issues or estimate points per day, `null` for days after today. Cycles reuse the
 * port in `cycle/progress.ts`. Modules run between `start_date` and `target_date` (text dates) over their live issues.
 * Returns `{}` when the dates are missing or points are requested for a project without a points estimate.
 */
export async function burndownPlot(
  db: LancityDb,
  scope: { projectId: number; workspaceId: number; cycleId?: number; moduleId?: number },
  entity: { startDate: Date | number | string | null; endDate: Date | number | string | null },
  plotType: 'issues' | 'points',
  now = Date.now()
): Promise<Record<string, number | null>> {
  if (scope.cycleId !== undefined) {
    const toMs = (value: Date | number | string | null) => (value === null ? null : new Date(value).getTime())
    return cycleBurndownPlot(
      db,
      { cycleId: scope.cycleId, projectId: scope.projectId, workspaceId: scope.workspaceId },
      { startDate: toMs(entity.startDate), endDate: toMs(entity.endDate) },
      plotType,
      now
    )
  }
  if (scope.moduleId === undefined || entity.startDate === null || entity.endDate === null) return {}
  const start = Date.parse(`${String(entity.startDate).slice(0, 10)}T00:00:00Z`)
  const end = Date.parse(`${String(entity.endDate).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) return {}
  const days = Math.max(0, Math.round((end - start) / DAY_MS)) + 1
  const dates = Array.from({ length: days }, (_, offset) => dayOf(start + offset * DAY_MS))
  const today = dayOf(now)
  const inModule = sql`mi.module_id = ${scope.moduleId} and mi.project_id = ${scope.projectId} and mi.workspace_id = ${scope.workspaceId}
    and mi.deleted_at is null and ${ISSUE_LIVE}`

  let total: number
  let completed: { date: string; amount: number }[]
  if (plotType === 'points') {
    if (!(await projectUsesPoints(db, scope.projectId))) return {}
    const rows = await db.all<{ d: string | null; value: string }>(
      sql`select date(i.completed_at / 1000, 'unixepoch') as d, ep.value as value
        from module_issues mi join issues i on i.id = mi.issue_id and i.project_id = mi.project_id
        join estimate_points ep on ep.id = i.estimate_point_id
        where ${inModule} order by d`
    )
    total = rows.reduce((sum, row) => sum + Number(row.value), 0)
    completed = rows.filter(row => row.d).map(row => ({ date: row.d as string, amount: Number(row.value) }))
  } else {
    const [count] = await db.all<{ n: number }>(
      sql`select count(*) as n from module_issues mi join issues i on i.id = mi.issue_id and i.project_id = mi.project_id
        where mi.module_id = ${scope.moduleId} and mi.project_id = ${scope.projectId} and mi.deleted_at is null and ${ISSUE_COUNTABLE}`
    )
    total = Number(count?.n ?? 0)
    const rows = await db.all<{ d: string; n: number }>(
      sql`select date(i.completed_at / 1000, 'unixepoch') as d, count(*) as n
        from module_issues mi join issues i on i.id = mi.issue_id and i.project_id = mi.project_id
        where ${inModule} and i.completed_at is not null group by d order by d`
    )
    completed = rows.map(row => ({ date: row.d, amount: Number(row.n) }))
  }
  const chart: Record<string, number | null> = {}
  for (const date of dates)
    chart[date] =
      date > today
        ? null
        : total - completed.filter(item => item.date <= date).reduce((sum, item) => sum + item.amount, 0)
  return chart
}
