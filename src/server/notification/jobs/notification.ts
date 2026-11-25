import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { BatchItem } from 'drizzle-orm/batch'
import * as schema from '@/db/schema'
import { user } from '@/db/schema/auth'
import { issueActivities, issueAssignees, issueComments, issueMentions, issueSubscribers, issues, states } from '@/db/schema/issue'
import {
  emailNotificationLogs,
  notifications as notificationTable,
  userNotificationPreferences
} from '@/db/schema/notification'
import { projectMembers, projects, workspaces } from '@/db/schema/workspace'
import type { InfraEnv } from '@/server/common/env'
import { checkJobClaim, jobClaimStatement } from '@/server/common/job-claims'
import { bulkCreateSubscribers } from '@/server/issue/jobs/issue-activities'
import { diffMentions, extractMentions as extractHtmlMentions, syncIssueMentions } from '@/server/issue/mention'
import { NOTIFICATION_JOB } from '@/server/notification/events'
import { DEFAULT_NOTIFICATION_PREFERENCE } from '@/server/notification/model-rules'
import type { JsonValue, LancityDb } from '@/types/database/schema'
import { notificationIssueJobSchema, type NotificationIssueJob } from '@/types/notification/p2-notification-schema'

type Obj = Record<string, unknown>

/** Activity types for which Plane sends neither in-app notifications nor emails. */
export const NOTIFICATION_SKIPPED_TYPES: ReadonlySet<string> = new Set([
  'cycle.activity.created',
  'cycle.activity.deleted',
  'module.activity.created',
  'module.activity.deleted',
  'issue_reaction.activity.created',
  'issue_reaction.activity.deleted',
  'comment_reaction.activity.created',
  'comment_reaction.activity.deleted',
  'issue_vote.activity.created',
  'issue_vote.activity.deleted',
  'issue_draft.activity.created',
  'issue_draft.activity.updated',
  'issue_draft.activity.deleted'
])

const log = (level: 'info' | 'error', label: string, data: Obj = {}) =>
  console[level === 'info' ? 'log' : 'error'](JSON.stringify({ level, label, ...data }))

/** Python `str()` of a nullable value: Plane stores `str(None)` as "None" in notification data. */
const pyStr = (value: unknown) => (value === null || value === undefined ? 'None' : String(value))
const orNull = (value: unknown) => (value ? String(value) : null)
const toId = (value: unknown): number | null => {
  const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null
}
const toIso = (value: unknown): string | null => {
  const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null
}

/** One stored `issue_activities` row as carried by the `notification.issue` job (camelCase Drizzle keys). */
export type ActivityInfo = {
  id: number
  verb: string
  field: string | null
  oldValue: string | null
  newValue: string | null
  comment: string
  issueId: number | null
  issueCommentId: number | null
  actorId: number | null
  oldIdentifier: number | null
  newIdentifier: number | null
  createdAt: string | null
}
const text = (value: unknown) => (typeof value === 'string' ? value : null)
export function toActivityInfo(row: Obj): ActivityInfo {
  const pick = (camel: string, snake: string) => row[camel] ?? row[snake]
  return {
    id: toId(row.id) ?? 0,
    verb: text(row.verb) ?? '',
    field: text(row.field),
    oldValue: text(pick('oldValue', 'old_value')),
    newValue: text(pick('newValue', 'new_value')),
    comment: text(row.comment) ?? '',
    issueId: toId(pick('issueId', 'issue_id')),
    issueCommentId: toId(pick('issueCommentId', 'issue_comment_id')),
    actorId: toId(pick('actorId', 'actor_id')),
    oldIdentifier: toId(pick('oldIdentifier', 'old_identifier')),
    newIdentifier: toId(pick('newIdentifier', 'new_identifier')),
    createdAt: toIso(pick('createdAt', 'created_at'))
  }
}

// =========== Issue description parsing (PD-1202 to PD-1205) ======================

/** Plane `extract_mentions` (PD-1205): user mentions in the `description_html` of an issue instance. */
export function extractMentions(instance: Obj | null | undefined): number[] {
  const html = instance?.description_html
  return typeof html === 'string' ? extractHtmlMentions(html) : []
}

/** Plane `get_new_mentions` (PD-1202): mentions of the requested description that the stored one lacks. */
export function getNewMentions(requested: Obj | null | undefined, current: Obj | null | undefined): number[] {
  const older = new Set(extractMentions(current))
  return extractMentions(requested).filter(id => !older.has(id))
}

