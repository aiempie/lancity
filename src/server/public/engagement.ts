import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { commentReactions, issueComments, issueReactions, issueVotes } from '@/db/schema/issue'
import { parseInput } from '@/server/api/v1/validation'
import { ServiceError } from '@/server/common/errors'
import { publishOutbox } from '@/server/common/outbox'
import {
  commentOnBoard,
  publicActivityStatement,
  nowMs,
  publicMemberStatement,
  requireBoard,
  requireBoardFeature,
  requireIssueInBoard
} from '@/server/public/board'
import { visibleIssues } from '@/server/public/service'
import type { Actor } from '@/types/auth/schema'
import {
  publicReactionCodeSchema,
  publicReactionInputSchema,
  publicVoteInputSchema
} from '@/types/content/p3-public-schema'
import type { LancityDb } from '@/types/database/schema'

const reactionFields = {
  id: issueReactions.id,
  reaction: issueReactions.reaction,
  actor: issueReactions.actorId,
  issue: issueReactions.issueId,
  project: issueReactions.projectId,
  workspace: issueReactions.workspaceId,
  created_at: issueReactions.createdAt
}
const commentReactionFields = {
  id: commentReactions.id,
  reaction: commentReactions.reaction,
  actor: commentReactions.actorId,
  comment: commentReactions.commentId,
  project: commentReactions.projectId,
  workspace: commentReactions.workspaceId,
  created_at: commentReactions.createdAt
}
const voteFields = {
  id: issueVotes.id,
  vote: issueVotes.vote,
  actor: issueVotes.actorId,
  issue: issueVotes.issueId,
  project: issueVotes.projectId,
  workspace: issueVotes.workspaceId
}

// ------------------------------------------------------------------------------------------ issue reactions

/** PD-1667, PD-1668 `IssueReactionPublicViewSet.list`: empty when the board switched reactions off. */
export async function listPublicIssueReactions(db: LancityDb, anchor: string, issueId: number) {
  const board = await requireBoard(db, anchor)
  await requireIssueInBoard(db, board, issueId)
  if (!board.isReactionsEnabled) return []
  return db
    .select(reactionFields)
    .from(issueReactions)
    .where(
      and(
        eq(issueReactions.issueId, issueId),
        eq(issueReactions.projectId, board.projectId),
        eq(issueReactions.workspaceId, board.workspaceId),
        isNull(issueReactions.deletedAt)
      )
    )
    .orderBy(desc(issueReactions.createdAt), desc(issueReactions.id))
}

/** PD-1669 `IssueReactionPublicViewSet.create`. One user adds each reaction code once per issue. */
export async function createPublicIssueReaction(
  db: LancityDb,
  actor: Actor,
  anchor: string,
  issueId: number,
  raw: unknown
) {
  const board = await requireBoard(db, anchor)
  requireBoardFeature(board, 'reactions')
  const { reaction } = parseInput(publicReactionInputSchema, raw)
  await requireIssueInBoard(db, board, issueId)
  const eventKey = crypto.randomUUID()
  const [created] = await db.batch([
    db
      .insert(issueReactions)
      .select(
        sql`select null, ${nowMs}, ${nowMs}, ${actor.userId}, ${actor.userId}, ${reaction}, ${actor.userId}, id, project_id, workspace_id, null
        from issues where id = ${issueId} and ${visibleIssues(db, anchor)}
          and not exists (select 1 from issue_reactions r where r.issue_id = ${issueId} and r.actor_id = ${actor.userId}
            and r.reaction = ${reaction} and r.deleted_at is null)`
      )
      .onConflictDoNothing()
      .returning(reactionFields),
    publicActivityStatement(db, eventKey, {
    type: 'issue_reaction.activity.created',
    requestedData: { reaction },
    currentInstance: null,
    issueId,
    actorId: actor.userId,
    projectId: board.projectId
  }),
    publicMemberStatement(db, actor, board)
  ])
  if (!created[0]) {
    await requireIssueInBoard(db, await requireBoard(db, anchor), issueId)
    throw new ServiceError(400, 'REACTION_EXISTS', 'Reaction already exists for the user')
  }
  await publishOutbox(db, eventKey)
  return created[0]
}

