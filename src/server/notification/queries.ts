import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { user } from '@/db/schema/auth'
import { profiles } from '@/db/schema/identity'
import { notifications } from '@/db/schema/notification'
import { memberUserFields, toUserLite } from '@/server/workspace/presenters'
import type { LancityDb } from '@/types/database/schema'

/**
 * Plane `NotificationViewSet.get_queryset` (PD-0700): the receiver's notifications of one workspace, soft
 * deletes hidden. Notifications of a project only show while the receiver may still see the project and issue.
 */
export function queryNotification(workspaceId: number, userId: number): SQL | undefined {
  return and(
    eq(notifications.workspaceId, workspaceId),
    eq(notifications.receiverId, userId),
    isNull(notifications.deletedAt),
    sql`(${notifications.projectId} is null or exists (
      select 1 from project_members membership join projects p on p.id = membership.project_id
      where p.id = ${notifications.projectId} and p.workspace_id = ${workspaceId} and p.deleted_at is null
        and membership.workspace_id = ${workspaceId} and membership.member_id = ${userId}
        and membership.is_active = 1 and membership.deleted_at is null
        and (membership.role > 5 or p.guest_view_all_features = 1 or exists (
          select 1 from workspace_members wm where wm.workspace_id = ${workspaceId} and wm.member_id = ${userId} and wm.role = 20 and wm.is_active = 1 and wm.deleted_at is null
        ) or exists (
          select 1 from issues i where i.id = ${notifications.entityIdentifier} and i.project_id = p.id and i.workspace_id = ${workspaceId} and i.created_by_id = ${userId} and i.deleted_at is null
        ))
    ))`
  )
}

/** `type` filter of the list and mark-all-read endpoints (assigned, created, subscribed-only, watching). */
export function notificationTypeFilter(type: string[], workspaceId: number, userId: number, guest: boolean) {
  if (type.includes('all')) return undefined
  const assigned = sql`exists (select 1 from issue_assignees ia where ia.issue_id = ${sql.raw('"notifications"."entity_identifier"')} and ia.project_id = ${sql.raw('"notifications"."project_id"')} and ia.workspace_id = ${workspaceId} and ia.assignee_id = ${userId} and ia.deleted_at is null)`
  const created = sql`exists (select 1 from issues i where i.id = ${sql.raw('"notifications"."entity_identifier"')} and i.project_id = ${sql.raw('"notifications"."project_id"')} and i.workspace_id = ${workspaceId} and i.created_by_id = ${userId} and i.deleted_at is null)`
  const subscribed = sql`exists (select 1 from issue_subscribers ins where ins.issue_id = ${sql.raw('"notifications"."entity_identifier"')} and ins.project_id = ${sql.raw('"notifications"."project_id"')} and ins.workspace_id = ${workspaceId} and ins.subscriber_id = ${userId} and ins.deleted_at is null)`
  return (
    or(
      ...[
        type.includes('assigned') ? assigned : undefined,
        type.includes('created') && !guest ? created : undefined,
        type.includes('subscribed') ? and(subscribed, sql`not (${assigned})`, sql`not (${created})`) : undefined,
        type.includes('watching') ? subscribed : undefined
      ].filter(value => value !== undefined)
    ) ?? sql`0`
  )
}

type NotificationRow = typeof notifications.$inferSelect

/**
 * Data the notification serializer adds to a row: `triggered_by_details` (UserLiteSerializer) and the intake
 * annotation (the issue is still in an open intake state: pending, snoozed or duplicate, status 0, 2, -2).
 */
export async function loadNotificationDetails(db: LancityDb, workspaceId: number, rows: NotificationRow[]) {
  const userIds = [...new Set(rows.map(row => row.triggeredById).filter((value): value is number => value !== null))]
  const issueIds = [
    ...new Set(rows.map(row => row.entityIdentifier).filter((value): value is number => value !== null))
  ]
  const users = new Map<number, ReturnType<typeof toUserLite>>()
  const intake = new Set<number>()
  // Chunks keep each statement under the D1 limit of 100 bound parameters.
  for (let i = 0; i < userIds.length; i += 80) {
    const found = await db
      .select(memberUserFields)
      .from(user)
      .leftJoin(profiles, eq(profiles.userId, user.id))
      .where(inArray(user.id, userIds.slice(i, i + 80)))
    for (const row of found) users.set(row.userId, toUserLite(row))
  }
  for (let i = 0; i < issueIds.length; i += 80) {
    const found = await db.all<{ issue_id: number }>(
      sql`select distinct issue_id from intake_issues where workspace_id = ${workspaceId} and deleted_at is null
        and status in (0, 2, -2) and issue_id in (select value from json_each(${JSON.stringify(issueIds.slice(i, i + 80))}))`
    )
    for (const row of found) intake.add(row.issue_id)
  }
  return { users, intake }
}
export type NotificationDetails = Awaited<ReturnType<typeof loadNotificationDetails>>
