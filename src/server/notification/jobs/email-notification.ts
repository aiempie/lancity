import { and, asc, eq, inArray, isNotNull, isNull, lt, lte } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@/db/schema'
import { user } from '@/db/schema/auth'
import { notificationEmailLocks } from '@/db/schema/ext-p2-notification'
import { profiles } from '@/db/schema/identity'
import { issues } from '@/db/schema/issue'
import { emailNotificationLogs } from '@/db/schema/notification'
import { projects, workspaces } from '@/db/schema/workspace'
import { enqueueJob } from '@/server/common/jobs'
import { baseHost } from '@/server/common/host'
import type { InfraEnv } from '@/server/common/env'
import { generatePlainTextFromHtml, renderIssueUpdatesEmail, type IssueEmailChange } from '@/server/notification/email'
import { NOTIFICATION_JOB } from '@/server/notification/events'
import type { LancityDb } from '@/types/database/schema'
import { emailNotificationJobSchema } from '@/types/notification/p2-notification-schema'

type Obj = Record<string, unknown>
type LogRow = typeof emailNotificationLogs.$inferSelect

// `@/server/common/env` and `mail` import `cloudflare:workers`; loading them lazily keeps this module testable in Node.
const logJson = (level: 'info' | 'error', label: string, data: Obj = {}) =>
  console[level === 'info' ? 'log' : 'error'](JSON.stringify({ level, label, ...data }))

/** Plane `_retention_days`: unset, invalid or negative values fall back to the default. */
function retentionDays(raw: unknown, fallback: number): number {
  const days = raw === undefined || raw === null || raw === '' ? NaN : Number(raw)
  return Number.isInteger(days) && days >= 0 ? days : fallback
}

/** Plane `remove_unwanted_characters` (PD-1123): drop control characters that break email subjects. */
export const removeUnwantedCharacters = (input: string) => input.replace(/[\x00-\x1F\x7F-\x9F]/g, '')

/** Plane `acquire_lock` (PD-1124), on D1: true when the lock was free or expired. `ttlSeconds` is Plane's 300. */
export async function acquireLock(db: LancityDb, key: string, ttlSeconds = 300): Promise<boolean> {
  const nowMs = Date.now()
  await db
    .delete(notificationEmailLocks)
    .where(and(eq(notificationEmailLocks.key, key), lt(notificationEmailLocks.expiresAt, nowMs)))
  const rows = await db
    .insert(notificationEmailLocks)
    .values({ key, expiresAt: nowMs + ttlSeconds * 1000 })
    .onConflictDoNothing()
    .returning({ id: notificationEmailLocks.id })
  return rows.length > 0
}

/** Plane `release_lock` (PD-1125). */
export async function releaseLock(db: LancityDb, key: string): Promise<void> {
  await db.delete(notificationEmailLocks).where(eq(notificationEmailLocks.key, key))
}

/** Plane `stack_email_notification` (PD-1126), job `notification.email.stack`, cron every 5 minutes. */
export async function stackEmailNotification(env: InfraEnv): Promise<number> {
  const db = drizzle(env.DB, { schema }) as unknown as LancityDb
  const logs = await db
    .select({
      id: emailNotificationLogs.id,
      receiverId: emailNotificationLogs.receiverId,
      issueId: emailNotificationLogs.entityIdentifier
    })
    .from(emailNotificationLogs)
    .where(and(isNull(emailNotificationLogs.processedAt), isNull(emailNotificationLogs.deletedAt)))
    .orderBy(asc(emailNotificationLogs.receiverId), asc(emailNotificationLogs.id))
    .limit(2000)
  // One email per receiver and issue; each carries the ids of its own logs.
  const groups = new Map<string, { receiverId: number; issueId: number; ids: number[] }>()
  for (const log of logs) {
    if (log.issueId === null) continue
    const key = `${log.receiverId}:${log.issueId}`
    const group = groups.get(key) ?? { receiverId: log.receiverId, issueId: log.issueId, ids: [] }
    group.ids.push(log.id)
    groups.set(key, group)
  }
  // Mark the logs processed before dispatching, so this update never races the sends' `sent_at` updates.
  const processed = logs.map(log => log.id)
  for (let i = 0; i < processed.length; i += 80)
    await db
      .update(emailNotificationLogs)
      .set({ processedAt: new Date() })
      .where(inArray(emailNotificationLogs.id, processed.slice(i, i + 80)))
  for (const group of groups.values())
    // Queue messages are capped at 128 KB, so very large groups are split.
    for (let i = 0; i < group.ids.length; i += 500)
      await enqueueJob(env, {
        type: NOTIFICATION_JOB.emailSend,
        payload: {
          issueId: group.issueId,
          receiverId: group.receiverId,
          emailNotificationIds: group.ids.slice(i, i + 500)
        }
      })
  return groups.size
}

