import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { user } from '@/db/schema/auth'
import { descriptions } from '@/db/schema/content'
import { commentReactions, issueComments } from '@/db/schema/issue'
import { parseInput } from '@/server/api/v1/validation'
import { ServiceError } from '@/server/common/errors'
import { escapeHtml, sanitizeHtml, stripTags } from '@/server/issue/comment-html'
import { adminGuard, collabIssue, issueGuard, lastInsertId, nowMs, runBatch } from '@/server/issue/collab-access'
import { issueEventStatement, issueEventBody, publishIssueEvent } from '@/server/issue/events'
import { commentActivityStatement, activityStatement } from '@/server/issue/jobs/history'
import { diffMentions, extractMentions } from '@/server/issue/mention'
import { requireProjectAccess } from '@/server/project/permissions'
import { subscribeActorAndMentions } from '@/server/issue/subscriber'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import {
  createRichCommentSchema,
  reactionInputSchema,
  updateRichCommentSchema,
  type CreateRichCommentInput,
  type ReactionInput,
  type UpdateRichCommentInput
} from '@/types/issue/collab-schema'

const actorDetail = { id: user.id, name: user.name, username: user.username, image: user.image }

async function loadComments(db: LancityDb, filter: ReturnType<typeof and>) {
  const rows = await db
    .select({ comment: issueComments, actorDetail })
    .from(issueComments)
    .leftJoin(user, eq(user.id, issueComments.actorId))
    .where(filter)
    .orderBy(issueComments.createdAt, issueComments.id)
  if (!rows.length) return []
  const reactions = await db
    .select({ reaction: commentReactions, displayName: user.name })
    .from(commentReactions)
    .leftJoin(user, eq(user.id, commentReactions.actorId))
    .where(
      and(
        inArray(
          commentReactions.commentId,
          rows.map(row => row.comment.id)
        ),
        isNull(commentReactions.deletedAt)
      )
    )
    .orderBy(desc(commentReactions.createdAt))
  return rows.map(row => ({
    ...row.comment,
    actorDetail: row.actorDetail,
    isMember: true,
    commentReactions: reactions
      .filter(item => item.reaction.commentId === row.comment.id)
      .map(item => ({ ...item.reaction, displayName: item.displayName }))
  }))
}

/** `IssueCommentViewSet.list` and `IssueCommentListCreateAPIEndpoint.get`. */
export async function listIssueComments(db: LancityDb, actor: Actor, slug: string, projectId: number, issueId: number) {
  await collabIssue(db, actor, slug, projectId, issueId, { includeArchived: true })
  return loadComments(
    db,
    and(eq(issueComments.issueId, issueId), eq(issueComments.projectId, projectId), isNull(issueComments.deletedAt))
  )
}

/** `IssueCommentViewSet.retrieve` and `IssueCommentDetailAPIEndpoint.get`. */
export async function getIssueComment(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  commentId: number
) {
  await collabIssue(db, actor, slug, projectId, issueId, { includeArchived: true })
  const [comment] = await loadComments(
    db,
    and(
      eq(issueComments.id, commentId),
      eq(issueComments.issueId, issueId),
      eq(issueComments.projectId, projectId),
      isNull(issueComments.deletedAt)
    )
  )
  if (!comment) throw new ServiceError(404, 'COMMENT_NOT_FOUND', 'Comment not found')
  return comment
}

function commentBody(input: { text?: string; comment_html?: string }) {
  const html =
    input.comment_html !== undefined ? sanitizeHtml(input.comment_html) : `<p>${escapeHtml(input.text ?? '')}</p>`
  // IssueComment.save: comment_stripped is always derived from the HTML.
  return { html, stripped: html === '' ? '' : stripTags(html) }
}

