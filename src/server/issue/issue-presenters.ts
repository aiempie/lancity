import { sql } from 'drizzle-orm'
import type { LancityDb } from '@/types/database/schema'

/** `Issue.__str__` (PD-1419). */
export const formatIssue = (name: string, projectName: string) => `${name} <${projectName}>`
/** `State.__str__` (PD-1488). */
export const formatState = (name: string, projectName: string) => `${name} <${projectName}>`
/** `IssueAssignee.__str__` (PD-1425). */
export const formatIssueAssignee = (issueName: string, assigneeEmail: string) => `${issueName} ${assigneeEmail}`
/** `IssueLabel.__str__` (PD-1433). */
export const formatIssueLabel = (issueName: string, labelName: string) => `${issueName} ${labelName}`
/** `Label.__str__` (PD-1444). */
export const formatLabel = (name: string) => name

/** `IssueCreateSerializer.to_representation` (PD-0321, PD-0024): the created row plus the ids that were linked. */
export function toIssueCreateResponse<T extends object>(issue: T, assigneeIds: number[], labelIds: number[]) {
  return { ...issue, assigneeIds, labelIds }
}

/** `IssueListDetailSerializer` helpers (PD-0335 to PD-0337): decode the JSON id arrays of a list row. */
const ids = (value: unknown): number[] => (typeof value === 'string' ? (JSON.parse(value) as number[]) : ((value as number[]) ?? []))
export const getModuleIdsIssueListDetail = (row: Record<string, unknown>) => ids(row.module_ids ?? row.moduleIds)
export const getLabelIdsIssueListDetail = (row: Record<string, unknown>) => ids(row.label_ids ?? row.labelIds)
export const getAssigneeIdsIssueListDetail = (row: Record<string, unknown>) => ids(row.assignee_ids ?? row.assigneeIds)

/**
 * `IssueListDetailSerializer.__init__` and `to_representation` (PD-0334, PD-0338): `fields` limits the keys of every
 * item, the way the `fields` query parameter does in Plane. Unknown names are ignored, `id` is always kept.
 */
export function initIssueListDetail(fields: string | string[] | undefined) {
  const wanted = (Array.isArray(fields) ? fields : (fields ?? '').split(',')).map(field => field.trim()).filter(Boolean)
  return wanted.length ? new Set(['id', ...wanted.map(field => field.replace(/_+([a-z])/g, (_, c: string) => c.toUpperCase()))]) : null
}
export function toIssueListDetailResponse<T extends Record<string, unknown>>(item: T, fields: Set<string> | null) {
  return fields ? Object.fromEntries(Object.entries(item).filter(([key]) => fields.has(key))) : item
}

/** `IssueExpandSerializer.get_labels` (PD-0030): `{ id, name, color }` for the labels of each issue. */
export async function getLabelsIssueExpandApi(db: LancityDb, issueIds: number[]) {
  if (!issueIds.length) return new Map<number, Array<{ id: number; name: string; color: string }>>()
  const rows = await db.all<{ issue_id: number; id: number; name: string; color: string }>(sql`select il.issue_id, l.id, l.name, l.color
    from issue_labels il join labels l on l.id = il.label_id
    where il.deleted_at is null and l.deleted_at is null and il.issue_id in (select value from json_each(${JSON.stringify(issueIds)}))`)
  const result = new Map<number, Array<{ id: number; name: string; color: string }>>()
  for (const row of rows) result.set(row.issue_id, [...(result.get(row.issue_id) ?? []), { id: row.id, name: row.name, color: row.color }])
  return result
}

/** `IssueExpandSerializer.get_assignees` (PD-0031): `{ id, name, image }` for the assignees of each issue. */
export async function getAssigneesIssueExpandApi(db: LancityDb, issueIds: number[]) {
  if (!issueIds.length) return new Map<number, Array<{ id: number; name: string; image: string | null }>>()
  const rows = await db.all<{ issue_id: number; id: number; name: string; image: string | null }>(sql`select ia.issue_id, u.id, u.name, u.image
    from issue_assignees ia join "user" u on u.id = ia.assignee_id
    join issues i on i.id = ia.issue_id
    join project_members pm on pm.project_id = i.project_id and pm.member_id = ia.assignee_id and pm.is_active = 1 and pm.deleted_at is null
    where ia.deleted_at is null and ia.issue_id in (select value from json_each(${JSON.stringify(issueIds)}))`)
  const result = new Map<number, Array<{ id: number; name: string; image: string | null }>>()
  for (const row of rows) result.set(row.issue_id, [...(result.get(row.issue_id) ?? []), { id: row.id, name: row.name, image: row.image }])
  return result
}