type ActivityData = { field?: string; old_value?: unknown; new_value?: unknown; activity_time?: string | null }
type Payload = Map<number, { changes: Record<string, IssueEmailChange>; activityTime: string }>

const MYSQL_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/

/**
 * Plane `create_payload` (PD-1127): per actor and field, the distinct old and new values in order, plus the
 * time of the activity ("%Y-%m-%d %H:%M:%S"). Plane keeps the time of the last activity of the actor.
 */
export function createPayload(notificationData: Map<number, Obj[]>): Payload {
  const data: Payload = new Map()
  for (const [actorId, changes] of notificationData) {
    for (const change of changes) {
      const activity = change.issue_activity as ActivityData | undefined
      if (!activity) continue
      const entry = data.get(actorId) ?? { changes: {}, activityTime: '' }
      data.set(actorId, entry)
      const field = String(activity.field)
      const slot = (entry.changes[field] ??= {})
      for (const [key, raw] of [
        ['old_value', activity.old_value],
        ['new_value', activity.new_value]
      ] as const) {
        const value = String(raw)
        const list = (slot[key] ??= [])
        if (value && !list.includes(value)) list.push(value)
      }
      const match = typeof activity.activity_time === 'string' ? MYSQL_TIME.exec(activity.activity_time) : null
      if (match) entry.activityTime = `${match[1]} ${match[2]}`
    }
  }
  return data
}

const mentionTag = /<mention-component\b([^>]*)>\s*(?:<\/mention-component>)?/gi

/**
 * Plane `process_mention` (PD-1128): replace each mention component by "@display name". Pass the names of the
 * mentioned users, keyed by id (`mentionedUserIds` lists the ids to load).
 */