/** PD-1670 `IssueReactionPublicViewSet.destroy`, keyed by the reaction code and limited to the caller's own reaction. */
export async function deletePublicIssueReaction(
  db: LancityDb,
  actor: Actor,
  anchor: string,
  issueId: number,
  reactionCode: string
) {
  const board = await requireBoard(db, anchor)
  requireBoardFeature(board, 'reactions')
  const reaction = parseInput(publicReactionCodeSchema, reactionCode)
  const [existing] = await db.select({ id: issueReactions.id }).from(issueReactions).where(and(
    eq(issueReactions.issueId, issueId), eq(issueReactions.projectId, board.projectId),
    eq(issueReactions.workspaceId, board.workspaceId), eq(issueReactions.reaction, reaction),
    eq(issueReactions.actorId, actor.userId), isNull(issueReactions.deletedAt)
  )).limit(1)
  if (!existing) throw new ServiceError(404, 'REACTION_NOT_FOUND', 'The required object does not exist.')
  const eventKey = crypto.randomUUID()
  const [removed] = await db.batch([
    db.update(issueReactions).set({ deletedAt: new Date(), updatedById: actor.userId })
      .where(and(eq(issueReactions.id, existing.id), isNull(issueReactions.deletedAt))).returning({ id: issueReactions.id }),
    publicActivityStatement(db, eventKey, { type: 'issue_reaction.activity.deleted', requestedData: null,
      currentInstance: { reaction, identifier: String(existing.id) }, issueId, actorId: actor.userId, projectId: board.projectId })
  ])
  if (!removed[0]) throw new ServiceError(404, 'REACTION_NOT_FOUND', 'The required object does not exist.')
  await publishOutbox(db, eventKey)
}

// ----------------------------------------------------------------------------------------- comment reactions

/** PD-1671, PD-1672 `CommentReactionPublicViewSet.list`: only reactions on public (EXTERNAL) comments are visible. */
export async function listPublicCommentReactions(db: LancityDb, anchor: string, commentId: number) {
  const board = await requireBoard(db, anchor)
  if (!board.isReactionsEnabled) return []
  const rows = await db
    .select(commentReactionFields)
    .from(commentReactions)
    .innerJoin(
      issueComments,
      and(eq(issueComments.id, commentReactions.commentId), commentOnBoard(db, board, commentId))
    )
    .where(and(eq(commentReactions.commentId, commentId), isNull(commentReactions.deletedAt)))
    .orderBy(desc(commentReactions.createdAt), desc(commentReactions.id))
  return rows
}

/** PD-1673 `CommentReactionPublicViewSet.create`. The comment must be a public comment visible on the board. */
export async function createPublicCommentReaction(
  db: LancityDb,
  actor: Actor,
  anchor: string,
  commentId: number,
  raw: unknown
) {
  const board = await requireBoard(db, anchor)
  requireBoardFeature(board, 'reactions')
  const { reaction } = parseInput(publicReactionInputSchema, raw)
  const eventKey = crypto.randomUUID()
  const [created] = await db.batch([
    db
      .insert(commentReactions)
      .select(
        sql`select null, ${nowMs}, ${nowMs}, ${actor.userId}, ${actor.userId}, ${reaction}, ${actor.userId}, c.id, c.project_id, c.workspace_id, null
        from issue_comments c where c.id = ${commentId} and c.project_id = ${board.projectId} and c.workspace_id = ${board.workspaceId}
          and c.access = 'EXTERNAL' and c.deleted_at is null
          and exists (select 1 from issues where issues.id = c.issue_id and ${visibleIssues(db, anchor)})
          and not exists (select 1 from comment_reactions r where r.comment_id = c.id and r.actor_id = ${actor.userId}
            and r.reaction = ${reaction} and r.deleted_at is null)`
      )
      .onConflictDoNothing()
      .returning(commentReactionFields),
    publicActivityStatement(db, eventKey, {
    type: 'comment_reaction.activity.created',
    requestedData: { reaction },
    currentInstance: null,
    issueId: null,
    actorId: actor.userId,
    projectId: board.projectId
  }),
    publicMemberStatement(db, actor, board)
  ])
  if (!created[0]) {
    const [comment] = await db
      .select({ id: issueComments.id })
      .from(issueComments)
      .where(commentOnBoard(db, board, commentId))
      .limit(1)
    if (!comment) throw new ServiceError(404, 'COMMENT_NOT_FOUND', 'Comment not found')
    throw new ServiceError(400, 'REACTION_EXISTS', 'Reaction already exists for the user')
  }
  await publishOutbox(db, eventKey)
  return created[0]
}

/** PD-1674 `CommentReactionPublicViewSet.destroy`. */
export async function deletePublicCommentReaction(
  db: LancityDb,
  actor: Actor,
  anchor: string,
  commentId: number,
  reactionCode: string
) {
  const board = await requireBoard(db, anchor)
  requireBoardFeature(board, 'reactions')
  const reaction = parseInput(publicReactionCodeSchema, reactionCode)
  const [existing] = await db
    .select({ id: commentReactions.id })
    .from(commentReactions)
    .innerJoin(issueComments, eq(issueComments.id, commentReactions.commentId))
    .where(
      and(
        commentOnBoard(db, board, commentId),
        eq(commentReactions.commentId, commentId),
        eq(commentReactions.reaction, reaction),
        eq(commentReactions.actorId, actor.userId),
        isNull(commentReactions.deletedAt)
      )
    )
    .limit(1)
  if (!existing) throw new ServiceError(404, 'REACTION_NOT_FOUND', 'The required object does not exist.')
  const eventKey = crypto.randomUUID()
  const [removed] = await db.batch([
    db.update(commentReactions).set({ deletedAt: new Date(), updatedById: actor.userId })
      .where(and(eq(commentReactions.id, existing.id), isNull(commentReactions.deletedAt))).returning({ id: commentReactions.id }),
    publicActivityStatement(db, eventKey, { type: 'comment_reaction.activity.deleted', requestedData: null,
      currentInstance: { reaction, identifier: String(existing.id), comment_id: String(commentId) },
      issueId: null, actorId: actor.userId, projectId: board.projectId })
  ])
  if (!removed[0]) throw new ServiceError(404, 'REACTION_NOT_FOUND', 'The required object does not exist.')
  await publishOutbox(db, eventKey)
}

