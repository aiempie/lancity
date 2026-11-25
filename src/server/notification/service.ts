import { and, asc, count, desc, eq, gte, isNotNull, isNull, like, notLike, or, sql, type SQL } from 'drizzle-orm'
import { notifications, userNotificationPreferences } from '@/db/schema/notification'
import { ServiceError } from '@/server/common/errors'
import { OffsetPaginator, paginate } from '@/server/common/pagination'
import {
  loadNotificationDetails,
  notificationTypeFilter,
  queryNotification as notificationScope
} from '@/server/notification/queries'
import { presentNotification } from '@/server/notification/presenters'
import { getWorkspace } from '@/server/workspace/service'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type {
  NotificationListQuery,
  NotificationMarkAll,
  NotificationPreferencesUpdate
} from '@/types/notification/schema'

export async function requireReportingWorkspace(db: LancityDb, actor: Actor, slug: string) {
  return getWorkspace(db, actor, slug)
}

function listConditions(
  workspaceId: number,
  userId: number,
  guest: boolean,
  filter: NotificationListQuery
): (SQL | undefined)[] {
  return [
    notificationScope(workspaceId, userId),
    eq(notifications.entityName, 'issue'),
    filter.archived ? isNotNull(notifications.archivedAt) : isNull(notifications.archivedAt),
    filter.snoozed
      ? isNotNull(notifications.snoozedTill)
      : or(gte(notifications.snoozedTill, new Date()), isNull(notifications.snoozedTill)),
    filter.read === undefined
      ? undefined
      : filter.read
        ? isNotNull(notifications.readAt)
        : isNull(notifications.readAt),
    filter.mentioned ? like(notifications.sender, '%mentioned%') : notLike(notifications.sender, '%mentioned%'),
    notificationTypeFilter(filter.type, workspaceId, userId, guest)
  ]
}
export async function listNotifications(db: LancityDb, actor: Actor, slug: string, filter: NotificationListQuery) {
  const { workspace, membership } = await requireReportingWorkspace(db, actor, slug)
  return db
    .select()
    .from(notifications)
    .where(and(...listConditions(workspace.id, actor.userId, membership.role === 5, filter)))
    .orderBy(notifications.snoozedTill, desc(notifications.createdAt))
    .limit(100)
}

type PageQuery = URLSearchParams | Record<string, string | undefined | null>
const queryParam = (query: PageQuery, name: string) =>
  (query instanceof URLSearchParams ? query.get(name) : query[name]) || undefined
/** Plane `sanitize_order_by` with `NOTIFICATION_ORDER_BY_ALLOWLIST`. */
const NOTIFICATION_ORDER_BY = { created_at: notifications.createdAt, updated_at: notifications.updatedAt }

/** Attach `triggered_by_details` and the intake flags (Plane `NotificationSerializer`). */
export async function presentNotifications(db: LancityDb, rows: (typeof notifications.$inferSelect)[]) {
  if (!rows.length) return []
  const details = await loadNotificationDetails(db, rows[0].workspaceId, rows)
  return rows.map(row => presentNotification(row, details))
}

/**
 * NotificationViewSet.list (PD-0701, PD-0702): a plain array, or the paginated body when both `per_page` and
 * `cursor` are given. Without pagination the order is snooze time then newest first, as in Plane.
 */
export async function listNotificationItems(
  db: LancityDb,
  actor: Actor,
  slug: string,
  filter: NotificationListQuery,
  query: PageQuery = {}
) {
  if (!queryParam(query, 'per_page') || !queryParam(query, 'cursor')) {
    return presentNotifications(db, await listNotifications(db, actor, slug, filter))
  }
  const { workspace, membership } = await requireReportingWorkspace(db, actor, slug)
  const where = and(...listConditions(workspace.id, actor.userId, membership.role === 5, filter))
  const requested = queryParam(query, 'order_by') ?? '-created_at'
  const key = requested.replace(/^-/, '')
  const orderBy = key in NOTIFICATION_ORDER_BY ? requested : '-created_at'
  const column = NOTIFICATION_ORDER_BY[orderBy.replace(/^-/, '') as keyof typeof NOTIFICATION_ORDER_BY]
  const direction = orderBy.startsWith('-') ? desc : asc
  return paginate(query, {
    paginator: new OffsetPaginator({
      orderBy,
      fetch: (offset, limit) =>
        db
          .select()
          .from(notifications)
          .where(where)
          .orderBy(direction(column), direction(notifications.id))
          .limit(limit)
          .offset(offset),
      count: async () => (await db.select({ total: count() }).from(notifications).where(where))[0].total
    }),
    onResults: rows => presentNotifications(db, rows) as never
  })
}

async function findNotification(db: LancityDb, workspaceId: number, userId: number, id: number) {
  const [row] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, id), notificationScope(workspaceId, userId)))
  if (!row) throw new ServiceError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found')
  return row
}