export function processMention(html: string, names: Map<number, string>): string {
  return html.replace(mentionTag, (match, attributes: string) => {
    const id = Number(/entity_identifier\s*=\s*["']?(\d+)/i.exec(attributes)?.[1])
    return Number.isSafeInteger(id) && names.has(id) ? `@${names.get(id)}` : match
  })
}
export const mentionedUserIds = (values: string[] | undefined): number[] => [
  ...new Set(
    (values ?? []).flatMap(value => [...value.matchAll(/entity_identifier\s*=\s*["']?(\d+)/gi)].map(m => Number(m[1])))
  )
]

/** Plane `process_html_content` (PD-1129): `process_mention` over a list, null stays null. */
export function processHtmlContent(content: string[] | null | undefined, names: Map<number, string>): string[] | null {
  return content ? content.map(html => processMention(html, names)) : null
}

/** Display name of a user, as in Plane `User.display_name`. */
const displayName = (row: { username: string | null; name: string }) => row.username ?? row.name

/**
 * Plane `send_email_notification` (PD-1130), job `notification.email.send`: build the grouped issue update
 * email of one receiver from its unsent logs and send it. A lock keeps a redelivered job from sending twice.
 */
export async function sendEmailNotification(env: InfraEnv, raw: unknown): Promise<void> {
  const parsed = emailNotificationJobSchema.safeParse(raw)
  if (!parsed.success) return logJson('error', 'notification.email.send', { message: 'Invalid payload' })
  const { issueId, receiverId, emailNotificationIds } = parsed.data
  const db = drizzle(env.DB, { schema }) as unknown as LancityDb
  const lockKey = `send_email_notif_${issueId}_${receiverId}_${[...emailNotificationIds].sort((a, b) => a - b).join('_')}`
  if (!(await acquireLock(db, lockKey)))
    return logJson('info', 'notification.email.send', { message: 'Duplicate email skipped' })
  let sent = false
  try {
    const logs: LogRow[] = await db
      .select()
      .from(emailNotificationLogs)
      .where(
        and(
          inArray(emailNotificationLogs.id, emailNotificationIds),
          eq(emailNotificationLogs.receiverId, receiverId),
          eq(emailNotificationLogs.entityIdentifier, issueId),
          isNull(emailNotificationLogs.sentAt),
          isNull(emailNotificationLogs.deletedAt)
        )
      )
      .orderBy(asc(emailNotificationLogs.id))
    if (!logs.length) return
    const [issueRow] = await db
      .select({
        name: issues.name,
        sequenceId: issues.sequenceId,
        projectId: issues.projectId,
        project: projects.name,
        identifier: projects.identifier,
        slug: workspaces.slug
      })
      .from(issues)
      .innerJoin(projects, eq(projects.id, issues.projectId))
      .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
      .where(and(eq(issues.id, issueId), isNull(issues.deletedAt)))
    const [receiver] = await db.select({ email: user.email }).from(user).where(eq(user.id, receiverId))
    // Plane returns without sending when the issue or the user is gone.
    if (!issueRow || !receiver) return

    const byActor = new Map<number, Obj[]>()
    for (const log of logs)
      byActor.set(log.triggeredById, [...(byActor.get(log.triggeredById) ?? []), (log.data ?? {}) as Obj])
    const payload = createPayload(byActor)

    const actorIds = [...payload.keys()]
    const actors = new Map<number, { first: string; last: string }>()
    const mentionIds = new Set<number>()
    for (const entry of payload.values())
      for (const id of mentionedUserIds(entry.changes.mention?.new_value)) mentionIds.add(id)
    for (const entry of payload.values())
      for (const id of mentionedUserIds(entry.changes.mention?.old_value)) mentionIds.add(id)
    const userIds = [...new Set([...actorIds, ...mentionIds])]
    const names = new Map<number, string>()
    for (let i = 0; i < userIds.length; i += 80) {
      const rows = await db
        .select({
          id: user.id,
          name: user.name,
          username: user.username,
          first: profiles.firstName,
          last: profiles.lastName
        })
        .from(user)
        .leftJoin(profiles, eq(profiles.userId, user.id))
        .where(inArray(user.id, userIds.slice(i, i + 80)))
      for (const row of rows) {
        names.set(row.id, displayName(row))
        actors.set(row.id, { first: row.first ?? row.name.split(' ')[0] ?? '', last: row.last ?? '' })
      }
    }

    const updates: Parameters<typeof renderIssueUpdatesEmail>[0]['updates'] = []
    const comments: Parameters<typeof renderIssueUpdatesEmail>[0]['comments'] = []
    for (const [actorId, entry] of payload) {
      const actor = actors.get(actorId)
      // Plane loads the actor and gives up on the whole email when it is missing.
      if (!actor) return
      const actorName = `${actor.first} ${actor.last}`.trim()
      const changes = { ...entry.changes }
      const comment = changes.comment
      const mention = changes.mention
      delete changes.comment
      delete changes.mention
      if (comment?.new_value?.length) comments.push({ actorName, values: comment.new_value })
      if (mention) {
        const values = processHtmlContent(mention.new_value, names)
        if (values?.length) comments.push({ actorName, values })
      }
      if (Object.keys(changes).length) updates.push({ actorName, activityTime: entry.activityTime, changes })
    }

    const base = baseHost(env).replace(/\/$/, '')
    const issueUrl = `${base}/${issueRow.slug}/projects/${issueRow.projectId}/issues/${issueId}`
    const identifier = `${issueRow.identifier}-${issueRow.sequenceId}`
    const html = renderIssueUpdatesEmail({
      issueIdentifier: identifier,
      issueName: issueRow.name,
      issueUrl,
      projectUrl: `${base}/${issueRow.slug}/projects/${issueRow.projectId}/issues/`,
      workspace: issueRow.slug,
      project: issueRow.project,
      preferenceUrl: `${base}/${issueRow.slug}/settings/account/notifications/`,
      receiverEmail: receiver.email,
      entityType: 'issue',
      summary: 'Updates were made to the issue by',
      actorsInvolved: new Set(actorIds).size,
      updates,
      comments
    })
    const { isMailConfigured, sendMail } = await import('@/server/common/mail')
    const result = await sendMail(
      {
        to: receiver.email,
        subject: `${identifier} ${removeUnwantedCharacters(issueRow.name)}`,
        html,
        text: generatePlainTextFromHtml(html)
      },
      env
    )
    if (!result.sent) {
      // Without SMTP credentials the logs stay unsent but processed; with credentials the failure is retried.
      if (isMailConfigured(env)) throw new Error('Issue update email was not sent')
      return
    }
    sent = true
    for (let i = 0; i < logs.length; i += 80)
      await db
        .update(emailNotificationLogs)
        .set({ sentAt: new Date() })
        .where(
          inArray(
            emailNotificationLogs.id,
            logs.slice(i, i + 80).map(log => log.id)
          )
        )
  } finally {
    // A sent email keeps its lock until it expires, so a late duplicate delivery is still dropped.
    if (!sent) await releaseLock(db, lockKey)
  }
}

/**
 * Plane `delete_email_notification_logs` (cleanup_task): logs sent more than `EMAIL_LOG_RETENTION_DAYS` ago
 * (default 7) are removed. Expired send locks go with them.
 */
export async function deleteEmailNotificationLogs(env: InfraEnv): Promise<void> {
  const db = drizzle(env.DB, { schema }) as unknown as LancityDb
  const days = retentionDays(env.EMAIL_LOG_RETENTION_DAYS, 7)
  await db
    .delete(emailNotificationLogs)
    .where(
      and(
        isNotNull(emailNotificationLogs.sentAt),
        lte(emailNotificationLogs.sentAt, new Date(Date.now() - days * 86_400_000))
      )
    )
  await db.delete(notificationEmailLocks).where(lt(notificationEmailLocks.expiresAt, Date.now()))
}