// ------------------------------------------------------------------------------------------------- votes

/** PD-1675, PD-1676 `IssueVotePublicViewSet.list`: empty when the board switched votes off. */
export async function listPublicIssueVotes(db: LancityDb, anchor: string, issueId: number) {
  const board = await requireBoard(db, anchor)
  await requireIssueInBoard(db, board, issueId)
  if (!board.isVotesEnabled) return []
  return db
    .select(voteFields)
    .from(issueVotes)
    .where(
      and(
        eq(issueVotes.issueId, issueId),
        eq(issueVotes.projectId, board.projectId),
        eq(issueVotes.workspaceId, board.workspaceId),
        isNull(issueVotes.deletedAt)
      )
    )
    .orderBy(desc(issueVotes.id))
}

/** PD-1677 `IssueVotePublicViewSet.create`: one live vote per user and issue; a second call switches it. */
export async function createPublicIssueVote(
  db: LancityDb,
  actor: Actor,
  anchor: string,
  issueId: number,
  raw: unknown
) {
  const board = await requireBoard(db, anchor)
  requireBoardFeature(board, 'votes')
  const { vote } = parseInput(publicVoteInputSchema, raw ?? {})
  await requireIssueInBoard(db, board, issueId)
  const [current] = await db
    .select({ id: issueVotes.id })
    .from(issueVotes)
    .where(and(eq(issueVotes.issueId, issueId), eq(issueVotes.actorId, actor.userId), isNull(issueVotes.deletedAt)))
    .limit(1)
  const write = current
    ? db
        .update(issueVotes)
        .set({ vote, updatedById: actor.userId })
        .where(and(eq(issueVotes.id, current.id), isNull(issueVotes.deletedAt)))
        .returning(voteFields)
    : db
        .insert(issueVotes)
        .select(
          sql`select null, ${nowMs}, ${nowMs}, ${actor.userId}, ${actor.userId}, ${vote}, ${actor.userId}, id, project_id, workspace_id, null
          from issues where id = ${issueId} and ${visibleIssues(db, anchor)}
            and not exists (select 1 from issue_votes v where v.issue_id = ${issueId} and v.actor_id = ${actor.userId} and v.deleted_at is null)`
        )
        .onConflictDoNothing()
        .returning(voteFields)
  const eventKey = crypto.randomUUID()
  const [written] = await db.batch([write, publicActivityStatement(db, eventKey, {
    type: 'issue_vote.activity.created',
    requestedData: { vote },
    currentInstance: null,
    issueId,
    actorId: actor.userId,
    projectId: board.projectId
  }), publicMemberStatement(db, actor, board)])
  if (!written[0]) {
    await requireIssueInBoard(db, await requireBoard(db, anchor), issueId)
    throw new ServiceError(409, 'VOTE_CONFLICT', 'Vote changed; reload and try again')
  }
  await publishOutbox(db, eventKey)
  return written[0]
}

/** PD-1678 `IssueVotePublicViewSet.destroy`: withdraw the caller's vote. */
export async function deletePublicIssueVote(db: LancityDb, actor: Actor, anchor: string, issueId: number) {
  const board = await requireBoard(db, anchor)
  const [existing] = await db.select({ id: issueVotes.id, vote: issueVotes.vote }).from(issueVotes).where(and(
    eq(issueVotes.issueId, issueId), eq(issueVotes.actorId, actor.userId), eq(issueVotes.projectId, board.projectId),
    eq(issueVotes.workspaceId, board.workspaceId), isNull(issueVotes.deletedAt)
  )).limit(1)
  if (!existing) throw new ServiceError(404, 'VOTE_NOT_FOUND', 'The required object does not exist.')
  const eventKey = crypto.randomUUID()
  const [removed] = await db.batch([
    db.update(issueVotes).set({ deletedAt: new Date(), updatedById: actor.userId })
      .where(and(eq(issueVotes.id, existing.id), eq(issueVotes.vote, existing.vote), isNull(issueVotes.deletedAt)))
      .returning({ id: issueVotes.id }),
    publicActivityStatement(db, eventKey, { type: 'issue_vote.activity.deleted', requestedData: null,
      currentInstance: { vote: String(existing.vote), identifier: String(existing.id) },
      issueId, actorId: actor.userId, projectId: board.projectId })
  ])
  if (!removed[0]) throw new ServiceError(404, 'VOTE_NOT_FOUND', 'The required object does not exist.')
  await publishOutbox(db, eventKey)
}