/** Plane `get_removed_mentions` (PD-1203). */
export function getRemovedMentions(requested: Obj | null | undefined, current: Obj | null | undefined): number[] {
  const newer = new Set(extractMentions(requested))
  return extractMentions(current).filter(id => !newer.has(id))
}

/** Plane `extract_comment_mentions` (PD-1206). */
export const extractCommentMentions = (html: string | null | undefined): number[] => extractHtmlMentions(html)

/** Plane `get_new_comment_mentions` (PD-1207): without an old value every mention is new. */
export const getNewCommentMentions = (newValue: string | null, oldValue: string | null): number[] =>
  diffMentions(newValue, oldValue).added

/**
 * Plane `extract_mentions_as_subscribers` (PD-1204): mentioned users that are active project members and do
 * not follow, are not assigned to and did not create the issue yet. Returns the user ids to subscribe.
 */
export async function extractMentionsAsSubscribers(
  db: LancityDb,
  projectId: number,
  issueId: number,
  mentions: number[]
): Promise<number[]> {
  const ids = [...new Set(mentions)]
  if (!ids.length) return []
  const rows = await db.all<{ id: number }>(
    sql`select cast(c.value as integer) as id from json_each(${JSON.stringify(ids)}) c
      where not exists (select 1 from issue_subscribers s where s.issue_id = ${issueId} and s.project_id = ${projectId} and s.subscriber_id = c.value and s.deleted_at is null)
        and not exists (select 1 from issue_assignees a where a.issue_id = ${issueId} and a.project_id = ${projectId} and a.assignee_id = c.value and a.deleted_at is null)
        and not exists (select 1 from issues i where i.id = ${issueId} and i.project_id = ${projectId} and i.created_by_id = c.value)
        and exists (select 1 from project_members pm where pm.project_id = ${projectId} and pm.member_id = c.value and pm.is_active = 1 and pm.deleted_at is null)`
  )
  return rows.map(row => row.id)
}

/** Plane `update_mentions_for_issue` (PD-1201): store new mentions, remove the deleted ones. */
export function updateMentionsForIssue(
  db: LancityDb,
  scope: { issueId: number; projectId: number; workspaceId: number },
  actorId: number,
  requested: Obj | null | undefined,
  current: Obj | null | undefined
) {
  return syncIssueMentions(
    db,
    scope,
    actorId,
    typeof requested?.description_html === 'string' ? requested.description_html : null,
    typeof current?.description_html === 'string' ? current.description_html : null
  )
}

// =========== Notification rows ======================

type IssueInfo = {
  id: number
  name: string
  identifier: string
  sequence_id: number
  state_name: string
  state_group: string
  project_id: number
  workspace_slug: string
}
type ProjectScope = { id: number; workspaceId: number }

const activityData = (activity: ActivityInfo, extra: Obj = {}) => ({
  id: activity.id,
  verb: pyStr(activity.verb),
  field: pyStr(activity.field),
  actor: pyStr(activity.actorId),
  new_value: pyStr(activity.newValue),
  old_value: pyStr(activity.oldValue),
  ...extra,
  old_identifier: orNull(activity.oldIdentifier),
  new_identifier: orNull(activity.newIdentifier)
})
const issueData = (issue: IssueInfo) => ({
  id: issue.id,
  name: issue.name,
  identifier: issue.identifier,
  sequence_id: issue.sequence_id,
  state_name: issue.state_name,
  state_group: issue.state_group,
  project_id: issue.project_id,
  workspace_slug: issue.workspace_slug
})

type NotificationInsert = typeof notificationTable.$inferInsert
type EmailLogInsert = typeof emailNotificationLogs.$inferInsert

/** Plane `create_mention_notification` (PD-1208). */
export function createMentionNotification(
  project: ProjectScope,
  notificationComment: string,
  issue: IssueInfo,
  actorId: number,
  mentionId: number,
  activity: ActivityInfo
): NotificationInsert {
  return {
    workspaceId: project.workspaceId,
    sender: 'in_app:issue_activities:mentioned',
    triggeredById: actorId,
    receiverId: mentionId,
    entityIdentifier: issue.id,
    entityName: 'issue',
    projectId: project.id,
    title: '',
    message: notificationComment,
    data: { issue: issueData(issue), issue_activity: activityData(activity) } as unknown as JsonValue
  }
}

