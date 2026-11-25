import { and, eq, isNull, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { issues, states } from '@/db/schema/issue'
import { ServiceError } from '@/server/common/errors'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

export const nowMs = sql`cast(unixepoch('subsec') * 1000 as integer)`
export const lastInsertId = sql<number>`last_insert_rowid()` as unknown as number

type CollabIssueOptions = {
  /** Reads keep working on archived issues (Plane `include_archived=True`). */
  includeArchived?: boolean
  /** Answer 404 instead of 403 to a restricted guest (Plane `guest_cannot_view_issue`). */
  hideFromGuest?: boolean
  /** Writes are refused for triage issues, matching `Issue.issue_objects`. */
  write?: boolean
}

/**
 * Port of `issue_in_project` and `issue_hidden_from_guest`: the issue must live in the URL
 * workspace and project, and a restricted guest only reaches issues they created.
 */
export async function collabIssue(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  options: CollabIssueOptions = {}
) {
  const access = await requireProjectAccess(db, actor, slug, projectId, 5)
  const [row] = await db
    .select({ issue: issues, stateGroup: states.group, stateIsTriage: states.isTriage })
    .from(issues)
    .leftJoin(states, eq(states.id, issues.stateId))
    .where(
      and(
        eq(issues.id, issueId),
        eq(issues.projectId, projectId),
        eq(issues.workspaceId, access.workspace.id),
        isNull(issues.deletedAt),
        eq(issues.isDraft, false),
        options.includeArchived ? undefined : isNull(issues.archivedAt)
      )
    )
    .limit(1)
  if (!row || (options.write && (row.stateGroup === 'triage' || row.stateIsTriage)))
    throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Issue not found')
  const isAdmin = access.workspaceMembership.role === 20 || access.membership.role === 20
  const restrictedGuest =
    access.membership.role === 5 && access.workspaceMembership.role !== 20 && !access.project.guestViewAllFeatures
  if (restrictedGuest && row.issue.createdById !== actor.userId) {
    if (options.hideFromGuest) throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Issue not found')
    throw new ServiceError(403, 'FORBIDDEN', 'You are not allowed to view this issue')
  }
  return { ...access, issue: row.issue, isAdmin }
}

/** Recheck membership and guest visibility inside the mutating statement itself. */
export function issueGuard(actor: Actor, slug: string, projectId: number, issueId: number, includeArchived = false) {
  return sql`exists (select 1 from issues i
    join projects p on p.id = i.project_id and p.workspace_id = i.workspace_id
    join workspaces w on w.id = p.workspace_id
    join workspace_members wm on wm.workspace_id = w.id and wm.member_id = ${actor.userId}
    join project_members pm on pm.project_id = p.id and pm.workspace_id = w.id and pm.member_id = ${actor.userId}
    where i.id = ${issueId} and p.id = ${projectId} and w.slug = ${slug}
      and i.deleted_at is null and (${includeArchived ? 1 : 0} = 1 or i.archived_at is null) and i.is_draft = 0
      and p.deleted_at is null and p.archived_at is null and w.deleted_at is null
      and wm.is_active = 1 and wm.deleted_at is null and pm.is_active = 1 and pm.deleted_at is null
      and not exists (select 1 from states s where s.id = i.state_id and (s."group" = 'triage' or s.is_triage = 1))
      and (wm.role = 20 or pm.role >= 15 or p.guest_view_all_features = 1 or i.created_by_id = ${actor.userId}))`
}

/** SQL form of "project admin or workspace admin" for the acting user. */
export function adminGuard(actor: Actor, slug: string, projectId: number) {
  return sql`exists (select 1 from projects p
    join workspaces w on w.id = p.workspace_id
    join workspace_members wm on wm.workspace_id = w.id and wm.member_id = ${actor.userId}
    join project_members pm on pm.project_id = p.id and pm.workspace_id = w.id and pm.member_id = ${actor.userId}
    where p.id = ${projectId} and w.slug = ${slug} and wm.is_active = 1 and wm.deleted_at is null
      and pm.is_active = 1 and pm.deleted_at is null and (wm.role = 20 or pm.role = 20))`
}

export function parsePage<T extends { id: number }>(rows: T[], perPage: number) {
  const hasNext = rows.length > perPage
  const results = hasNext ? rows.slice(0, perPage) : rows
  return {
    results,
    next_page_results: hasNext,
    next_cursor: hasNext ? String(results[results.length - 1].id) : null,
    per_page: perPage
  }
}

/** Run statements atomically. Each result holds the rows returned by the statement at the same index. */
export async function runBatch(db: LancityDb, items: BatchItem<'sqlite'>[]) {
  const [first, ...rest] = items
  return (await db.batch([first, ...rest])) as unknown as unknown[][]
}