/** `IssueCommentViewSet.create` and `IssueCommentListCreateAPIEndpoint.post`. */
export async function createIssueComment(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  raw: CreateRichCommentInput
) {
  const input = parseInput(createRichCommentSchema, raw)
  const { issue } = await collabIssue(db, actor, slug, projectId, issueId, { write: true })
  if (input.external_id && input.external_source) {
    const [existing] = await db
      .select({ id: issueComments.id })
      .from(issueComments)
      .where(
        and(
          eq(issueComments.projectId, projectId),
          eq(issueComments.externalSource, input.external_source),
          eq(issueComments.externalId, input.external_id),
          isNull(issueComments.deletedAt)
        )
      )
      .limit(1)
    if (existing)
      throw new ServiceError(
        409,
        'COMMENT_EXTERNAL_CONFLICT',
        'Work item comment with the same external id and external source already exists',
        { id: existing.id }
      )
  }
  const { html, stripped } = commentBody(input)
  const json = JSON.stringify(input.comment_json ?? {})
  const guard = issueGuard(actor, slug, projectId, issueId)
  // Same atomic unit as Plane's `IssueComment.save`: description row, comment row, then the activity.
  const mutationId = crypto.randomUUID()
  const event = {
    type: 'comment.activity.created',
    issueId,
    projectId,
    actorId: actor.userId,
    requestedData: { id: 0, comment_html: html },
    currentInstance: null
  }
  const results = await runBatch(db, [
    db.insert(descriptions).select(
      sql`select null, ${nowMs}, ${nowMs}, ${actor.userId}, ${actor.userId}, null, ${json}, ${html}, null, ${stripped}, project_id, workspace_id
      from issues where id = ${issueId} and project_id = ${projectId} and ${guard}`
    ),
    db
      .insert(issueComments)
      .select(
        sql`select null, ${nowMs}, ${nowMs}, ${actor.userId}, ${actor.userId}, '[]', id, project_id, workspace_id, ${actor.userId},
        ${stripped}, ${html}, ${json}, ${input.access ?? 'INTERNAL'}, ${input.external_id ?? null}, ${input.external_source ?? null}, null, null, last_insert_rowid(), null
        from issues where id = ${issueId} and project_id = ${projectId} and changes() = 1`
      )
      .returning(),
    commentActivityStatement(
      db,
      sql<number>`last_insert_rowid()`,
      issueId,
      projectId,
      actor.userId,
      'created',
      null,
      html,
      mutationId
    ),
    issueEventStatement(db, mutationId, event, sql`json_set(${JSON.stringify(issueEventBody(event, mutationId))}, '$.requestedData.id', (select issue_comment_id from issue_activities where mutation_id = ${mutationId} limit 1))`)
  ])
  const [created] = results[1] as (typeof issueComments.$inferSelect)[]
  if (!created) {
    await collabIssue(db, actor, slug, projectId, issueId, { write: true })
    throw new ServiceError(409, 'COMMENT_CONFLICT', 'Issue or permissions changed; reload and try again')
  }
  await followIssue(db, { issueId, projectId, workspaceId: issue.workspaceId }, actor.userId, extractMentions(html))
  // Plane `issue_activity.delay(type="comment.activity.created", notification=True)`. The activity row is already stored.
  await publishIssueEvent(db, mutationId)
  return created
}

/** Mentioned users and the commenter subscribe to the issue. A failure never blocks the comment. */
async function followIssue(
  db: LancityDb,
  scope: { issueId: number; projectId: number; workspaceId: number },
  actorId: number,
  mentions: number[]
) {
  try {
    await subscribeActorAndMentions(db, scope, actorId, mentions)
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        label: 'issue comment subscribers',
        message: error instanceof Error ? error.message : String(error)
      })
    )
  }
}

async function ownedComment(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  commentId: number
) {
  const ctx = await collabIssue(db, actor, slug, projectId, issueId, { write: true })
  const [comment] = await db
    .select()
    .from(issueComments)
    .where(
      and(
        eq(issueComments.id, commentId),
        eq(issueComments.issueId, issueId),
        eq(issueComments.projectId, projectId),
        isNull(issueComments.deletedAt)
      )
    )
    .limit(1)
  if (!comment) throw new ServiceError(404, 'COMMENT_NOT_FOUND', 'Comment not found')
  // allow_permission(ADMIN, creator=True)
  if (comment.createdById !== actor.userId && !ctx.isAdmin)
    throw new ServiceError(403, 'FORBIDDEN', 'You are not allowed to modify this comment')
  return { ctx, comment }
}

