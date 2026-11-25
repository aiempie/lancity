import { and, eq, isNull, sql } from 'drizzle-orm'
import { issueVotes } from '@/db/schema/issue'
import { parseInput } from '@/server/api/v1/validation'
import { ServiceError } from '@/server/common/errors'
import { collabIssue, issueGuard, nowMs, runBatch } from '@/server/issue/collab-access'
import { activityStatement } from '@/server/issue/jobs/history'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import { issueVoteInputSchema, type IssueVoteInput } from '@/types/issue/collab-schema'

async function liveVote(db: LancityDb, actor: Actor, projectId: number, issueId: number) {
  const [row] = await db
    .select({ id: issueVotes.id, vote: issueVotes.vote })
    .from(issueVotes)
    .where(
      and(
        eq(issueVotes.issueId, issueId),
        eq(issueVotes.projectId, projectId),
        eq(issueVotes.actorId, actor.userId),
        isNull(issueVotes.deletedAt)
      )
    )
    .limit(1)
  return row
}

/** Up and down vote totals plus the acting user's own vote (Plane `issue_votes`). */
export async function getIssueVotes(db: LancityDb, actor: Actor, slug: string, projectId: number, issueId: number) {
  await collabIssue(db, actor, slug, projectId, issueId, { includeArchived: true })
  const [row] = await db
    .select({
      up: sql<number>`coalesce(sum(case when ${issueVotes.vote} = 1 then 1 else 0 end), 0)`,
      down: sql<number>`coalesce(sum(case when ${issueVotes.vote} = -1 then 1 else 0 end), 0)`,
      mine: sql<number | null>`max(case when ${issueVotes.actorId} = ${actor.userId} then ${issueVotes.vote} end)`
    })
    .from(issueVotes)
    .where(and(eq(issueVotes.issueId, issueId), eq(issueVotes.projectId, projectId), isNull(issueVotes.deletedAt)))
  return { up: row.up, down: row.down, vote: row.mine ?? null }
}

/** Cast or switch a vote. One live vote per user and issue. Activity follows `create_issue_vote_activity`. */
export async function voteOnIssue(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  raw: IssueVoteInput
) {
  const { vote } = parseInput(issueVoteInputSchema, raw)
  await collabIssue(db, actor, slug, projectId, issueId, { write: true })
  const current = await liveVote(db, actor, projectId, issueId)
  if (current?.vote === vote) return getIssueVotes(db, actor, slug, projectId, issueId)
  const guard = issueGuard(actor, slug, projectId, issueId)
  const mutation = current
    ? db
        .update(issueVotes)
        .set({ vote, updatedById: actor.userId })
        .where(
          and(eq(issueVotes.id, current.id), isNull(issueVotes.deletedAt), eq(issueVotes.vote, current.vote), guard)
        )
        .returning({ id: issueVotes.id })
    : db
        .insert(issueVotes)
        .select(
          sql`select null, ${nowMs}, ${nowMs}, ${actor.userId}, ${actor.userId}, ${vote}, ${actor.userId}, id, project_id, workspace_id, null
          from issues where id = ${issueId} and project_id = ${projectId} and ${guard}
            and not exists (select 1 from issue_votes v where v.issue_id = ${issueId} and v.actor_id = ${actor.userId} and v.deleted_at is null)`
        )
        .onConflictDoNothing()
        .returning({ id: issueVotes.id })
  const results = await runBatch(db, [
    mutation,
    activityStatement(
      db,
      issueId,
      projectId,
      actor.userId,
      'updated',
      'vote',
      current ? String(current.vote) : null,
      String(vote),
      'added the vote'
    )
  ])
  if (!results[0].length) {
    await collabIssue(db, actor, slug, projectId, issueId, { write: true })
    throw new ServiceError(409, 'VOTE_CONFLICT', 'Vote or permissions changed; reload and try again')
  }
  return getIssueVotes(db, actor, slug, projectId, issueId)
}

/** Withdraw the acting user's vote. Activity follows `delete_issue_vote_activity`. */
export async function removeIssueVote(db: LancityDb, actor: Actor, slug: string, projectId: number, issueId: number) {
  await collabIssue(db, actor, slug, projectId, issueId, { write: true })
  const current = await liveVote(db, actor, projectId, issueId)
  if (!current) throw new ServiceError(404, 'VOTE_NOT_FOUND', 'Vote not found')
  const results = await runBatch(db, [
    db
      .update(issueVotes)
      .set({ deletedAt: new Date(), updatedById: actor.userId })
      .where(
        and(eq(issueVotes.id, current.id), isNull(issueVotes.deletedAt), issueGuard(actor, slug, projectId, issueId))
      )
      .returning({ id: issueVotes.id }),
    activityStatement(
      db,
      issueId,
      projectId,
      actor.userId,
      'deleted',
      'vote',
      String(current.vote),
      null,
      'removed the vote',
      current.id
    )
  ])
  if (!results[0].length)
    throw new ServiceError(409, 'VOTE_CONFLICT', 'Vote or permissions changed; reload and try again')
  return getIssueVotes(db, actor, slug, projectId, issueId)
}
