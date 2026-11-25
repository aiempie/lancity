import type { notifications, userNotificationPreferences } from '@/db/schema/notification'
import type { NotificationDetails } from '@/server/notification/queries'

type NotificationRow = typeof notifications.$inferSelect
type PreferenceRow = typeof userNotificationPreferences.$inferSelect

/** Plane `NotificationSerializer`: all columns in snake_case plus the user and intake annotations. */
export function presentNotification(row: NotificationRow, details: NotificationDetails) {
  return {
    id: row.id,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    created_by: row.createdById,
    updated_by: row.updatedById,
    deleted_at: row.deletedAt,
    workspace: row.workspaceId,
    project: row.projectId,
    data: row.data,
    entity_identifier: row.entityIdentifier,
    entity_name: row.entityName,
    title: row.title,
    message: row.message,
    message_html: row.messageHtml,
    message_stripped: row.messageStripped,
    sender: row.sender,
    triggered_by: row.triggeredById,
    receiver: row.receiverId,
    read_at: row.readAt,
    snoozed_till: row.snoozedTill,
    archived_at: row.archivedAt,
    triggered_by_details: row.triggeredById === null ? null : (details.users.get(row.triggeredById) ?? null),
    is_inbox_issue: row.entityIdentifier !== null && details.intake.has(row.entityIdentifier),
    is_intake_issue: row.entityIdentifier !== null && details.intake.has(row.entityIdentifier),
    // Plane annotates `sender icontains "mentioned"`; SQLite LIKE is case-insensitive for ASCII as well.
    is_mentioned_notification: row.sender.toLowerCase().includes('mentioned')
  }
}

/** Plane `UserNotificationPreferenceSerializer`: every column, `user`, `workspace` and `project` read only. */
export function presentNotificationPreference(row: PreferenceRow) {
  return {
    id: row.id,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    created_by: row.createdById,
    updated_by: row.updatedById,
    deleted_at: row.deletedAt,
    user: row.userId,
    workspace: row.workspaceId,
    project: row.projectId,
    property_change: row.propertyChange,
    state_change: row.stateChange,
    comment: row.comment,
    mention: row.mention,
    issue_completed: row.issueCompleted
  }
}

/** `Notification.__str__` (PD-1454): `"<receiver email> <workspace name>"`. For display labels and logs. */
export function formatNotification(receiverEmail: string, workspaceName: string): string {
  return `${receiverEmail} <${workspaceName}>`
}

/** `UserNotificationPreference.__str__` (PD-1456): `"<user>"`. */
export function formatUserNotificationPreference(user: string): string {
  return `<${user}>`
}