/** `IssueCommentViewSet.partial_update` and `IssueCommentDetailAPIEndpoint.patch`. */
export async function updateIssueComment(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  commentId: number,
  raw: UpdateRichCommentInput
) {
  const input = parseInput(updateRichCommentSchema, raw)
  const { ctx, comment } = await ownedComment(db, actor, slug, projectId, issueId, commentId)
  const body = input.comment_html !== undefined || input.text !== undefined ? commentBody(input) : null
  const htmlChanged = body !== null && body.html !== comment.commentHtml
  const json = input.comment_json === undefined ? undefined : input.comment_json
  const changed =
    htmlChanged ||
    (json !== undefined && JSON.stringify(json) !== JSON.stringify(comment.commentJson)) ||
    (input.access !== undefined && input.access !== comment.access)
  if (!changed) return comment
  const stamp = new Date(Math.max(Date.now(), comment.updatedAt.getTime() + 1))
  const guard = and(
    eq(issueComments.id, commentId),
    eq(issueComments.issueId, issueId),
    eq(issueComments.projectId, projectId),
    isNull(issueComments.deletedAt),
    eq(issueComments.updatedAt, comment.updatedAt),
    issueGuard(actor, slug, projectId, issueId),
    sql`(${issueComments.createdById} = ${actor.userId} or ${adminGuard(actor, slug, projectId)})`
  )
  const descriptionId = comment.descriptionId
  const mutationId = crypto.randomUUID()
  const event = {
      type: 'comment.activity.updated',
      issueId,
      projectId,
      actorId: actor.userId,
      requestedData: { comment_html: body?.html },
      currentInstance: { id: commentId, comment_html: comment.commentHtml }
  }
  const statements = [
    db
      .update(issueComments)
      .set({
        ...(body ? { commentHtml: body.html, commentStripped: body.stripped } : {}),
        ...(json === undefined ? {} : { commentJson: json as never }),
        ...(input.access ? { access: input.access } : {}),
        ...(htmlChanged ? { editedAt: stamp } : {}),
        updatedById: actor.userId,
        updatedAt: stamp
      })
      .where(guard)
      .returning(),
    // The description row follows the comment (`IssueComment.save` field mapping). Activity needs the preceding statement to change one row.
    ...(descriptionId
      ? [
          db
            .update(descriptions)
            .set({
              ...(body ? { descriptionHtml: body.html, descriptionStripped: body.stripped } : {}),
              ...(json === undefined ? {} : { descriptionJson: json as never }),
              updatedById: actor.userId,
              updatedAt: stamp
            })
            .where(
              and(
                eq(descriptions.id, descriptionId),
                sql`exists (select 1 from issue_comments c where c.id = ${commentId} and c.updated_at = ${stamp.getTime()})`
              )
            )
        ]
      : []),
    ...(htmlChanged && body
      ? [
          commentActivityStatement(
            db,
            commentId,
            issueId,
            projectId,
            actor.userId,
            'updated',
            comment.commentHtml,
            body.html,
            mutationId
          ),
          issueEventStatement(db, mutationId, event)
        ]
      : [])
  ]
  const results = await runBatch(db, statements)
  const [updated] = results[0] as (typeof issueComments.$inferSelect)[]
  if (!updated) throw new ServiceError(409, 'COMMENT_CONFLICT', 'Comment or permissions changed; reload and try again')
  if (htmlChanged && body) {
    const { added } = diffMentions(body.html, comment.commentHtml)
    await followIssue(db, { issueId, projectId, workspaceId: ctx.issue.workspaceId }, actor.userId, added)
    await publishIssueEvent(db, mutationId)
  }
  return updated
}

