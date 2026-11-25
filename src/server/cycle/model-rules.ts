import { sql, type SQL } from 'drizzle-orm'
import type { CycleView } from '@/types/planning/p2-cycle-schema'

/** PD-1379 `get_default_filters` */
export function getDefaultFilters() {
  return {
    priority: null,
    state: null,
    state_group: null,
    assignees: null,
    created_by: null,
    labels: null,
    start_date: null,
    target_date: null,
    subscriber: null
  }
}

/** PD-1380 `get_default_display_filters` */
export function getDefaultDisplayFilters() {
  return {
    group_by: null,
    order_by: '-created_at',
    type: null,
    sub_issue: true,
    show_empty_groups: true,
    layout: 'list',
    calendar_date_range: ''
  }
}

/** PD-1381 `get_default_display_properties` */
export function getDefaultDisplayProperties() {
  return {
    assignee: true,
    attachment_count: true,
    created_on: true,
    due_date: true,
    estimate: true,
    key: true,
    labels: true,
    link: true,
    priority: true,
    start_date: true,
    state: true,
    sub_issue_count: true,
    updated_on: true
  }
}

/** Plane `CYCLE_ORDER_BY_ALLOWLIST`. */
export const CYCLE_ORDER_BY_ALLOWLIST: ReadonlySet<string> = new Set([
  'created_at',
  'updated_at',
  'name',
  'start_date',
  'end_date',
  'sort_order'
])

/** Plane `sanitize_order_by`: only allow-listed columns reach the query. Anything else falls back to `-created_at`. */
export function cycleOrderBy(value: string | null | undefined, alias = 'c'): SQL {
  const desc = (value ?? '').startsWith('-')
  const column = (value ?? '').replace(/^-/, '')
  const [safe, direction] = CYCLE_ORDER_BY_ALLOWLIST.has(column) ? [column, desc] : ['created_at', true]
  return sql.raw(`${alias}.${safe} ${direction ? 'desc' : 'asc'}, ${alias}.id desc`)
}

/** PD-1382 `Cycle.save`: a new cycle goes on top, 10000 below the smallest sort order of the project. */
export function nextCycleSortOrder(projectId: number): SQL<number> {
  return sql<number>`coalesce((select min(sort_order) from cycles where project_id = ${projectId} and deleted_at is null) - 10000, 65535)`
}

export type CycleStatus = 'CURRENT' | 'UPCOMING' | 'COMPLETED' | 'DRAFT'

/** The `status` annotation of the cycle queries, for values already in memory. */
export function cycleStatus(start: number | null, end: number | null, now = Date.now()): CycleStatus {
  if (start !== null && end !== null && start <= now && end >= now) return 'CURRENT'
  if (start !== null && start > now) return 'UPCOMING'
  if (end !== null && end < now) return 'COMPLETED'
  return 'DRAFT'
}

/** `end_date < now`: no new issues and no edits except `sort_order`. */
export function isCycleCompleted(end: Date | number | null | undefined, now = Date.now()): boolean {
  if (end === null || end === undefined) return false
  return (end instanceof Date ? end.getTime() : end) < now
}

/** WHERE fragment (alias `c`) of the `cycle_view` query parameter. */
export function cycleViewCondition(view: CycleView, now: number): SQL {
  switch (view) {
    case 'current':
      return sql`c.start_date <= ${now} and c.end_date >= ${now}`
    case 'upcoming':
      return sql`c.start_date > ${now}`
    case 'completed':
      return sql`c.end_date < ${now}`
    case 'draft':
      return sql`c.end_date is null and c.start_date is null`
    case 'incomplete':
      return sql`(c.end_date >= ${now} or c.end_date is null)`
    default:
      return sql`1 = 1`
  }
}