function emailLog(
  issue: IssueInfo,
  actorId: number,
  receiverId: number,
  field: string,
  activity: ActivityInfo,
  extra: Obj = {}
): EmailLogInsert {
  return {
    triggeredById: actorId,
    receiverId,
    entityIdentifier: issue.id,
    entityName: 'issue',
    entity: '',
    data: {
      issue: issueData(issue),
      issue_activity: { ...activityData(activity, extra), field, activity_time: activity.createdAt }
    } as unknown as JsonValue
  }
}

const SQL_CHUNK = 80

async function loadPreferences(db: LancityDb, userIds: number[]) {
  const found = new Map<number, typeof userNotificationPreferences.$inferSelect>()
  const ids = [...new Set(userIds)]
  for (let i = 0; i < ids.length; i += SQL_CHUNK) {
    const rows = await db
      .select()
      .from(userNotificationPreferences)
      .where(
        and(
          inArray(userNotificationPreferences.userId, ids.slice(i, i + SQL_CHUNK)),
          isNull(userNotificationPreferences.workspaceId),
          isNull(userNotificationPreferences.projectId),
          isNull(userNotificationPreferences.deletedAt)
        )
      )
    for (const row of rows) if (!found.has(row.userId)) found.set(row.userId, row)
  }
  // A user without a row keeps the defaults of the table (everything on) instead of failing the whole task.
  return (userId: number) => found.get(userId) ?? DEFAULT_NOTIFICATION_PREFERENCE
}

/** Rows of the job payload; when the queue message was truncated they are read back by id. */
async function loadActivities(db: LancityDb, payload: NotificationIssueJob): Promise<ActivityInfo[]> {
  const created = (payload.issueActivitiesCreated ?? []).map(toActivityInfo).filter(a => a.id > 0)
  if (!payload.truncated || !created.length) return created
  const rows: (typeof issueActivities.$inferSelect)[] = []
  const ids = created.map(a => a.id)
  for (let i = 0; i < ids.length; i += SQL_CHUNK)
    rows.push(
      ...(await db
        .select()
        .from(issueActivities)
        .where(inArray(issueActivities.id, ids.slice(i, i + SQL_CHUNK))))
    )
  return rows.map(row => toActivityInfo(row as unknown as Obj))
}

/**
 * Plane `notifications` task (PD-1209), job `notification.issue`: subscribers get an in-app notification and
 * an email log per activity (as their preferences allow), mentioned users get a mention notification, new
 * mentions are stored and mentioned members subscribe to the issue.
 * Writes happen last, in one batch together with the claim of `jobId`, so a retry after a failed read repeats nothing
 * and a redelivery after success is skipped.
 */
