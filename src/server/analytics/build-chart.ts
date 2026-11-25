import { sql, type SQL } from 'drizzle-orm'
import { parseError } from '@/server/common/errors'
import { raw, userDisplayName } from '@/server/analytics/queries'
import { X_AXIS_MAPPER, type ChartAxis } from '@/types/reporting/p3-analytics-schema'
import type { LancityDb } from '@/types/database/schema'

export { X_AXIS_MAPPER }
/** Plane `x_axis_mapper` as a lookup (each name maps to itself). */
export const xAxisMapper: Record<string, string> = Object.fromEntries(X_AXIS_MAPPER.map(name => [name, name]))

export type ChartItem = { key: string | number; name: string | number; count: number } & Record<string, string | number>
export type ChartResult = { data: ChartItem[]; schema: Record<string, string> }

type AxisSource = { id: SQL; name: SQL; join?: SQL }

/** PD-1696 `get_y_axis_filter`: the extra row condition of a y axis. Only `WORK_ITEM_COUNT` has one, and it is always true. */
export function getYAxisFilter(yAxis: string): SQL | undefined {
  return yAxis === 'WORK_ITEM_COUNT' ? sql`issues.id = issues.id` : undefined
}

const linkJoin = (table: string, alias: string) =>
  raw(`left join ${table} ${alias} on ${alias}.issue_id = issues.id and ${alias}.deleted_at is null`)

/**
 * PD-1697 `get_x_axis_field`: for every axis the SQL of its id and display name, plus the joins they need. Links
 * (labels, assignees, cycles, modules) skip soft deleted rows (Plane's additional filters). `prefix` keeps the
 * aliases of the x axis and the group axis apart.
 */
export function getXAxisField(prefix: string): Record<ChartAxis, AxisSource> {
  const a = (name: string) => `${prefix}_${name}`
  const date = (column: string): SQL =>
    column === 'created_at' || column === 'completed_at'
      ? raw(`date(issues.${column} / 1000, 'unixepoch')`)
      : raw(`issues.${column}`)
  return {
    STATES: {
      id: raw('issues.state_id'),
      name: raw(`${a('st')}.name`),
      join: raw(`left join states ${a('st')} on ${a('st')}.id = issues.state_id`)
    },
    STATE_GROUPS: {
      id: raw(`${a('sg')}."group"`),
      name: raw(`${a('sg')}."group"`),
      join: raw(`left join states ${a('sg')} on ${a('sg')}.id = issues.state_id`)
    },
    LABELS: {
      id: raw(`${a('il')}.label_id`),
      name: raw(`${a('lb')}.name`),
      join: sql`${linkJoin('issue_labels', a('il'))} ${raw(`left join labels ${a('lb')} on ${a('lb')}.id = ${a('il')}.label_id`)}`
    },
    ASSIGNEES: {
      id: raw(`${a('ia')}.assignee_id`),
      name: userDisplayName(a('us')),
      join: sql`${linkJoin('issue_assignees', a('ia'))} ${raw(`left join "user" ${a('us')} on ${a('us')}.id = ${a('ia')}.assignee_id`)}`
    },
    ESTIMATE_POINTS: {
      id: raw(`${a('ep')}."key"`),
      name: raw(`${a('ep')}.value`),
      join: raw(`left join estimate_points ${a('ep')} on ${a('ep')}.id = issues.estimate_point_id`)
    },
    CYCLES: {
      id: raw(`${a('ci')}.cycle_id`),
      name: raw(`${a('cy')}.name`),
      join: sql`${linkJoin('cycle_issues', a('ci'))} ${raw(`left join cycles ${a('cy')} on ${a('cy')}.id = ${a('ci')}.cycle_id`)}`
    },
    MODULES: {
      id: raw(`${a('mi')}.module_id`),
      name: raw(`${a('mo')}.name`),
      join: sql`${linkJoin('module_issues', a('mi'))} ${raw(`left join modules ${a('mo')} on ${a('mo')}.id = ${a('mi')}.module_id`)}`
    },
    PRIORITY: { id: raw('issues.priority'), name: raw('issues.priority') },
    START_DATE: { id: date('start_date'), name: date('start_date') },
    TARGET_DATE: { id: date('target_date'), name: date('target_date') },
    CREATED_AT: { id: date('created_at'), name: date('created_at') },
    COMPLETED_AT: { id: date('completed_at'), name: date('completed_at') },
    CREATED_BY: {
      id: raw('issues.created_by_id'),
      name: userDisplayName(a('cb')),
      join: raw(`left join "user" ${a('cb')} on ${a('cb')}.id = issues.created_by_id`)
    }
  }
}

