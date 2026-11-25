import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { user } from '@/db/schema/auth'
import { issueSubscribers } from '@/db/schema/issue'
import { projectMembers, workspaceMembers } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import { nowMs } from '@/server/issue/collab-access'
import { getIssue, writableProject } from '@/server/issue/service'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

function readableIssue(actor: Actor, slug: string, projectId: number, issueId: number) {
  return sql`exists (select 1 from issues i join projects p on p.id = i.project_id and p.workspace_id = i.workspace_id join workspaces w on w.id = p.workspace_id
    join workspace_members wm on wm.workspace_id = w.id and wm.member_id = ${actor.userId}
    join project_members pm on pm.project_id = p.id and pm.workspace_id = w.id and pm.member_id = ${actor.userId}
    where i.id = ${issueId} and p.id = ${projectId} and w.slug = ${slug} and i.deleted_at is null and i.archived_at is null and i.is_draft = 0
    and p.deleted_at is null and w.deleted_at is null and wm.is_active = 1 and wm.deleted_at is null and pm.is_active = 1 and pm.deleted_at is null
    and (wm.role = 20 or pm.role >= 15 or p.guest_view_all_features = 1 or i.created_by_id = ${actor.userId}))`
}
export async function listIssueSubscribers(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number
) {
  const issue = await getIssue(db, actor, slug, projectId, issueId)
  // Plane's list action returns the active project members, not subscription rows.
  return db
    .select({ id: projectMembers.id, memberId: user.id, name: user.name, role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(user, eq(user.id, projectMembers.memberId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.memberId, user.id),
        eq(workspaceMembers.workspaceId, issue.workspaceId),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt)
      )
    )
    .where(
      and(eq(projectMembers.projectId, projectId), eq(projectMembers.isActive, true), isNull(projectMembers.deletedAt))
    )
    .orderBy(desc(projectMembers.id))
}
export async function issueSubscriptionStatus(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number
) {
  await getIssue(db, actor, slug, projectId, issueId)
  const [row] = await db
    .select({ id: issueSubscribers.id })
    .from(issueSubscribers)
    .where(
      and(
        eq(issueSubscribers.issueId, issueId),
        eq(issueSubscribers.projectId, projectId),
        eq(issueSubscribers.subscriberId, actor.userId),
        isNull(issueSubscribers.deletedAt)
      )
    )
    .limit(1)
  return { subscribed: Boolean(row) }
}
export async function addIssueSubscriber(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  subscriberId: number
) {
  const self = actor.userId === subscriberId
  if (!self) await requireProjectAccess(db, actor, slug, projectId, 15)
  await getIssue(db, actor, slug, projectId, issueId)
  const [row] = await db
    .insert(issueSubscribers)
    .select(
      sql`select null, cast(unixepoch('subsec') * 1000 as integer), cast(unixepoch('subsec') * 1000 as integer), ${actor.userId}, ${actor.userId}, id, project_id, ${subscriberId}, workspace_id, null from issues where id = ${issueId} and project_id = ${projectId} and ${readableIssue(actor, slug, projectId, issueId)} and ${self ? sql`1` : writableProject(actor, slug, projectId)} and exists (select 1 from project_members pm join workspace_members wm on wm.workspace_id = pm.workspace_id and wm.member_id = pm.member_id where pm.project_id = ${projectId} and pm.member_id = ${subscriberId} and pm.is_active = 1 and pm.deleted_at is null and wm.is_active = 1 and wm.deleted_at is null) and not exists (select 1 from issue_subscribers s where s.issue_id = ${issueId} and s.subscriber_id = ${subscriberId} and s.deleted_at is null)`
    )
    .onConflictDoNothing()
    .returning()
  if (!row)
    throw new ServiceError(
      409,
      'SUBSCRIPTION_CONFLICT',
      'Subscriber is not eligible, already subscribed, or permissions changed'
    )
  return row
}
export async function removeIssueSubscriber(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  subscriberId: number
) {
  const self = actor.userId === subscriberId
  if (!self) await requireProjectAccess(db, actor, slug, projectId, 15)
  await getIssue(db, actor, slug, projectId, issueId)
  const [row] = await db
    .update(issueSubscribers)
    .set({ deletedAt: new Date(), updatedById: actor.userId })
    .where(
      and(
        eq(issueSubscribers.issueId, issueId),
        eq(issueSubscribers.projectId, projectId),
        eq(issueSubscribers.subscriberId, subscriberId),
        isNull(issueSubscribers.deletedAt),
        readableIssue(actor, slug, projectId, issueId),
        self ? undefined : writableProject(actor, slug, projectId)
      )
    )
    .returning({ id: issueSubscribers.id })
  if (!row) throw new ServiceError(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found or permissions changed')
}
/**
 * Port of `extract_mentions_as_subscribers` plus the actor subscription of the notification task:
 * the actor always subscribes, mentioned users subscribe unless they already follow the issue,
 * are assignees or created it. Only active project members qualify.
 */
export async function subscribeActorAndMentions(
  db: LancityDb,
  scope: { issueId: number; projectId: number; workspaceId: number },
  actorId: number,
  mentionIds: number[]
) {
  const candidates = JSON.stringify([...new Set([actorId, ...mentionIds])])
  await db
    .insert(issueSubscribers)
    .select(
      sql`select null, ${nowMs}, ${nowMs}, ${actorId}, ${actorId}, ${scope.issueId}, ${scope.projectId}, cast(c.value as integer), ${scope.workspaceId}, null
      from json_each(${candidates}) c
      where not exists (select 1 from issue_subscribers s where s.issue_id = ${scope.issueId} and s.subscriber_id = c.value and s.deleted_at is null)
        and exists (select 1 from project_members pm where pm.project_id = ${scope.projectId} and pm.member_id = c.value and pm.is_active = 1 and pm.deleted_at is null)
        and (c.value = ${actorId}
          or (not exists (select 1 from issue_assignees a where a.issue_id = ${scope.issueId} and a.assignee_id = c.value and a.deleted_at is null)
            and not exists (select 1 from issues i where i.id = ${scope.issueId} and i.created_by_id = c.value)))`
    )
    .onConflictDoNothing()
}