export async function notifications(env: InfraEnv, raw: unknown, jobId?: string): Promise<void> {
  const parsed = notificationIssueJobSchema.safeParse(raw)
  if (!parsed.success) return log('error', 'notification.issue', { message: 'Invalid payload' })
  const payload = parsed.data
  const { issueId, actorId, projectId } = payload
  if (NOTIFICATION_SKIPPED_TYPES.has(payload.type) || !issueId || !actorId) return
  const db = drizzle(env.DB, { schema }) as unknown as LancityDb
  const claimKey = jobId ? `${NOTIFICATION_JOB.issue}:${jobId}` : null
  const claim = claimKey ? await checkJobClaim(db, claimKey) : { done: false, available: false }
  if (claim.done) return

  const [row] = await db
    .select({
      issue: issues,
      identifier: projects.identifier,
      workspaceId: projects.workspaceId,
      workspaceSlug: workspaces.slug,
      stateName: states.name,
      stateGroup: states.group
    })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .leftJoin(states, eq(states.id, issues.stateId))
    .where(and(eq(issues.id, issueId), eq(issues.projectId, projectId), isNull(issues.deletedAt)))
  if (!row) return
  const project: ProjectScope = { id: projectId, workspaceId: row.workspaceId }
  const issue: IssueInfo = {
    id: issueId,
    name: row.issue.name,
    identifier: row.identifier,
    sequence_id: row.issue.sequenceId,
    state_name: row.stateName ?? '',
    state_group: row.stateGroup ?? '',
    project_id: projectId,
    workspace_slug: row.workspaceSlug
  }

  const activities = await loadActivities(db, payload)
  const requested = payload.requestedData ?? null
  const current = payload.currentInstance ?? null

  // Active project members: only they receive notifications or become subscribers.
  const members = new Set(
    (
      await db
        .select({ id: projectMembers.memberId })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.isActive, true),
            isNull(projectMembers.deletedAt)
          )
        )
    ).map(member => member.id)
  )

  // Mentions of the description and of the comments.
  const newMentions = getNewMentions(requested, current).filter(id => members.has(id))
  const mentionSubscribers = await extractMentionsAsSubscribers(db, projectId, issueId, extractMentions(requested))

  let commentMentions: number[] = []
  const allCommentMentions: number[] = []
  const comments = new Map<number, string>()
  const commentIds = [...new Set(activities.map(a => a.issueCommentId).filter((id): id is number => id !== null))]
  for (let i = 0; i < commentIds.length; i += SQL_CHUNK)
    for (const comment of await db
      .select({ id: issueComments.id, stripped: issueComments.commentStripped })
      .from(issueComments)
      .where(
        and(
          inArray(issueComments.id, commentIds.slice(i, i + SQL_CHUNK)),
          eq(issueComments.issueId, issueId),
          eq(issueComments.projectId, projectId),
          eq(issueComments.workspaceId, row.workspaceId)
        )
      ))
      comments.set(comment.id, comment.stripped)
  for (const activity of activities) {
    if (activity.issueCommentId === null) continue
    allCommentMentions.push(...extractCommentMentions(activity.newValue))
    commentMentions.push(...getNewCommentMentions(activity.newValue, activity.oldValue))
    commentMentions = commentMentions.filter(id => members.has(id))
  }
  commentMentions = [...new Set(commentMentions)]
  const commentMentionSubscribers = await extractMentionsAsSubscribers(db, projectId, issueId, allCommentMentions)

  // Subscribers, except the mentioned users (they get a mention notification) and the actor.
  const excluded = [...newMentions, ...commentMentions, actorId]
  const subscribers = (
    await db
      .select({ id: issueSubscribers.subscriberId })
      .from(issueSubscribers)
      .where(
        and(
          eq(issueSubscribers.projectId, projectId),
          eq(issueSubscribers.issueId, issueId),
          isNull(issueSubscribers.deletedAt)
        )
      )
  )
    .map(subscriber => subscriber.id)
    .filter(id => members.has(id) && !excluded.includes(id))

  if (payload.subscriber) await subscribeActor(db, issueId, projectId, row.workspaceId, actorId)

  const assignees = new Set(
    (
      await db
        .select({ id: issueAssignees.assigneeId })
        .from(issueAssignees)
        .where(
          and(
            eq(issueAssignees.issueId, issueId),
            eq(issueAssignees.projectId, projectId),
            isNull(issueAssignees.deletedAt)
          )
        )
    )
      .map(assignee => assignee.id)
      .filter(id => members.has(id))
  )

  const completedStates = new Map<number, boolean>()
  const isCompletedState = async (stateId: number | null) => {
    if (stateId === null) return false
    if (!completedStates.has(stateId)) {
      const [found] = await db
        .select({ id: states.id })
        .from(states)
        .where(and(eq(states.id, stateId), eq(states.projectId, projectId), eq(states.group, 'completed')))
      completedStates.set(stateId, Boolean(found))
    }
    return completedStates.get(stateId)!
  }

  const preference = await loadPreferences(db, [...new Set([...subscribers, ...newMentions, ...commentMentions])])
  const bulkNotifications: NotificationInsert[] = []
  const bulkEmailLogs: EmailLogInsert[] = []

  for (const subscriberId of [...new Set(subscribers)]) {
    const sender =
      row.issue.createdById === subscriberId
        ? 'in_app:issue_activities:created'
        : assignees.has(subscriberId) && !(row.issue.createdById !== null && assignees.has(row.issue.createdById))
          ? 'in_app:issue_activities:assigned'
          : 'in_app:issue_activities:subscribed'
    const pref = preference(subscriberId)
    for (const activity of activities) {
      // An activity on another issue (blocking, relation) is not a reason to notify the subscribers of this one.
      if (activity.issueId !== issueId) continue
      // The description update has its own mention flow.
      if (activity.field === 'description') continue
      const sendEmail =
        (activity.field === 'state' && pref.stateChange) ||
        (activity.field === 'state' && pref.issueCompleted && (await isCompletedState(activity.newIdentifier))) ||
        (activity.field === 'comment' && pref.comment) ||
        pref.propertyChange
      const issueComment = activity.issueCommentId === null ? null : (comments.get(activity.issueCommentId) ?? null)
      const extra = { issue_comment: pyStr(issueComment ?? '') }
      bulkNotifications.push({
        workspaceId: row.workspaceId,
        sender,
        triggeredById: actorId,
        receiverId: subscriberId,
        entityIdentifier: issueId,
        entityName: 'issue',
        projectId,
        title: activity.comment,
        data: {
          issue: issueData(issue),
          issue_activity: activityData(activity, extra)
        } as unknown as JsonValue
      })
      if (sendEmail)
        bulkEmailLogs.push(emailLog(issue, actorId, subscriberId, activity.field ?? 'None', activity, extra))
    }
  }

  const [actor] = await db.select({ name: user.name, username: user.username }).from(user).where(eq(user.id, actorId))
  const actorName = actor?.username ?? actor?.name ?? 'Someone'

  for (const mentionId of commentMentions) {
    if (mentionId === actorId) continue
    for (const activity of activities) {
      bulkNotifications.push(
        createMentionNotification(
          project,
          `${actorName} has mentioned you in a comment in issue ${issue.name}`,
          issue,
          actorId,
          mentionId,
          activity
        )
      )
      if (preference(mentionId).mention) bulkEmailLogs.push(emailLog(issue, actorId, mentionId, 'mention', activity))
    }
  }

  for (const mentionId of newMentions) {
    if (mentionId === actorId) continue
    const message = `You have been mentioned in the issue ${issue.name}`
    const descriptionActivity = activities.find(activity => activity.field === 'description' && activity.actorId === actorId)
    const relatedActivities = descriptionActivity ? [descriptionActivity] : activities
    for (const activity of relatedActivities) {
      bulkNotifications.push(createMentionNotification(project, message, issue, actorId, mentionId, activity))
      if (preference(mentionId).mention) bulkEmailLogs.push(emailLog(issue, actorId, mentionId, 'mention', activity))
    }
  }

  // Mentioned members follow the issue, then the mention state of the description is stored.
  await bulkCreateSubscribers(db, issueId, projectId, row.workspaceId, [
    ...mentionSubscribers,
    ...commentMentionSubscribers
  ])
  const statements: BatchItem<'sqlite'>[] = []
  if (claimKey && claim.available) statements.push(jobClaimStatement(db, claimKey))
  if (typeof requested?.description_html === 'string') {
    // Reconcile against the committed description, not the event's historical diff. Guard both writes
    // against a concurrent edit; its own queued event will reconcile the newer description.
    const html = row.issue.descriptionHtml
    const mentionIds = JSON.stringify(extractHtmlMentions(html))
    const unchanged = sql`exists (select 1 from issues i where i.id = ${issueId} and i.project_id = ${projectId} and i.deleted_at is null and i.description_html = ${html})`
    statements.push(
      db.insert(issueMentions).select(sql`select null, cast(unixepoch('subsec') * 1000 as integer), cast(unixepoch('subsec') * 1000 as integer),
        ${actorId}, ${actorId}, ${issueId}, pm.member_id, ${projectId}, ${row.workspaceId}, null
        from project_members pm where pm.project_id = ${projectId} and pm.is_active = 1 and pm.deleted_at is null
          and pm.member_id in (select value from json_each(${mentionIds})) and ${unchanged}
          and not exists (select 1 from issue_mentions m where m.issue_id = ${issueId} and m.mention_id = pm.member_id and m.deleted_at is null)`)
        .onConflictDoNothing(),
      db.update(issueMentions).set({ deletedAt: new Date(), updatedById: actorId }).where(and(
        eq(issueMentions.issueId, issueId), isNull(issueMentions.deletedAt),
        sql`${issueMentions.mentionId} not in (select value from json_each(${mentionIds}))`, unchanged
      ))
    )
  }
  // 100 bound parameters per D1 statement: 5 notification rows or 8 email log rows each.
  for (let i = 0; i < bulkNotifications.length; i += 5)
    statements.push(db.insert(notificationTable).values(bulkNotifications.slice(i, i + 5)))
  for (let i = 0; i < bulkEmailLogs.length; i += 8)
    statements.push(db.insert(emailNotificationLogs).values(bulkEmailLogs.slice(i, i + 8)))
  if (statements.length) {
    const [first, ...rest] = statements
    await db.batch([first, ...rest])
  }
}

/** `IssueSubscriber.objects.get_or_create(actor)`: the actor follows the issue they changed. */
async function subscribeActor(db: LancityDb, issueId: number, projectId: number, workspaceId: number, actorId: number) {
  await db.run(
    sql`insert into issue_subscribers (created_by_id, updated_by_id, issue_id, project_id, subscriber_id, workspace_id)
      select ${actorId}, ${actorId}, ${issueId}, ${projectId}, ${actorId}, ${workspaceId}
      where not exists (select 1 from issue_subscribers where issue_id = ${issueId} and subscriber_id = ${actorId} and deleted_at is null)`
  )
}