/** `IssueCommentViewSet.destroy` and `IssueCommentDetailAPIEndpoint.delete`. */
export async function deleteIssueComment(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  commentId: number
) {
  const { comment } = await ownedComment(db, actor, slug, projectId, issueId, commentId)
  const deletedAt = new Date()
  const mutationId = crypto.randomUUID()
  const event = {
    type: 'comment.activity.deleted',
    issueId,
    projectId,
    actorId: actor.userId,
    requestedData: { comment_id: String(commentId) },
    currentInstance: { id: commentId, comment_html: comment.commentHtml }
  }
  const results = await runBatch(db, [
    db
      .update(issueComments)
      .set({
        deletedAt,
        updatedById: actor.userId,
        updatedAt: new Date(Math.max(Date.now(), comment.updatedAt.getTime() + 1))
      })
      .where(
        and(
          eq(issueComments.id, commentId),
          eq(issueComments.issueId, issueId),
          eq(issueComments.projectId, projectId),
          isNull(issueComments.deletedAt),
          eq(issueComments.updatedAt, comment.updatedAt),
          issueGuard(actor, slug, projectId, issueId),
          sql`(${issueComments.createdById} = ${actor.userId} or ${adminGuard(actor, slug, projectId)})`
        )
      )
      .returning({ id: issueComments.id }),
    commentActivityStatement(db, commentId, issueId, projectId, actor.userId, 'deleted', null, null, mutationId),
    issueEventStatement(db, mutationId, event),
    db
      .update(commentReactions)
      .set({ deletedAt, updatedById: actor.userId })
      .where(and(eq(commentReactions.commentId, commentId), isNull(commentReactions.deletedAt))),
    ...(comment.descriptionId
      ? [
          db
            .update(descriptions)
            .set({ deletedAt, updatedById: actor.userId })
            .where(eq(descriptions.id, comment.descriptionId))
        ]
      : [])
  ])
  if (!results[0].length)
    throw new ServiceError(409, 'COMMENT_CONFLICT', 'Comment or permissions changed; reload and try again')
  await publishIssueEvent(db, mutationId)
}

/** `_comment_issue_hidden_from_guest` plus the URL binding of the comment to workspace and project. */
async function reactionContext(db: LancityDb, actor: Actor, slug: string, projectId: number, commentId: number) {
  const [comment] = await db
    .select()
    .from(issueComments)
    .where(
      and(eq(issueComments.id, commentId), eq(issueComments.projectId, projectId), isNull(issueComments.deletedAt))
    )
    .limit(1)
  if (!comment) {
    // Surface project access errors first so non-members learn nothing about comment ids.
    await requireProjectAccess(db, actor, slug, projectId, 5)
    throw new ServiceError(404, 'COMMENT_NOT_FOUND', 'Comment not found')
  }
  const ctx = await collabIssue(db, actor, slug, projectId, comment.issueId, { includeArchived: true })
  return { comment, ctx }
}

/** `CommentReactionViewSet.list`. */
export async function listCommentReactions(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  commentId: number
) {
  await reactionContext(db, actor, slug, projectId, commentId)
  const rows = await db
    .select({ reaction: commentReactions, displayName: user.name })
    .from(commentReactions)
    .leftJoin(user, eq(user.id, commentReactions.actorId))
    .where(
      and(
        eq(commentReactions.commentId, commentId),
        eq(commentReactions.projectId, projectId),
        isNull(commentReactions.deletedAt)
      )
    )
    .orderBy(desc(commentReactions.createdAt), desc(commentReactions.id))
  return rows.map(row => ({ ...row.reaction, displayName: row.displayName }))
}