/**
 * `IssueSerializer.to_representation` and `get_fields` (PD-0020, PD-0024): the public API shape of an issue, with
 * the description binary removed and the expanded labels and assignees added when requested.
 */
export async function toIssueResponseApi(
  db: LancityDb,
  issue: Record<string, unknown> & { id: number },
  expand: string[] = []
) {
  const { descriptionBinary: _binary, ...rest } = issue
  void _binary
  const out: Record<string, unknown> = { ...rest }
  if (expand.includes('labels')) out.labels = (await getLabelsIssueExpandApi(db, [issue.id])).get(issue.id) ?? []
  if (expand.includes('assignees')) out.assignees = (await getAssigneesIssueExpandApi(db, [issue.id])).get(issue.id) ?? []
  return out
}

/** Linked label ids and assignee ids of issues. Assignees that left the project (inactive membership) are left out. */
export async function getIssueLinkIds(db: LancityDb, issueIds: number[]) {
  const result = new Map<number, { assigneeIds: number[]; labelIds: number[] }>()
  for (const id of issueIds) result.set(id, { assigneeIds: [], labelIds: [] })
  if (!issueIds.length) return result
  const list = sql`select value from json_each(${JSON.stringify(issueIds)})`
  const assignees = await db.all<{ issue_id: number; id: number }>(sql`select distinct ia.issue_id, ia.assignee_id as id
    from issue_assignees ia join issues i on i.id = ia.issue_id
    join project_members pm on pm.project_id = i.project_id and pm.member_id = ia.assignee_id and pm.is_active = 1 and pm.deleted_at is null
    where ia.deleted_at is null and ia.issue_id in (${list}) order by ia.assignee_id`)
  const issueLabels = await db.all<{ issue_id: number; id: number }>(sql`select distinct il.issue_id, il.label_id as id
    from issue_labels il join labels l on l.id = il.label_id and l.deleted_at is null
    where il.deleted_at is null and il.issue_id in (${list}) order by il.label_id`)
  for (const row of assignees) result.get(row.issue_id)?.assigneeIds.push(row.id)
  for (const row of issueLabels) result.get(row.issue_id)?.labelIds.push(row.id)
  return result
}

/** `?expand=labels,assignees` and `?fields=a,b` of the public API (Plane `BaseSerializer` `expand` and `fields`). */
export function parseIssueApiQuery(query: Record<string, string | undefined> = {}) {
  const expand = (query.expand ?? '').split(',').map(part => part.trim()).filter(Boolean)
  return { expand, fields: initIssueListDetail(query.fields) }
}

/**
 * Response of the issue endpoints: `toIssueResponseApi` (no description binary, `expand` applied) plus the linked
 * `assigneeIds` and `labelIds`, then limited to `?fields=`. Rows that already carry both id lists keep them.
 */
export async function presentIssueApi(
  db: LancityDb,
  issue: Record<string, unknown>,
  query: Record<string, string | undefined> = {}
) {
  const { expand, fields } = parseIssueApiQuery(query)
  const issueId = Number(issue.id)
  const base = await toIssueResponseApi(db, { ...issue, id: issueId }, expand)
  if (!('assigneeIds' in base) || !('labelIds' in base)) {
    const links = (await getIssueLinkIds(db, [issueId])).get(issueId)
    base.assigneeIds ??= links?.assigneeIds ?? []
    base.labelIds ??= links?.labelIds ?? []
  }
  return toIssueListDetailResponse(base, fields)
}

/** Same as `presentIssueApi` for a list of rows. */
export async function presentIssueApiList(
  db: LancityDb,
  issues: Array<Record<string, unknown>>,
  query: Record<string, string | undefined> = {}
) {
  return Promise.all(issues.map(issue => presentIssueApi(db, issue, query)))
}
