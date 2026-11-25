import { and, asc, eq, exists, isNull, sql } from 'drizzle-orm'
import { projectPublicMembers } from '@/db/schema/content'
import { issueComments, issues } from '@/db/schema/issue'
import { ServiceError } from '@/server/common/errors'
import { commentActivityStatement } from '@/server/issue/jobs/history'
import { textToPageHtml } from '@/server/page/service'
import { getPublicIssue, visibleIssues } from '@/server/public/service'
import type { Actor } from '@/types/auth/schema'
import type { JsonValue, LancityDb } from '@/types/database/schema'
import type { CreateCommentInput } from '@/types/issue/schema'

const publicFields = {
  id: issueComments.id,
  actor: issueComments.actorId,
  comment_stripped: issueComments.commentStripped,
  created_at: issueComments.createdAt,
  edited_at: issueComments.editedAt
}

function publicCommentsScope(db: LancityDb, anchor: string, issueId: number) {
  return and(
    eq(issueComments.issueId, issueId),
    eq(issueComments.access, 'EXTERNAL'),
    isNull(issueComments.deletedAt),
    exists(
      db
        .select({ id: issues.id })
        .from(issues)
        .where(
          and(
            eq(issues.id, issueComments.issueId),
            eq(issues.projectId, issueComments.projectId),
            eq(issues.workspaceId, issueComments.workspaceId),
            visibleIssues(db, anchor, true)
          )
        )
    )
  )
}

async function requirePublicCommentIssue(db: LancityDb, anchor: string, issueId: number) {
  const [issue] = await db
    .select({ projectId: issues.projectId, workspaceId: issues.workspaceId })
    .from(issues)
    .where(and(eq(issues.id, issueId), visibleIssues(db, anchor, true)))
    .limit(1)
  if (issue) return issue
  await getPublicIssue(db, anchor, issueId)
  throw new ServiceError(400, 'COMMENTS_DISABLED', 'Comments are disabled for this board')
}

export async function listPublicComments(db: LancityDb, anchor: string, issueId: number) {
  await getPublicIssue(db, anchor, issueId)
  return db
    .select(publicFields)
    .from(issueComments)
    .where(publicCommentsScope(db, anchor, issueId))
    .orderBy(asc(issueComments.createdAt), asc(issueComments.id))
    .limit(100)
}

export async function getPublicComment(db: LancityDb, anchor: string, issueId: number, commentId: number) {
  const [comment] = await db
    .select(publicFields)
    .from(issueComments)
    .where(and(eq(issueComments.id, commentId), publicCommentsScope(db, anchor, issueId)))
    .limit(1)
  if (!comment) throw new ServiceError(404, 'COMMENT_NOT_FOUND', 'Comment not found on this board')
  return comment
}

/** Sanitized rich content of a public comment (PD-1655). Without it the plain `text` is wrapped in a paragraph. */
export type PublicCommentContent = { html: string; json?: Record<string, unknown> }

export async function createPublicComment(
  db: LancityDb,
  actor: Actor,
  anchor: string,
  issueId: number,
  input: CreateCommentInput,
  content?: PublicCommentContent
) {
  const issue = await requirePublicCommentIssue(db, anchor, issueId)
  const html = content?.html ?? textToPageHtml(input.text)
  const json = JSON.stringify(content?.json ?? {})
  const [created] = await db.batch([
    db
      .insert(issueComments)
      .select(
        sql`select null, cast(unixepoch('subsec') * 1000 as integer),
      cast(unixepoch('subsec') * 1000 as integer), ${actor.userId}, ${actor.userId},
      '[]', id, project_id, workspace_id, ${actor.userId}, ${input.text}, ${html}, ${json}, 'EXTERNAL',
      null, null, null, null, null, null from issues
      where id = ${issueId} and ${visibleIssues(db, anchor, true)}`
      )
      .returning(publicFields),
    commentActivityStatement(
      db,
      sql<number>`last_insert_rowid()`,
      issueId,
      issue.projectId,
      actor.userId,
      'created',
      null,
      html
    ),
    db
      .insert(projectPublicMembers)
      .select(
        sql`select null, cast(unixepoch('subsec') * 1000 as integer),
      cast(unixepoch('subsec') * 1000 as integer), ${actor.userId}, ${actor.userId}, ${actor.userId}, ${issue.projectId}, ${issue.workspaceId}, null
      where changes() = 1 and not exists (select 1 from project_members where project_id = ${issue.projectId}
        and workspace_id = ${issue.workspaceId} and member_id = ${actor.userId} and is_active = 1 and deleted_at is null)`
      )
      .onConflictDoNothing()
  ])
  if (created[0]) return created[0]
  await requirePublicCommentIssue(db, anchor, issueId)
  throw new ServiceError(409, 'COMMENT_CONFLICT', 'Issue visibility changed')
}

export async function changePublicComment(
  db: LancityDb,
  actor: Actor,
  anchor: string,
  issueId: number,
  commentId: number,
  input: CreateCommentInput | null,
  content?: PublicCommentContent
) {
  const issue = await requirePublicCommentIssue(db, anchor, issueId)
  const scope = and(
    eq(issueComments.id, commentId),
    eq(issueComments.actorId, actor.userId),
    publicCommentsScope(db, anchor, issueId)
  )
  const [previous] = await db
    .select({ updatedAt: issueComments.updatedAt, html: issueComments.commentHtml })
    .from(issueComments)
    .where(scope)
    .limit(1)
  if (!previous) throw new ServiceError(404, 'COMMENT_NOT_FOUND', 'Comment not found on this board')
  const now = new Date(Math.max(Date.now(), previous.updatedAt.getTime() + 1))
  const html = input ? (content?.html ?? textToPageHtml(input.text)) : null
  const [updated] = await db.batch([
    db
      .update(issueComments)
      .set({
        updatedAt: now,
        updatedById: actor.userId,
        ...(input && html
          ? {
              commentStripped: input.text,
              commentHtml: html,
              // Plane `partial=True`: `comment_json` is only written when the request sends it.
              ...(content?.json === undefined ? {} : { commentJson: content.json as JsonValue }),
              editedAt: now
            }
          : { deletedAt: now })
      })
      .where(and(scope, eq(issueComments.updatedAt, previous.updatedAt)))
      .returning(publicFields),
    commentActivityStatement(
      db,
      commentId,
      issueId,
      issue.projectId,
      actor.userId,
      input ? 'updated' : 'deleted',
      previous.html,
      html
    )
  ])
  if (!updated[0]) throw new ServiceError(409, 'COMMENT_CONFLICT', 'Comment or board visibility changed')
  return updated[0]
}
