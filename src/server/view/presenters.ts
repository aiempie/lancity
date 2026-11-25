import { pickFields } from '@/server/common/serializers'

type Row = Record<string, unknown>

const ids = (value: unknown): number[] => {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value
  return Array.isArray(parsed) ? (parsed as number[]) : []
}
const iso = (value: unknown) => (typeof value === 'number' ? new Date(value).toISOString() : (value ?? null))

/** `ViewIssueListSerializer.get_assignee_ids` (PD-0370). Rows come from `ISSUE_LIST_SELECT`, which aggregates the ids. */
export const getAssigneeIdsViewIssueList = (row: Row) => ids(row.assignee_ids)
/** `ViewIssueListSerializer.get_label_ids` (PD-0371). */
export const getLabelIdsViewIssueList = (row: Row) => ids(row.label_ids)
/** `ViewIssueListSerializer.get_module_ids` (PD-0372). */
export const getModuleIdsViewIssueList = (row: Row) => ids(row.module_ids)

/** `ViewIssueListSerializer.to_representation` (PD-0373), with the camelCase keys the other Lancity lists use. */
export function toViewIssueListResponse(row: Row) {
  return {
    id: row.id,
    name: row.name,
    stateId: row.state_id,
    sortOrder: row.sort_order,
    completedAt: iso(row.completed_at),
    estimatePoint: row.estimate_point,
    priority: row.priority,
    startDate: row.start_date,
    targetDate: row.target_date,
    sequenceId: row.sequence_id,
    projectId: row.project_id,
    parentId: row.parent_id,
    cycleId: row.cycle_id ?? null,
    subIssuesCount: row.sub_issues_count,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    attachmentCount: row.attachment_count,
    linkCount: row.link_count,
    isDraft: Boolean(row.is_draft),
    archivedAt: iso(row.archived_at),
    stateGroup: row.state__group ?? null,
    assigneeIds: getAssigneeIdsViewIssueList(row),
    labelIds: getLabelIdsViewIssueList(row),
    moduleIds: getModuleIdsViewIssueList(row)
  }
}

/** `IssueView.__str__` (PD-1506): reference only, used in logs. */
export const formatIssueView = (name: string, projectName: string) => `${name} <${projectName}>`

const toCamel = (key: string) => key.replace(/_+([a-z])/g, (_, letter: string) => letter.toUpperCase())

/** `DynamicBaseSerializer(fields=...)` for views: `fields` may use Plane's snake_case or Lancity's camelCase names. */
export function toViewResponse<T extends Row>(row: T, fields: string[] | null | undefined) {
  return fields?.length ? pickFields(row, fields.map(toCamel)) : row
}
