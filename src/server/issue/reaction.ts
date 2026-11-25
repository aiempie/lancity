import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { user } from '@/db/schema/auth'
import { issueReactions } from '@/db/schema/issue'
import { parseInput } from '@/server/api/v1/validation'
import { ServiceError } from '@/server/common/errors'
import { collabIssue, issueGuard, lastInsertId, nowMs, runBatch } from '@/server/issue/collab-access'
import { issueEventStatement, publishIssueEvent } from '@/server/issue/events'
import { activityStatement } from '@/server/issue/jobs/history'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import { reactionInputSchema, type ReactionInput } from '@/types/issue/collab-schema'

/** `IssueReactionViewSet.list`. Restricted guests only see reactions on issues they created. */
export async function listIssueReactions(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number
) {
  await collabIssue(db, actor, slug, projectId, issueId, { includeArchived: true })
  const rows = await db
    .select({
      reaction: issueReactions,
      actorDetail: { id: user.id, name: user.name, username: user.username, image: user.image }
    })
    .from(issueReactions)
    .leftJoin(user, eq(user.id, issueReactions.actorId))
    .where(
      and(
        eq(issueReactions.issueId, issueId),
        eq(issueReactions.projectId, projectId),
        isNull(issueReactions.deletedAt)
      )
    )
    .orderBy(desc(issueReactions.createdAt), desc(issueReactions.id))
  return rows.map(row => ({ ...row.reaction, actorDetail: row.actorDetail }))
}

/** `IssueReactionViewSet.create`. The same user may add each reaction code once per issue. */
export async function createIssueReaction(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  raw: ReactionInput
) {
  const input = parseInput(reactionInputSchema, raw)
  await collabIssue(db, actor, slug, projectId, issueId, { includeArchived: true })
  const exists = () => new ServiceError(400, 'REACTION_EXISTS', 'Reaction already exists for the user')
  const mutationId = crypto.randomUUID()
  const results = await runBatch(db, [
    db
      .insert(issueReactions)
      .select(
        sql`select null, ${nowMs}, ${nowMs}, ${actor.userId}, ${actor.userId}, ${input.reaction}, ${actor.userId}, id, project_id, workspace_id, null
        from issues where id = ${issueId} and project_id = ${projectId} and ${issueGuard(actor, slug, projectId, issueId, true)}
          and not exists (select 1 from issue_reactions r where r.issue_id = ${issueId} and r.actor_id = ${actor.userId} and r.reaction = ${input.reaction} and r.deleted_at is null)`
      )
      .onConflictDoNothing()
      .returning(),
    activityStatement(
      db,
      issueId,
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
    issueEventStatement(db, mutationId, {
      type: 'issue_reaction.activity.created',
      issueId,
      projectId,
      actorId: actor.userId,
      requestedData: { reaction: input.reaction },
      currentInstance: null,
      webhook: false
    })
  ])
  const [created] = results[0] as (typeof issueReactions.$inferSelect)[]
  if (!created) {
    await collabIssue(db, actor, slug, projectId, issueId, { includeArchived: true })
    throw exists()
  }
  await publishIssueEvent(db, mutationId)
  return created
}

/** `IssueReactionViewSet.destroy`, keyed by reaction code and scoped to the acting user. */
export async function deleteIssueReaction(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  reactionCode: string
) {
  await collabIssue(db, actor, slug, projectId, issueId, { includeArchived: true })
  const [existing] = await db
    .select({ id: issueReactions.id })
    .from(issueReactions)
    .where(
      and(
        eq(issueReactions.issueId, issueId),
        eq(issueReactions.projectId, projectId),
        eq(issueReactions.actorId, actor.userId),
        eq(issueReactions.reaction, reactionCode),
        isNull(issueReactions.deletedAt)
      )
    )
    .limit(1)
  if (!existing) throw new ServiceError(404, 'REACTION_NOT_FOUND', 'Reaction not found')
  const mutationId = crypto.randomUUID()
  const results = await runBatch(db, [
    db
      .update(issueReactions)
      .set({ deletedAt: new Date(), updatedById: actor.userId })
      .where(
        and(
          eq(issueReactions.id, existing.id),
          isNull(issueReactions.deletedAt),
          issueGuard(actor, slug, projectId, issueId, true)
        )
      )
      .returning({ id: issueReactions.id }),
    activityStatement(
      db,
      issueId,
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
    issueEventStatement(db, mutationId, {
      type: 'issue_reaction.activity.deleted',
      issueId,
      projectId,
      actorId: actor.userId,
      requestedData: null,
      currentInstance: { reaction: reactionCode, identifier: String(existing.id) },
      webhook: false
    })
  ])
  if (!results[0].length) throw new ServiceError(409, 'REACTION_CONFLICT', 'Reaction or permissions changed')
  await publishIssueEvent(db, mutationId)
}
