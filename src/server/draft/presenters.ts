/** PD-1391 to PD-1395: `__str__` of the draft models, kept for logs and labels. */
export const formatDraftIssue = (name: string | null, projectName: string) => `${name} <${projectName}>`
export const formatDraftIssueAssignee = (draftName: string | null, assigneeEmail: string) =>
  `${draftName} ${assigneeEmail}`
export const formatDraftIssueLabel = (draftName: string | null, labelName: string) => `${draftName} ${labelName}`
export const formatDraftIssueModule = (moduleName: string, draftName: string | null) => `${moduleName} ${draftName}`
export const formatDraftIssueCycle = (cycleName: string) => cycleName

export type DraftListRow = {
  id: number
  name: string | null
  state_id: number | null
  sort_order: number
  completed_at: number | null
  estimate_point_id: number | null
  priority: string
  start_date: string | null
  target_date: string | null
  project_id: number | null
  parent_id: number | null
  cycle_id: number | null
  type_id: number | null
  description_html: string
  created_at: number
  updated_at: number
  created_by_id: number | null
  updated_by_id: number | null
  module_ids: string
  label_ids: string
  assignee_ids: string
}

const date = (value: number | null) => (value === null || value === undefined ? null : new Date(Number(value)))
const ids = (value: string) => (JSON.parse(value) as number[]) ?? []

/** `DraftIssueSerializer` (PD-0305 response shape): list and create answer, camelCase. */
export function toDraftIssueResponse(row: DraftListRow) {
  return {
    id: row.id,
    name: row.name,
    stateId: row.state_id,
    sortOrder: row.sort_order,
    completedAt: date(row.completed_at),
    estimatePoint: row.estimate_point_id,
    priority: row.priority,
    startDate: row.start_date,
    targetDate: row.target_date,
    projectId: row.project_id,
    parentId: row.parent_id,
    cycleId: row.cycle_id,
    moduleIds: ids(row.module_ids),
    labelIds: ids(row.label_ids),
    assigneeIds: ids(row.assignee_ids),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    createdBy: row.created_by_id,
    updatedBy: row.updated_by_id,
    typeId: row.type_id,
    descriptionHtml: row.description_html
  }
}

/** `DraftIssueDetailSerializer`: the same fields (Plane lists `description_html` twice). */
export const toDraftIssueDetailResponse = toDraftIssueResponse
