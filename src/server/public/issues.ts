import { sql } from 'drizzle-orm'
import { ServiceError } from '@/server/common/errors'
import { issueAnnotations, issueOnResults as toIssueRows } from '@/server/issue/filter'
import { paginateIssues, type IssueListContext } from '@/server/issue/list'
import { requireBoard } from '@/server/public/board'
import { issueOnResults, issueQuerysetGrouper } from '@/server/public/grouper'
import { visibleIssues } from '@/server/public/service'
import type { LancityDb } from '@/types/database/schema'
import type { IssueListQuery } from '@/types/issue/schema'

/**
 * PD-1656 `ProjectIssuesPublicEndpoint.get`: paginated, filtered, grouped and sub-grouped issues of the board project.
 * The scope is `Issue.issue_objects` of the board (no triage, draft, archived), which `paginateIssues` applies through
 * `LIVE_ISSUES`. A visitor is never a restricted guest, so no `created_by` restriction is added.
 * PD-1657, PD-1658, PD-1659 (the lambdas that build the group values and on-results callbacks) are the grouping code
 * of `paginateIssues` plus `issueOnResults` of `grouper.ts`.
 */
export async function getPublicProjectIssues(db: LancityDb, anchor: string, query: IssueListQuery) {
  const board = await requireBoard(db, anchor)
  issueQuerysetGrouper(query)
  const ctx: IssueListContext = {
    actor: { userId: 0 },
    slug: board.workspaceSlug,
    projectId: board.projectId,
    workspaceId: board.workspaceId,
    ownOnly: false
  }
  const page = await paginateIssues(db, ctx, query, 'live', { publicBoard: true })
  await issueOnResults(db, page.results)
  return page
}

/**
 * PD-1679 `IssueRetrievePublicEndpoint.get`: the issue with its related ids, votes and reactions. Hidden issues
 * (triage, draft, archived, other project) answer 404. The description binary is not exposed.
 */
export async function getPublicIssueDetail(db: LancityDb, anchor: string, issueId: number) {
  await requireBoard(db, anchor)
  const [row] = await db.all<
    Record<string, unknown>
  >(sql`select issues.id, issues.name, issues.state_id, issues.sort_order,
    issues.description_json, issues.description_html, issues.description_stripped as description,
    issues.estimate_point_id as estimate_point, issues.priority, issues.start_date, issues.target_date, issues.sequence_id,
    issues.project_id, issues.parent_id, issues.created_by_id as created_by, ${issueAnnotations(true)}
    from issues where issues.id = ${issueId} and ${visibleIssues(db, anchor)} limit 1`)
  if (!row) throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Issue not found on this board')
  const [issue] = toIssueRows([row])
  if (typeof issue.descriptionJson === 'string') issue.descriptionJson = JSON.parse(issue.descriptionJson)
  const [withEngagement] = await issueOnResults(db, [issue])
  return withEngagement
}
