/** Analytics date helpers (Plane `date_utils.py`). All boundaries are UTC. */

export type DateRange = { gte: Date; lte: Date }
export type AnalyticsDateRange = { current: DateRange; previous?: DateRange }
export type AnalyticsDateFilter = 'yesterday' | 'last_7_days' | 'last_30_days' | 'last_3_months' | 'custom'

const DAY_MS = 86_400_000

function startOfDay(day: Date): Date {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()))
}

function endOfDay(day: Date): Date {
  return new Date(startOfDay(day).getTime() + DAY_MS - 1)
}

function shift(day: Date, days: number): Date {
  return new Date(day.getTime() + days * DAY_MS)
}

function parseIsoDay(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? date : null
}

/**
 * Plane `get_analytics_date_range`: the current period and, for rolling windows, the previous period of the
 * same length used for comparison. Returns null for a missing or unknown filter or an invalid custom range.
 */
export function getAnalyticsDateRange(
  dateFilter?: string | null,
  startDate?: string | null,
  endDate?: string | null,
  now = new Date()
): AnalyticsDateRange | null {
  if (!dateFilter) return null
  const today = startOfDay(now)
  const range = (from: number, to: number): DateRange => ({ gte: startOfDay(shift(today, from)), lte: endOfDay(shift(today, to)) })
  switch (dateFilter) {
    case 'yesterday':
      return { current: range(-1, -1) }
    case 'last_7_days':
      return { current: range(-7, 0), previous: range(-14, -8) }
    case 'last_30_days':
      return { current: range(-30, 0), previous: range(-60, -31) }
    case 'last_3_months':
      return { current: range(-90, 0), previous: range(-180, -91) }
    case 'custom': {
      const start = startDate ? parseIsoDay(startDate) : null
      const end = endDate ? parseIsoDay(endDate) : null
      return start && end ? { current: { gte: start, lte: endOfDay(end) } } : null
    }
    default:
      return null
  }
}

/** Plane `get_chart_period_range`: inclusive `[start, end]` days for chart periods, null when unknown. */
export function getChartPeriodRange(dateFilter?: string | null, now = new Date()): [Date, Date] | null {
  if (!dateFilter) return null
  const today = startOfDay(now)
  const ranges: Record<string, [Date, Date]> = {
    yesterday: [shift(today, -1), shift(today, -1)],
    last_7_days: [shift(today, -7), today],
    last_30_days: [shift(today, -30), today],
    last_3_months: [shift(today, -90), today]
  }
  return ranges[dateFilter] ?? null
}

export type AnalyticsFilters = {
  /** Issue level scope: workspace slug plus projects the user is an active member of (not deleted or archived). */
  baseFilters: { workspaceSlug: string; memberId: number; projectIds?: number[] }
  /** Project level scope with the same rules. */
  projectFilters: { workspaceSlug: string; memberId: number; projectIds?: number[] }
  analyticsDateRange: AnalyticsDateRange | null
  chartPeriodRange: [Date, Date] | null
}

/**
 * Plane `get_analytics_filters`. Instead of Django lookup keys it returns a plain description the analytics
 * queries translate into SQL: active project membership of `memberId`, `deleted_at` and `archived_at` null.
 * `projectIds` accepts a list or the comma separated query string.
 */
export function getAnalyticsFilters(
  slug: string,
  memberId: number,
  type: 'analytics' | 'chart',
  dateFilter?: string | null,
  projectIds?: string | number[] | null,
  now = new Date()
): AnalyticsFilters {
  const ids = typeof projectIds === 'string' ? projectIds.split(',').map(Number) : projectIds
  const projectIdList = ids?.length ? ids.filter(id => Number.isSafeInteger(id) && id > 0) : undefined
  const scope = { workspaceSlug: slug, memberId, ...(projectIdList?.length ? { projectIds: projectIdList } : {}) }
  return {
    baseFilters: { ...scope },
    projectFilters: { ...scope },
    analyticsDateRange: type === 'analytics' ? getAnalyticsDateRange(dateFilter, null, null, now) : null,
    chartPeriodRange: type === 'chart' ? getChartPeriodRange(dateFilter, now) : null
  }
}
