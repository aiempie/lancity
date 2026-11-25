import type { moduleLinks, modules } from '@/db/schema/planning'
import type { ModuleRow } from '@/server/module/queries'

type ModuleModel = typeof modules.$inferSelect
type ModuleLinkModel = typeof moduleLinks.$inferSelect

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return (value ?? fallback) as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
const iso = (value: unknown) => (typeof value === 'number' ? new Date(value).toISOString() : (value ?? null))
const num = (value: unknown) => Number(value ?? 0)

/**
 * PD-0666 / PD-0200 row to DTO. Plane `ModuleSerializer` fields in camelCase, like the rest of the Lancity API:
 * model columns, `memberIds`, `isFavorite` and the issue and estimate counters.
 */
export function toModuleRecord(row: ModuleRow) {
  return {
    id: num(row.id),
    workspaceId: num(row.workspace_id),
    projectId: num(row.project_id),
    name: String(row.name),
    description: String(row.description ?? ''),
    descriptionText: parseJson<unknown>(row.description_text, null),
    descriptionHtml: parseJson<unknown>(row.description_html, null),
    startDate: (row.start_date as string | null) ?? null,
    targetDate: (row.target_date as string | null) ?? null,
    status: String(row.status),
    leadId: (row.lead_id as number | null) ?? null,
    memberIds: parseJson<number[]>(row.member_ids, []),
    viewProps: parseJson<Record<string, unknown>>(row.view_props, {}),
    sortOrder: num(row.sort_order),
    externalSource: (row.external_source as string | null) ?? null,
    externalId: (row.external_id as string | null) ?? null,
    logoProps: parseJson<Record<string, unknown>>(row.logo_props, {}),
    totalEstimatePoints: num(row.total_estimate_points),
    completedEstimatePoints: num(row.completed_estimate_points),
    isFavorite: Boolean(row.is_favorite),
    totalIssues: num(row.total_issues),
    cancelledIssues: num(row.cancelled_issues),
    completedIssues: num(row.completed_issues),
    startedIssues: num(row.started_issues),
    unstartedIssues: num(row.unstarted_issues),
    backlogIssues: num(row.backlog_issues),
    createdById: (row.created_by_id as number | null) ?? null,
    updatedById: (row.updated_by_id as number | null) ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    archivedAt: iso(row.archived_at)
  }
}
export type ModuleRecord = ReturnType<typeof toModuleRecord>

/** `ModuleDetailSerializer`: the estimate counters per state group, the sub issue count and the links. */
export function toModuleDetailRecord(row: ModuleRow, links: ModuleLinkModel[], subIssues: number) {
  return {
    ...toModuleRecord(row),
    linkModule: links,
    subIssues,
    backlogEstimatePoints: num(row.backlog_estimate_points),
    unstartedEstimatePoints: num(row.unstarted_estimate_points),
    startedEstimatePoints: num(row.started_estimate_points),
    cancelledEstimatePoints: num(row.cancelled_estimate_points)
  }
}

/** PD-0038 `ModuleSerializer.to_representation` of the external API: the DTO plus `members` (the member ids). */
export function toModuleResponseApi(record: ModuleRecord) {
  return { ...record, members: record.memberIds }
}

/** PD-0339 `ModuleWriteSerializer.to_representation`: the saved module with its `member_ids`. */
export function toModuleWriteResponse(module: ModuleModel, memberIds: number[]) {
  return { ...module, memberIds }
}

const COUNTER_KEYS = [
  'totalIssues',
  'cancelledIssues',
  'completedIssues',
  'startedIssues',
  'unstartedIssues',
  'backlogIssues',
  'totalEstimatePoints',
  'completedEstimatePoints',
  'isFavorite'
]
/** Lite DTO of the module pickers (`ModuleLiteSerializer`): the model columns and member ids without counters. */
export function toModuleLite(row: ModuleRow) {
  const record: Record<string, unknown> = { ...toModuleRecord(row) }
  for (const key of COUNTER_KEYS) delete record[key]
  return record
}

const toCamel = (key: string) => key.replace(/_+([a-z])/g, (_, letter: string) => letter.toUpperCase())
/** Rows of the assignee and label breakdowns: SQL column names become camelCase keys, missing values null. */
export function toDistribution(rows: Record<string, unknown>[]) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [toCamel(key), value ?? null])))
}

// `__str__` of the module models (PD-1449 to PD-1453): reference labels for logs and display.
export const formatModule = (module: { name: string; startDate: string | null; targetDate: string | null }) =>
  `${module.name} ${module.startDate} ${module.targetDate}`
export const formatModuleMember = (moduleName: string, memberEmail: string) => `${moduleName} ${memberEmail}`
export const formatModuleIssue = (moduleName: string, issueName: string) => `${moduleName} ${issueName}`
export const formatModuleLink = (moduleName: string, url: string) => `${moduleName} ${url}`
export const formatModuleUserProperties = (moduleName: string, email: string) => `${moduleName} ${email}`
