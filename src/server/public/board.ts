import { and, eq, exists, isNull, sql } from 'drizzle-orm'
import { deployBoards, projectPublicMembers } from '@/db/schema/content'
import { issueComments, issues } from '@/db/schema/issue'
import { projects, workspaces } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import { outboxStatement } from '@/server/common/outbox'
import type { SQL } from 'drizzle-orm'
import { visibleBoard, visibleIssues } from '@/server/public/service'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { IssueActivityJob } from '@/types/issue/p1-issue-background-schema'

export const nowMs = sql`cast(unixepoch('subsec') * 1000 as integer)`

/**
 * PD-1635 `DeployBoardAnchorMixin.initial` and PD-1636 `BaseViewSet.get_queryset`: a board only serves the project it
 * belongs to. `visibleBoard` already requires `entity_identifier = project_id` and rejects unpublished, disabled and
 * archived boards, so every public operation starts here.
 */
export async function requireBoard(db: LancityDb, anchor: string) {
  const [board] = await db
    .select({
      id: deployBoards.id,
      anchor: deployBoards.anchor,
      projectId: projects.id,
      workspaceId: projects.workspaceId,
      workspaceSlug: workspaces.slug,
      workspaceName: workspaces.name,
      createdAt: deployBoards.createdAt,
      updatedAt: deployBoards.updatedAt,
      intakeId: deployBoards.intakeId,
      isCommentsEnabled: deployBoards.isCommentsEnabled,
      isReactionsEnabled: deployBoards.isReactionsEnabled,
      isVotesEnabled: deployBoards.isVotesEnabled,
      isActivityEnabled: deployBoards.isActivityEnabled,
      viewProps: deployBoards.viewProps
    })
    .from(deployBoards)
    .innerJoin(
      projects,
      and(eq(projects.id, deployBoards.projectId), eq(projects.workspaceId, deployBoards.workspaceId))
    )
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .where(visibleBoard(anchor))
    .limit(1)
  if (!board) throw new ServiceError(404, 'BOARD_NOT_FOUND', 'Project is not published')
  return board
}
export type PublicBoard = Awaited<ReturnType<typeof requireBoard>>

const FEATURES = {
  comments: ['isCommentsEnabled', 'COMMENTS_DISABLED', 'Comments are not enabled for this project'],
  reactions: ['isReactionsEnabled', 'REACTIONS_DISABLED', 'Reactions are not enabled for this project board'],
  votes: ['isVotesEnabled', 'VOTES_DISABLED', 'Votes are not enabled for this project board']
} as const

/** The board owner decides which interactions are public (`is_comments_enabled`, `is_reactions_enabled`, `is_votes_enabled`). */
export function requireBoardFeature(board: PublicBoard, feature: keyof typeof FEATURES) {
  const [flag, code, message] = FEATURES[feature]
  if (!board[flag]) throw new ServiceError(400, code, message)
}

/** PD-1653 `_issue_in_board_scope`: only an issue the board displays (not triage, draft, archived or another project). */
export async function issueInBoardScope(db: LancityDb, board: PublicBoard, issueId: number) {
  const [row] = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.id, issueId), visibleIssues(db, board.anchor)))
    .limit(1)
  return Boolean(row)
}

export async function requireIssueInBoard(db: LancityDb, board: PublicBoard, issueId: number) {
  if (!(await issueInBoardScope(db, board, issueId))) throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Issue not found')
}

/**
 * PD-1654 `_comment_in_board_scope`: an EXTERNAL comment of the board project. Stricter than Plane: the issue of the
 * comment must also be visible on the board, and a soft-deleted comment never matches.
 */
export function commentOnBoard(db: LancityDb, board: PublicBoard, commentId: number) {
  return and(
    eq(issueComments.id, commentId),
    eq(issueComments.projectId, board.projectId),
    eq(issueComments.workspaceId, board.workspaceId),
    eq(issueComments.access, 'EXTERNAL'),
    isNull(issueComments.deletedAt),
    exists(
      db
        .select({ id: issues.id })
        .from(issues)
        .where(and(eq(issues.id, issueComments.issueId), visibleIssues(db, board.anchor)))
    )
  )
}

export async function commentInBoardScope(db: LancityDb, board: PublicBoard, commentId: number) {
  const [row] = await db
    .select({ id: issueComments.id })
    .from(issueComments)
    .where(commentOnBoard(db, board, commentId))
    .limit(1)
  return Boolean(row)
}

/** PD-1626 `_is_own_board_comment`: an EXTERNAL board comment written by the caller. */
export async function isOwnBoardComment(db: LancityDb, board: PublicBoard, commentId: number, actor: Actor) {
  const [row] = await db
    .select({ id: issueComments.id })
    .from(issueComments)
    .where(and(commentOnBoard(db, board, commentId), eq(issueComments.actorId, actor.userId)))
    .limit(1)
  return Boolean(row)
}

/** PD-1655 `_public_comment_content`: keep the content keys only; actor, access and parent stay server-controlled. */
export function publicCommentContent<T extends Record<string, unknown>>(data: T) {
  const content: Record<string, unknown> = {}
  for (const key of ['comment_html', 'comment_json', 'text'] as const) if (key in data) content[key] = data[key]
  return content as Pick<T, Extract<keyof T, 'comment_html' | 'comment_json' | 'text'>>
}

/**
 * `ProjectPublicMember.get_or_create` for a visitor who is not an active project member. Runs after a statement of the
 * same D1 batch and only when that statement changed one row.
 */
export function publicMemberStatement(db: LancityDb, actor: Actor, board: PublicBoard) {
  return db
    .insert(projectPublicMembers)
    .select(
      sql`select null, ${nowMs}, ${nowMs}, ${actor.userId}, ${actor.userId}, ${actor.userId}, ${board.projectId}, ${board.workspaceId}, null
      where changes() = 1 and not exists (select 1 from project_members where project_id = ${board.projectId}
        and workspace_id = ${board.workspaceId} and member_id = ${actor.userId} and is_active = 1 and deleted_at is null)`
    )
    .onConflictDoNothing()
}

/** Write the legacy asynchronous activity payload immediately after its mutation. */
export function publicActivityStatement(db: LancityDb, key: string, job: IssueActivityJob, payload?: SQL) {
  return outboxStatement(db, key, 'issue.activity', payload ?? { epoch: Math.floor(Date.now() / 1000), ...job }, sql`changes() = 1`)
}