/** NotificationViewSet.retrieve (PD-0699). */
export async function getNotification(db: LancityDb, actor: Actor, slug: string, id: number) {
  const { workspace } = await requireReportingWorkspace(db, actor, slug)
  return findNotification(db, workspace.id, actor.userId, id)
}

/** NotificationViewSet.destroy (PD-0698): soft delete of the receiver's own notification. */
export async function deleteNotification(db: LancityDb, actor: Actor, slug: string, id: number) {
  const { workspace } = await requireReportingWorkspace(db, actor, slug)
  await findNotification(db, workspace.id, actor.userId, id)
  await db
    .update(notifications)
    .set({ deletedAt: new Date(), updatedById: actor.userId })
    .where(and(eq(notifications.id, id), eq(notifications.receiverId, actor.userId), isNull(notifications.deletedAt)))
}
export async function snoozeNotification(db: LancityDb, actor: Actor, slug: string, id: number, until: Date | null) {
  const { workspace } = await requireReportingWorkspace(db, actor, slug)
  const [row] = await db
    .update(notifications)
    .set({ snoozedTill: until, updatedById: actor.userId })
    .where(and(eq(notifications.id, id), notificationScope(workspace.id, actor.userId)))
    .returning()
  if (!row) throw new ServiceError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found')
  return row
}
export async function setNotificationState(
  db: LancityDb,
  actor: Actor,
  slug: string,
  id: number,
  field: 'read' | 'archive',
  enabled: boolean
) {
  const { workspace } = await requireReportingWorkspace(db, actor, slug)
  const values =
    field === 'read' ? { readAt: enabled ? new Date() : null } : { archivedAt: enabled ? new Date() : null }
  const [row] = await db
    .update(notifications)
    .set({ ...values, updatedById: actor.userId })
    .where(and(eq(notifications.id, id), notificationScope(workspace.id, actor.userId)))
    .returning()
  if (!row) throw new ServiceError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found')
  return row
}
export async function unreadNotificationCounts(db: LancityDb, actor: Actor, slug: string) {
  const { workspace } = await requireReportingWorkspace(db, actor, slug)
  const [row] = await db
    .select({
      watching: sql<number>`count(*) filter (where ${notLike(notifications.sender, '%mentioned%')})`,
      mentioned: sql<number>`count(*) filter (where ${like(notifications.sender, '%mentioned%')})`
    })
    .from(notifications)
    .where(
      and(
        notificationScope(workspace.id, actor.userId),
        isNull(notifications.readAt),
        isNull(notifications.archivedAt),
        isNull(notifications.snoozedTill)
      )
    )
  return { total_unread_notifications_count: row.watching, mention_unread_notifications_count: row.mentioned }
}
export async function markAllNotificationsRead(db: LancityDb, actor: Actor, slug: string, filter: NotificationMarkAll) {
  const { workspace, membership } = await requireReportingWorkspace(db, actor, slug)
  const types = [filter.type]
  await db
    .update(notifications)
    .set({ readAt: new Date(), updatedById: actor.userId })
    .where(
      and(
        notificationScope(workspace.id, actor.userId),
        isNull(notifications.readAt),
        filter.archived ? isNotNull(notifications.archivedAt) : isNull(notifications.archivedAt),
        filter.snoozed
          ? isNotNull(notifications.snoozedTill)
          : or(gte(notifications.snoozedTill, new Date()), isNull(notifications.snoozedTill)),
        notificationTypeFilter(types, workspace.id, actor.userId, membership.role === 5)
      )
    )
}
export async function getNotificationPreferences(db: LancityDb, actor: Actor) {
  await db.run(sql`insert into user_notification_preferences (user_id, created_by_id, updated_by_id)
    select ${actor.userId}, ${actor.userId}, ${actor.userId} where not exists
    (select 1 from user_notification_preferences where user_id = ${actor.userId} and workspace_id is null and project_id is null and deleted_at is null)`)
  const [row] = await db
    .select()
    .from(userNotificationPreferences)
    .where(
      and(
        eq(userNotificationPreferences.userId, actor.userId),
        isNull(userNotificationPreferences.workspaceId),
        isNull(userNotificationPreferences.projectId),
        isNull(userNotificationPreferences.deletedAt)
      )
    )
    .limit(1)
  return row
}
export async function updateNotificationPreferences(db: LancityDb, actor: Actor, input: NotificationPreferencesUpdate) {
  const preference = await getNotificationPreferences(db, actor)
  const [row] = await db
    .update(userNotificationPreferences)
    .set({
      propertyChange: input.property_change,
      stateChange: input.state_change,
      comment: input.comment,
      mention: input.mention,
      issueCompleted: input.issue_completed,
      updatedById: actor.userId
    })
    .where(
      and(
        eq(userNotificationPreferences.id, preference.id),
        eq(userNotificationPreferences.userId, actor.userId),
        isNull(userNotificationPreferences.workspaceId),
        isNull(userNotificationPreferences.projectId),
        isNull(userNotificationPreferences.deletedAt)
      )
    )
    .returning()
  return row
}
