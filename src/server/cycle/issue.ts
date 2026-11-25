import { and, eq, isNull, sql } from 'drizzle-orm'
import { cycleIssues } from '@/db/schema/planning'
import { issues } from '@/db/schema/issue'
import { ServiceError } from '@/server/common/errors'
import { cycleAccess, loadCycle } from '@/server/cycle/access'
import { guestCannotViewIssue } from '@/server/issue/access'
import { issueListContext, paginateIssues } from '@/server/issue/list'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { IssueListQuery } from '@/types/issue/schema'

/**
 * PD-0515 `CycleIssueViewSet.list` and PD-0100: the issues of one cycle with the standard issue list filters,
 * `order_by`, `group_by` and `sub_group_by`, paginated in Plane's envelope. The cycle restriction is the `cycle`
 * filter of the issue list, so the annotations (PD-0514), grouping and callbacks (PD-0516 to PD-0518) are those of
 * `paginateIssues`. Project members above guest only, like Plane.
 */
export async function listCycleIssuesPage(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  cycleId: number,
  query: IssueListQuery
) {
  const ctx = await issueListContext(db, actor, slug, projectId, 15)
  await loadCycle(db, ctx.workspaceId, projectId, cycleId)
  return paginateIssues(db, ctx, { ...query, cycle: String(cycleId) })
}

/**
 * PD-0104 `CycleIssueDetailAPIEndpoint.get` and PD-0511: the assignment of one issue in the cycle, the issue and its
 * sub-issue count. A restricted guest gets 404 for issues they did not create (PD-0138).
 */
export async function getCycleIssue(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  cycleId: number,
  issueId: number
) {
  const { workspace } = await cycleAccess(db, actor, slug, projectId, 15)
  await loadCycle(db, workspace.id, projectId, cycleId)
  const [issue] = await db
    .select()
    .from(issues)
    .where(
      and(
        eq(issues.id, issueId),
        eq(issues.projectId, projectId),
        eq(issues.workspaceId, workspace.id),
        isNull(issues.deletedAt)
      )
    )
    .limit(1)
  if (!issue || (await guestCannotViewIssue(db, actor.userId, issue, slug)))
    throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Issue not found')
  const [assignment] = await db
    .select()
    .from(cycleIssues)
    .where(
      and(
        eq(cycleIssues.cycleId, cycleId),
        eq(cycleIssues.issueId, issueId),
        eq(cycleIssues.projectId, projectId),
        isNull(cycleIssues.deletedAt)
      )
    )
    .limit(1)
  if (!assignment) throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Cycle issue not found')
  const [sub] = await db.all<{ n: number }>(
    sql`select count(*) as n from issues si where si.parent_id = ${issueId} and si.deleted_at is null
      and si.archived_at is null and si.is_draft = 0`
  )
  return { assignment, issue, subIssuesCount: Number(sub?.n ?? 0) }
}
