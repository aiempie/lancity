import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { draftIssues } from '@/db/schema/planning'
import { containsFolded, searchValue } from '@/server/common/unicode'
import { dateFilter } from '@/server/issue/filter'
import type { LancityDb } from '@/types/database/schema'
import type { DraftListRow } from '@/server/draft/presenters'

const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none']
const STATE_GROUPS = ['backlog', 'unstarted', 'started', 'completed', 'cancelled']
const MAX_IDS = 80 // D1 allows 100 bind parameters per statement

/** Draft row with the related ids of `DraftIssueSerializer` (`cycle_id`, `module_ids`, `label_ids`, `assignee_ids`). */
const DRAFT_SELECT = sql`select d.id, d.name, d.state_id, d.sort_order, d.completed_at, d.estimate_point_id, d.priority,
  d.start_date, d.target_date, d.project_id, d.parent_id, d.type_id, d.description_html, d.created_at, d.updated_at,
  d.created_by_id, d.updated_by_id,
  (select dc.cycle_id from draft_issue_cycles dc where dc.draft_issue_id = d.id and dc.deleted_at is null limit 1) as cycle_id,
  coalesce((select json_group_array(v) from (select x.module_id as v from draft_issue_modules x
    join modules m on m.id = x.module_id and m.archived_at is null
    where x.draft_issue_id = d.id and x.deleted_at is null order by x.id)), '[]') as module_ids,
  coalesce((select json_group_array(v) from (select x.label_id as v from draft_issue_labels x
    where x.draft_issue_id = d.id and x.deleted_at is null order by x.id)), '[]') as label_ids,
  coalesce((select json_group_array(v) from (select x.assignee_id as v from draft_issue_assignees x
    join project_members pm on pm.project_id = x.project_id and pm.member_id = x.assignee_id and pm.is_active = 1 and pm.deleted_at is null
    where x.draft_issue_id = d.id and x.deleted_at is null order by x.id)), '[]') as assignee_ids
  from draft_issues d`

type Query = Record<string, string | undefined>

function csv(query: Query, key: string): string[] {
  return (query[key] ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}
function idList(query: Query, key: string): number[] {
  return csv(query, key)
    .filter(item => /^[1-9]\d{0,15}$/.test(item))
    .map(Number)
    .slice(0, MAX_IDS)
}
const inList = (values: (string | number)[]) =>
  sql`select value from json_each(${JSON.stringify(values)})`

/**
 * The subset of Plane `issue_filters` that applies to a `DraftIssue`: priority, state, state group, labels,
 * assignees, parent, creator, name and the start and target dates. Keys that only exist on issues (cycle, module)
 * are ignored; Plane would raise a field error for them.
 */
export function draftFilters(query: Query): SQL[] {
  const conds: SQL[] = []
  const priorities = csv(query, 'priority').filter(value => PRIORITIES.includes(value))
  if (priorities.length) conds.push(sql`d.priority in (${inList(priorities)})`)
  const stateIds = idList(query, 'state')
  if (stateIds.length) conds.push(sql`d.state_id in (${inList(stateIds)})`)
  const groups = csv(query, 'state_group').filter(value => STATE_GROUPS.includes(value))
  if (groups.length)
    conds.push(sql`exists (select 1 from states s where s.id = d.state_id and s."group" in (${inList(groups)}))`)
  const labelIds = idList(query, 'labels')
  if (labelIds.length)
    conds.push(
      sql`exists (select 1 from draft_issue_labels x where x.draft_issue_id = d.id and x.deleted_at is null and x.label_id in (${inList(labelIds)}))`
    )
  const assigneeIds = idList(query, 'assignees')
  if (assigneeIds.length)
    conds.push(
      sql`exists (select 1 from draft_issue_assignees x where x.draft_issue_id = d.id and x.deleted_at is null and x.assignee_id in (${inList(assigneeIds)}))`
    )
  const parentIds = idList(query, 'parent')
  if (parentIds.length) conds.push(sql`d.parent_id in (${inList(parentIds)})`)
  const creators = idList(query, 'created_by')
  if (creators.length) conds.push(sql`d.created_by_id in (${inList(creators)})`)
  const name = (query.name ?? '').trim()
  if (name) conds.push(containsFolded(sql`d.name`, name, searchValue('draft_issues', 'name', sql`d.id`)))
  dateFilter(conds, sql`d.start_date`, csv(query, 'start_date'))
  dateFilter(conds, sql`d.target_date`, csv(query, 'target_date'))
  return conds
}

/** PD-0883 `WorkspaceDraftIssueViewSet.get_queryset`, scoped to the creator's live drafts of one workspace. */
export function queryWorkspaceDraftIssue(db: LancityDb, workspaceId: number, userId: number, filters: SQL[] = []) {
  const where = sql`where d.workspace_id = ${workspaceId} and d.created_by_id = ${userId} and d.deleted_at is null${
    filters.length ? sql` and ${sql.join(filters, sql` and `)}` : sql``
  }`
  return {
    page: (offset: number, limit: number) =>
      db.all<DraftListRow>(
        sql`${DRAFT_SELECT} ${where} order by d.created_at desc, d.id desc limit ${limit} offset ${offset}`
      ),
    count: async () => (await db.all<{ n: number }>(sql`select count(*) as n from draft_issues d ${where}`))[0]?.n ?? 0
  }
}

/** One draft of the user with its related ids, or null. */
export async function findDraftRow(db: LancityDb, workspaceId: number, userId: number, draftId: number) {
  const [row] = await db.all<DraftListRow>(
    sql`${DRAFT_SELECT} where d.id = ${draftId} and d.workspace_id = ${workspaceId} and d.created_by_id = ${userId} and d.deleted_at is null`
  )
  return row ?? null
}

/** The draft table row (any creator) for update and delete checks. */
export async function findDraft(db: LancityDb, workspaceId: number, draftId: number) {
  const [row] = await db
    .select()
    .from(draftIssues)
    .where(and(eq(draftIssues.id, draftId), eq(draftIssues.workspaceId, workspaceId), isNull(draftIssues.deletedAt)))
    .limit(1)
  return row ?? null
}