/** `CommentReactionViewSet.create`. */
export async function createCommentReaction(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  commentId: number,
  raw: ReactionInput
) {
  const input = parseInput(reactionInputSchema, raw)
  const { comment } = await reactionContext(db, actor, slug, projectId, commentId)
  const exists = () => new ServiceError(400, 'REACTION_EXISTS', 'Reaction already exists for the user')
  const [duplicate] = await db
    .select({ id: commentReactions.id })
    .from(commentReactions)
    .where(
      and(
        eq(commentReactions.commentId, commentId),
        eq(commentReactions.actorId, actor.userId),
        eq(commentReactions.reaction, input.reaction),
        isNull(commentReactions.deletedAt)
      )
    )
    .limit(1)
  if (duplicate) throw exists()
  const mutationId = crypto.randomUUID()
  const event = {
    type: 'comment_reaction.activity.created',
    issueId: comment.issueId,
    projectId,
    actorId: actor.userId,
    requestedData: { reaction: input.reaction },
    currentInstance: null,
    webhook: false
  }
  const results = await runBatch(db, [
    db
      .insert(commentReactions)
      .select(
        sql`select null, ${nowMs}, ${nowMs}, ${actor.userId}, ${actor.userId}, ${input.reaction}, ${actor.userId}, c.id, c.project_id, c.workspace_id, null
        from issue_comments c where c.id = ${commentId} and c.project_id = ${projectId} and c.deleted_at is null
          and ${issueGuard(actor, slug, projectId, comment.issueId, true)}
          and not exists (select 1 from comment_reactions r where r.comment_id = c.id and r.actor_id = ${actor.userId} and r.reaction = ${input.reaction} and r.deleted_at is null)`
      )
      .onConflictDoNothing()
      .returning(),
    activityStatement(
      db,
      comment.issueId,
      projectId,
      actor.userId,
      'created',
      'reaction',
      null,
      input.reaction,
      'added the reaction',
      null,
      lastInsertId,
      false,
      mutationId
    ),
    issueEventStatement(db, mutationId, event)
  ])
  const [created] = results[0] as (typeof commentReactions.$inferSelect)[]
  if (!created) {
    await reactionContext(db, actor, slug, projectId, commentId)
    throw exists()
  }
  await publishIssueEvent(db, mutationId)
  return created
}

/** `CommentReactionViewSet.destroy` (keyed by reaction code, scoped to the acting user). */
export async function deleteCommentReaction(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  commentId: number,
  reactionCode: string
) {
  const { comment } = await reactionContext(db, actor, slug, projectId, commentId)
  const [existing] = await db
    .select({ id: commentReactions.id })
    .from(commentReactions)
    .where(
      and(
        eq(commentReactions.commentId, commentId),
        eq(commentReactions.actorId, actor.userId),
        eq(commentReactions.reaction, reactionCode),
        isNull(commentReactions.deletedAt)
      )
    )
    .limit(1)
  if (!existing) throw new ServiceError(404, 'REACTION_NOT_FOUND', 'Reaction not found')
  const mutationId = crypto.randomUUID()
  const event = {
    type: 'comment_reaction.activity.deleted',
    issueId: comment.issueId,
    projectId,
    actorId: actor.userId,
    requestedData: null,
    currentInstance: { reaction: reactionCode, identifier: String(existing.id), comment_id: String(commentId) },
    webhook: false
  }
  const results = await runBatch(db, [
    db
      .update(commentReactions)
      .set({ deletedAt: new Date(), updatedById: actor.userId })
      .where(
        and(
          eq(commentReactions.id, existing.id),
          isNull(commentReactions.deletedAt),
          issueGuard(actor, slug, projectId, comment.issueId, true)
        )
      )
      .returning({ id: commentReactions.id }),
    activityStatement(
      db,
      comment.issueId,
      projectId,
      actor.userId,
      'deleted',
      'reaction',
      reactionCode,
      null,
      'removed the reaction',
      existing.id,
      null,
      false,
      mutationId
    ),
    issueEventStatement(db, mutationId, event)
  ])
  if (!results[0].length) throw new ServiceError(409, 'REACTION_CONFLICT', 'Reaction or permissions changed')
  await publishIssueEvent(db, mutationId)
}
