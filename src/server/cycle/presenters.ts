import { formatInTimeZone } from '@/server/common/timezone-converter'

type Row = Record<string, unknown>

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return (value ?? fallback) as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const iso = (value: unknown): string | null =>
  typeof value === 'number' || value instanceof Date ? new Date(value).toISOString() : null

/** Datetime in the project's timezone (Plane `user_timezone_converter`). Falls back to UTC for an unknown zone. */
function zoned(value: unknown, timeZone: string): string | null {
  if (typeof value !== 'number' && !(value instanceof Date)) return null
  try {
    return formatInTimeZone(new Date(value), timeZone)
  } catch {
    return new Date(value).toISOString()
  }
}

const num = (value: unknown) => Number(value ?? 0)

/**
 * PD-0010 and the `CycleSerializer` field list. Turns a row of `annotatedCyclesSql` into the camelCase DTO that the
 * existing cycle routes already return, plus the Plane annotations. `start_date` and `end_date` are in the project
 * timezone like Plane; the other timestamps are UTC ISO strings.
 */
export function presentCycle(row: Row, projectTimezone?: string) {
  const timeZone = projectTimezone ?? String(row.project_timezone ?? 'UTC')
  const dto: Row = {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    startDate: zoned(row.start_date, timeZone),
    endDate: zoned(row.end_date, timeZone),
    ownedById: row.owned_by_id,
    viewProps: json(row.view_props, {}),
    sortOrder: row.sort_order,
    externalSource: row.external_source ?? null,
    externalId: row.external_id ?? null,
    progressSnapshot: json(row.progress_snapshot, {}),
    logoProps: json(row.logo_props, {}),
    archivedAt: iso(row.archived_at),
    timezone: row.timezone,
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    createdById: row.created_by_id ?? null,
    updatedById: row.updated_by_id ?? null,
    isFavorite: Boolean(row.is_favorite),
    totalIssues: num(row.total_issues),
    completedIssues: num(row.completed_issues),
    cancelledIssues: num(row.cancelled_issues),
    startedIssues: num(row.started_issues),
    unstartedIssues: num(row.unstarted_issues),
    backlogIssues: num(row.backlog_issues),
    assigneeIds: json<number[]>(row.assignee_ids, []),
    status: row.status
  }
  if ('total_estimate_points' in row) {
    dto.backlogEstimatePoints = num(row.backlog_estimate_points)
    dto.unstartedEstimatePoints = num(row.unstarted_estimate_points)
    dto.startedEstimatePoints = num(row.started_estimate_points)
    dto.cancelledEstimatePoints = num(row.cancelled_estimate_points)
    dto.completedEstimatePoints = num(row.completed_estimate_points)
    dto.totalEstimatePoints = num(row.total_estimate_points)
  }
  return dto
}

/** `CycleLiteSerializer`: the cycle columns without annotations. */
export function presentCycleLite(row: Row) {
  const dto = presentCycle(row, 'UTC')
  return {
    id: dto.id,
    workspaceId: dto.workspaceId,
    projectId: dto.projectId,
    name: dto.name,
    description: dto.description,
    startDate: dto.startDate,
    endDate: dto.endDate,
    ownedById: dto.ownedById,
    sortOrder: dto.sortOrder,
    externalSource: dto.externalSource,
    externalId: dto.externalId,
    logoProps: dto.logoProps,
    archivedAt: dto.archivedAt,
    timezone: dto.timezone,
    version: dto.version,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt
  }
}

/** PD-1383 `Cycle.__str__`. */
export function formatCycle(cycle: { name: string }, project: { name: string }): string {
  return `${cycle.name} <${project.name}>`
}

/** PD-1384 `CycleIssue.__str__`. */
export function formatCycleIssue(cycle: { name: string }, project: { name: string }): string {
  return formatCycle(cycle, project)
}

/** PD-1385 `CycleUserProperties.__str__`. */
export function formatCycleUserProperties(cycle: { name: string }, user: { email: string }): string {
  return `${cycle.name} ${user.email}`
}

/** Cycle user properties row as Plane's `CycleUserPropertiesSerializer`, in the same camelCase style. */
export function presentCycleUserProperties(row: {
  id: number
  cycleId: number
  projectId: number
  workspaceId: number
  userId: number
  filters: unknown
  richFilters: unknown
  displayFilters: unknown
  displayProperties: unknown
  createdAt: Date
  updatedAt: Date
}) {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
}