type GroupedRow = {
  key: string | number | null
  group_key: string | number | null
  group_name: string | null
  display_name: string | null
  count: number
}

/**
 * PD-1698 `process_grouped_data`: one item per key with a count per group key, plus the schema that maps every
 * group key to its label. Empty keys become `"none"`, empty names `"None"`.
 */
export function processGroupedData(data: GroupedRow[]): { data: ChartItem[]; schema: Record<string, string> } {
  const response = new Map<string | number | null, ChartItem>()
  const schema: Record<string, string> = {}
  for (const item of data) {
    let entry = response.get(item.key)
    if (!entry) {
      entry = { key: item.key ? item.key : 'none', name: item.display_name ? item.display_name : 'None', count: 0 }
      response.set(item.key, entry)
    }
    const groupKey = item.group_key ? String(item.group_key) : 'none'
    schema[groupKey] = item.group_name ? item.group_name : 'None'
    entry[groupKey] = (Number(entry[groupKey]) || 0) + item.count
    entry.count += item.count
  }
  return { data: [...response.values()], schema }
}

/** PD-1699 `build_number_chart_response`: one number for the whole queryset. */
export async function buildNumberChartResponse(
  db: LancityDb,
  where: SQL,
  yAxisFilter: SQL | undefined,
  yAxis: string
): Promise<ChartItem[]> {
  const [row] = await db.all<{ total: number }>(
    sql`select count(distinct issues.id) as total from issues where ${where}${yAxisFilter ? sql` and ${yAxisFilter}` : sql``}`
  )
  return [{ key: yAxis, name: yAxis, count: Number(row?.total ?? 0) }]
}

/** PD-1700 `build_grouped_chart_response`: counts per axis value and group value, largest first. */
export async function buildGroupedChartResponse(
  db: LancityDb,
  where: SQL,
  x: AxisSource,
  group: AxisSource
): Promise<{ data: ChartItem[]; schema: Record<string, string> }> {
  const rows = await db.all<GroupedRow>(
    sql`select ${x.id} as "key", ${group.id} as group_key, ${group.name} as group_name, ${x.name} as display_name,
        count(distinct issues.id) as count
      from issues ${x.join ?? sql``} ${group.join ?? sql``}
      where ${where}
      group by ${x.id}, ${group.id}, ${group.name}, ${x.name}
      order by count desc`
  )
  return processGroupedData(rows)
}

/** PD-1701 `build_simple_chart_response`: counts per axis value ordered by key. */
export async function buildSimpleChartResponse(db: LancityDb, where: SQL, x: AxisSource): Promise<ChartItem[]> {
  const rows = await db.all<Omit<GroupedRow, 'group_key' | 'group_name'>>(
    sql`select ${x.id} as "key", ${x.name} as display_name, count(distinct issues.id) as count
      from issues ${x.join ?? sql``}
      where ${where}
      group by ${x.id}, ${x.name}
      order by ${x.id} is null, ${x.id}`
  )
  return rows.map(item => ({
    key: item.key ? item.key : 'None',
    name: item.display_name ? item.display_name : 'None',
    count: Number(item.count)
  }))
}

/**
 * PD-1702 `build_analytics_chart`: `{ data, schema }` for an x axis and an optional group axis over the issues of
 * `where`. Unknown axes are a 400, as Plane's `ValidationError`.
 */
export async function buildAnalyticsChart(
  db: LancityDb,
  where: SQL,
  xAxis: string,
  groupBy?: string | null
): Promise<ChartResult> {
  if (!(xAxis in xAxisMapper)) throw parseError(`Invalid x_axis field: ${xAxis}`)
  if (groupBy && !(groupBy in xAxisMapper)) throw parseError(`Invalid group_by field: ${groupBy}`)
  const x = getXAxisField('x')[xAxis as ChartAxis]
  if (groupBy) return buildGroupedChartResponse(db, where, x, getXAxisField('g')[groupBy as ChartAxis])
  return { data: await buildSimpleChartResponse(db, where, x), schema: {} }
}
