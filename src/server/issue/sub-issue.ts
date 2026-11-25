import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { issues } from '@/db/schema/issue'
import type { BatchItem } from 'drizzle-orm/batch'
import { parseInput } from '@/server/api/v1/validation'
import { ServiceError } from '@/server/common/errors'
import { issueEventStatement, publishIssueEvent } from '@/server/issue/events'
import { ISSUE_LIST_SELECT, issueOnResults, orderIssueQueryset } from '@/server/issue/filter'
import { activityStatement, issueIdentifierLabel, versionStatement } from '@/server/issue/jobs/history'
import { issueListContext, listWhere } from '@/server/issue/list'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import { subIssuesInputSchema, type IssueListQuery, type SubIssuesInput } from '@/types/issue/schema'

type Statement = BatchItem<'sqlite'>

function distribution(rows: Array<Record<string, unknown>>) {
  const result: Record<string, string[]> = {}
  for (const row of rows) (result[String(row.stateGroup)] ??= []).push(String(row.id))
  return result
}

/**
 * Port of `SubIssuesEndpoint.get` (PD-0642). A restricted guest may only open sub-issues of an issue they created.
 * `group_by` groups the list by any scalar field, or by `assignees__ids` (an issue appears under each assignee).
 */
export async function getSubIssues(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  query: IssueListQuery = {}
) {
  const ctx = await issueListContext(db, actor, slug, projectId)
  const [parent] = await db.all<{ created_by_id: number | null }>(
    sql`select created_by_id from issues where id = ${issueId} and project_id = ${projectId} and workspace_id = ${ctx.workspaceId} and deleted_at is null`
  )
  if (ctx.ownOnly && parent && parent.created_by_id !== actor.userId)
    throw new ServiceError(403, 'FORBIDDEN', 'You are not allowed to view this issue')
  const where = listWhere(ctx, {}, 'live', [sql`issues.parent_id = ${issueId}`])
  const order = orderIssueQueryset(query.order_by)
  const rows = issueOnResults(
    await db.all<Record<string, unknown>>(sql`select ${ISSUE_LIST_SELECT} from issues where ${where} order by ${order.orderBy}`)
  )
  const stateDistribution = distribution(rows)
  const groupBy = query.group_by
  if (!groupBy) return { subIssues: rows, stateDistribution }
  const grouped: Record<string, unknown[]> = {}
  for (const row of rows) {
    if (groupBy === 'assignees__ids') {
      const ids = row.assigneeIds as number[]
      if (ids.length) for (const id of ids) (grouped[String(id)] ??= []).push(row)
      else (grouped.None ??= []).push(row)
    } else {
      const key = String(row[groupBy.replace(/_+([a-z])/g, (_, letter: string) => letter.toUpperCase())] ?? 'None')
      ;(grouped[key] ??= []).push(row)
    }
  }
  return { subIssues: grouped, stateDistribution }
}

/**
 * Port of `SubIssuesEndpoint.post` (PD-0643): attach issues of the same project under a parent. The parent is looked up
 * inside the URL's project, an issue cannot become a child of its own descendant, and each change records an activity row.
 */
export async function createSubIssues(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  raw: SubIssuesInput
) {
  const input = parseInput(subIssuesInputSchema, raw)
  const ctx = await issueListContext(db, actor, slug, projectId, 15)
  const [parent] = await db.all<{ id: number }>(
    sql`select id from issues where id = ${issueId} and project_id = ${projectId} and workspace_id = ${ctx.workspaceId}
      and deleted_at is null and archived_at is null and is_draft = 0`
  )
  if (!parent) throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Parent issue not found')
  const ids = [...new Set(input.subIssueIds)]
  const idList = sql`select value from json_each(${JSON.stringify(ids)})`
  // The parent and everything above it can never become a child of this issue.
  const forbidden = await db.all<{ id: number }>(sql`with recursive up(id) as (
    select ${issueId} union select i.parent_id from issues i join up on i.id = up.id where i.parent_id is not null
  ) select id from up where id in (${idList})`)
  if (forbidden.length) throw new ServiceError(400, 'INVALID_PARENT', 'An issue cannot be a sub-issue of its own descendant')
  const children = await db.all<{ id: number; parent_id: number | null }>(
    sql`select id, parent_id from issues where id in (${idList}) and project_id = ${projectId} and workspace_id = ${ctx.workspaceId}
      and deleted_at is null and archived_at is null and is_draft = 0`
  )
  const nowMs = sql`cast(unixepoch('subsec') * 1000 as integer)`
  const newLabel = await issueIdentifierLabel(db, projectId, issueId)
  const oldLabels = new Map<number, string>()
  for (const child of children)
    if (child.parent_id && !oldLabels.has(child.parent_id))
      oldLabels.set(child.parent_id, await issueIdentifierLabel(db, projectId, child.parent_id))
  for (let start = 0; start < children.length; start += 20) {
    const statements: Statement[] = []
    const mutations = children.slice(start, start + 20).map(child => ({ child, mutationId: crypto.randomUUID() }))
    for (const { child, mutationId } of mutations)
      statements.push(
        // Builder statement: `db.run(sql)` cannot be bound inside a D1 batch.
        db
          .update(issues)
          .set({ parentId: issueId, updatedById: actor.userId, updatedAt: sql`max(${issues.updatedAt} + 1, ${nowMs})` })
          .where(
            and(
              eq(issues.id, child.id),
              eq(issues.projectId, projectId),
              isNull(issues.deletedAt),
              sql`exists (select 1 from project_members pm
                join workspace_members wm on wm.workspace_id = pm.workspace_id and wm.member_id = pm.member_id
                where pm.project_id = ${projectId} and pm.member_id = ${actor.userId} and pm.is_active = 1 and pm.deleted_at is null
                  and wm.is_active = 1 and wm.deleted_at is null and (wm.role = 20 or pm.role >= 15))`
            )
          ),
        activityStatement(
          db,
          child.id,
          projectId,
          actor.userId,
          'updated',
          'parent',
          // Plane `track_parent` stores `PROJ-12` (identifier and sequence).
          oldLabels.get(child.parent_id ?? 0) ?? '',
          newLabel,
          'updated the parent issue to',
          child.parent_id,
          issueId,
          false,
          mutationId
        ),
        versionStatement(db, child.id, projectId, actor.userId),
        issueEventStatement(db, mutationId, {
          event: 'updated',
          issueId: child.id,
          projectId,
          actorId: actor.userId,
          requestedData: { parent: String(issueId) },
          currentInstance: { parent: String(child.parent_id) }
        })
      )
    await db.batch(statements as [Statement, ...Statement[]])
    for (const { mutationId } of mutations) await publishIssueEvent(db, mutationId)
  }
  const where: SQL = listWhere(ctx, {}, 'live', [sql`issues.id in (${idList})`, sql`issues.parent_id = ${issueId}`])
  const rows = issueOnResults(
    await db.all<Record<string, unknown>>(sql`select ${ISSUE_LIST_SELECT} from issues where ${where} order by issues.id`)
  )
  return { subIssues: rows, stateDistribution: distribution(rows) }
}
