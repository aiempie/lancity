import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@/db/schema'
import { user } from '@/db/schema/auth'
import {
  commentReactions,
  issueActivities,
  issueComments,
  issueReactions,
  issueSubscribers,
  issues,
  labels,
  states
} from '@/db/schema/issue'
import { cycles, estimatePoints, estimates, modules } from '@/db/schema/planning'
import { projectMembers, projects, workspaceMembers } from '@/db/schema/workspace'
import {
  ISSUE_JOB,
  NOTIFICATION_ISSUE_JOB,
  WEBHOOK_DISPATCH_JOB,
  logIssueJob,
  parseJsonObject
} from '@/server/issue/activity/index'
import type { InfraEnv } from '@/server/common/env'
import { claimActivityRows, claimedActivityIds, checkJobClaim, isClaimConflict, jobClaimStatement } from '@/server/common/job-claims'
import { enqueueJob } from '@/server/common/jobs'
import { enqueueOutboxChild } from '@/server/common/outbox'
import type { LancityDb } from '@/types/database/schema'
import { issueActivityJobSchema } from '@/types/issue/p1-issue-background-schema'

type Data = Record<string, unknown>
type NewActivity = typeof issueActivities.$inferInsert
type Draft = Partial<NewActivity> & { verb: string; comment: string }
export type ActivityContext = {
  db: LancityDb
  issueId: number | null
  projectId: number
  workspaceId: number
  actorId: number | null
  epoch: number | null
  activities: NewActivity[]
}
type Tracker = (ctx: ActivityContext, requested: Data | null, current: Data | null) => Promise<void> | void

const val = (data: Data | null, key: string): unknown => data?.[key] ?? null
const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))
/** Valid auto-increment ID (replaces Plane's `is_valid_uuid`). Accepts numeric strings. */
export const toId = (value: unknown): number | null => {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null
}

function add(ctx: ActivityContext, draft: Draft): void {
  ctx.activities.push({
    issueId: ctx.issueId,
    actorId: ctx.actorId,
    projectId: ctx.projectId,
    workspaceId: ctx.workspaceId,
    epoch: ctx.epoch,
    createdById: ctx.actorId,
    updatedById: ctx.actorId,
    ...draft
  })
}

/** Plane `extract_ids`: IDs from `primaryKey`, else from `fallbackKey`, as strings. */
export function extractIds(data: Data | null, primaryKey: string, fallbackKey: string): Set<string> {
  if (!data) return new Set()
  const list = primaryKey in data ? data[primaryKey] : data[fallbackKey]
  return new Set(Array.isArray(list) ? list.map(String) : [])
}

/** Bump `updated_at` of a live issue in the project. Returns false when the issue does not exist. */
async function touchIssue(ctx: ActivityContext, issueId: number | null): Promise<boolean> {
  if (issueId === null) return false
  const rows = await ctx.db
    .update(issues)
    .set({ updatedAt: new Date() })
    .where(and(eq(issues.id, issueId), eq(issues.projectId, ctx.projectId), isNull(issues.deletedAt)))
    .returning({ id: issues.id })
  return rows.length > 0
}

/** Issue with its project identifier, scoped to the project or (for relations) to the workspace. */
async function issueRef(ctx: ActivityContext, issueId: number, scope: 'project' | 'workspace' = 'project') {
  const [row] = await ctx.db
    .select({
      id: issues.id,
      sequenceId: issues.sequenceId,
      projectId: issues.projectId,
      identifier: projects.identifier
    })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .where(
      and(
        eq(issues.id, issueId),
        scope === 'project' ? eq(issues.projectId, ctx.projectId) : eq(issues.workspaceId, ctx.workspaceId),
        isNull(issues.deletedAt)
      )
    )
    .limit(1)
  return row ?? null
}

/** PD-1138 */
export const trackName: Tracker = (ctx, requested, current) => {
  if (val(current, 'name') !== val(requested, 'name'))
    add(ctx, {
      verb: 'updated',
      oldValue: text(val(current, 'name')),
      newValue: text(val(requested, 'name')),
      field: 'name',
      comment: 'updated the name to'
    })
}

/** PD-1139 */
export const trackDescription: Tracker = async (ctx, requested, current) => {
  if (val(current, 'description_html') === val(requested, 'description_html')) return
  const [last] = ctx.issueId
    ? await ctx.db
        .select({ id: issueActivities.id, field: issueActivities.field, actorId: issueActivities.actorId })
        .from(issueActivities)
        .where(eq(issueActivities.issueId, ctx.issueId))
        .orderBy(desc(issueActivities.createdAt), desc(issueActivities.id))
        .limit(1)
    : []
  // Consecutive description edits by the same actor only refresh the timestamp of the last activity.
  if (last && last.field === 'description' && last.actorId === ctx.actorId) {
    await ctx.db.update(issueActivities).set({ createdAt: new Date() }).where(eq(issueActivities.id, last.id))
    return
  }
  add(ctx, {
    verb: 'updated',
    oldValue: text(val(current, 'description_html')),
    newValue: text(val(requested, 'description_html')),
    field: 'description',
    comment: 'updated the description to'
  })
}

/** PD-1140 */
export const trackParent: Tracker = async (ctx, requested, current) => {
  const cur = val(current, 'parent_id') || val(current, 'parent') || null
  const req = val(requested, 'parent_id') || val(requested, 'parent') || null
  const curId = toId(cur)
  const reqId = toId(req)
  if ((cur !== null && curId === null) || (req !== null && reqId === null)) return
  if (curId === reqId) return
  const oldParent = curId === null ? null : await issueRef(ctx, curId)
  const newParent = reqId === null ? null : await issueRef(ctx, reqId)
  if (reqId !== null && !newParent) return
  add(ctx, {
    verb: 'updated',
    oldValue: oldParent ? `${oldParent.identifier}-${oldParent.sequenceId}` : '',
    newValue: newParent ? `${newParent.identifier}-${newParent.sequenceId}` : '',
    field: 'parent',
    comment: 'updated the parent issue to',
    oldIdentifier: oldParent?.id ?? null,
    newIdentifier: newParent?.id ?? null
  })
}

/** PD-1141 */
export const trackPriority: Tracker = (ctx, requested, current) => {
  if (val(current, 'priority') !== val(requested, 'priority'))
    add(ctx, {
      verb: 'updated',
      oldValue: text(val(current, 'priority')),
      newValue: text(val(requested, 'priority')),
      field: 'priority',
      comment: 'updated the priority to'
    })
}

async function findState(ctx: ActivityContext, id: number | null) {
  if (id === null) return null
  const [row] = await ctx.db
    .select({ id: states.id, name: states.name })
    .from(states)
    .where(and(eq(states.id, id), eq(states.projectId, ctx.projectId), isNull(states.deletedAt)))
    .limit(1)
  return row ?? null
}

/** PD-1142 */
export const trackState: Tracker = async (ctx, requested, current) => {
  const curId = toId(val(current, 'state_id') || val(current, 'state'))
  const reqId = toId(val(requested, 'state_id') || val(requested, 'state'))
  if (curId === reqId) return
  const [newState, oldState] = [await findState(ctx, reqId), await findState(ctx, curId)]
  add(ctx, {
    verb: 'updated',
    oldValue: oldState?.name ?? null,
    newValue: newState?.name ?? null,
    field: 'state',
    comment: 'updated the state to',
    oldIdentifier: oldState?.id ?? null,
    newIdentifier: newState?.id ?? null
  })
}

/** PD-1143 */
export const trackTargetDate: Tracker = (ctx, requested, current) => {
  if (val(current, 'target_date') !== val(requested, 'target_date'))
    add(ctx, {
      verb: 'updated',
      oldValue: text(val(current, 'target_date')) ?? '',
      newValue: text(val(requested, 'target_date')) ?? '',
      field: 'target_date',
      comment: 'updated the target date to'
    })
}

/** PD-1144 */
export const trackStartDate: Tracker = (ctx, requested, current) => {
  if (val(current, 'start_date') !== val(requested, 'start_date'))
    add(ctx, {
      verb: 'updated',
      oldValue: text(val(current, 'start_date')) ?? '',
      newValue: text(val(requested, 'start_date')) ?? '',
      field: 'start_date',
      comment: 'updated the start date to '
    })
}

/** PD-1145 */
export const trackLabels: Tracker = async (ctx, requested, current) => {
  const requestedLabels = extractIds(requested, 'label_ids', 'labels')
  const currentLabels = extractIds(current, 'label_ids', 'labels')
  const find = async (raw: string) => {
    const id = toId(raw)
    if (id === null) return null
    const [row] = await ctx.db
      .select({ id: labels.id, name: labels.name })
      .from(labels)
      .where(and(eq(labels.id, id), eq(labels.projectId, ctx.projectId), isNull(labels.deletedAt)))
      .limit(1)
    return row ?? null
  }
  for (const raw of [...requestedLabels].filter(x => !currentLabels.has(x))) {
    const label = await find(raw)
    if (label)
      add(ctx, {
        verb: 'updated',
        field: 'labels',
        comment: 'added label ',
        oldValue: '',
        newValue: label.name,
        newIdentifier: label.id,
        oldIdentifier: null
      })
  }
  for (const raw of [...currentLabels].filter(x => !requestedLabels.has(x))) {
    const label = await find(raw)
    if (label)
      add(ctx, {
        verb: 'updated',
        field: 'labels',
        comment: 'removed label ',
        oldValue: label.name,
        newValue: '',
        oldIdentifier: label.id,
        newIdentifier: null
      })
  }
}

/** PD-1146 */
export const trackAssignees: Tracker = async (ctx, requested, current) => {
  const requestedAssignees = extractIds(requested, 'assignee_ids', 'assignees')
  const currentAssignees = extractIds(current, 'assignee_ids', 'assignees')
  const displayName = sql<string>`coalesce(${user.username}, ${user.name})`
  const subscribers: number[] = []
  for (const raw of [...requestedAssignees].filter(x => !currentAssignees.has(x))) {
    const id = toId(raw)
    if (id === null) continue
    // Same rule as the issue create serializer: active project members with role >= MEMBER (15).
    const [assignee] = await ctx.db
      .select({ id: user.id, name: displayName })
      .from(user)
      .innerJoin(projectMembers, eq(projectMembers.memberId, user.id))
      .where(
        and(
          eq(user.id, id),
          eq(projectMembers.projectId, ctx.projectId),
          gte(projectMembers.role, 15),
          eq(projectMembers.isActive, true),
          isNull(projectMembers.deletedAt)
        )
      )
      .limit(1)
    if (!assignee) continue
    add(ctx, {
      verb: 'updated',
      oldValue: '',
      newValue: assignee.name,
      field: 'assignees',
      comment: 'added assignee ',
      newIdentifier: assignee.id
    })
    subscribers.push(assignee.id)
  }
  if (ctx.issueId !== null)
    await bulkCreateSubscribers(ctx.db, ctx.issueId, ctx.projectId, ctx.workspaceId, subscribers)
  for (const raw of [...currentAssignees].filter(x => !requestedAssignees.has(x))) {
    const id = toId(raw)
    if (id === null) continue
    // Deactivated members can still be unassigned, so is_active is not required here.
    const [assignee] = await ctx.db
      .select({ id: user.id, name: displayName })
      .from(user)
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.memberId, user.id),
          eq(workspaceMembers.workspaceId, ctx.workspaceId),
          isNull(workspaceMembers.deletedAt)
        )
      )
      .where(eq(user.id, id))
      .limit(1)
    if (!assignee) continue
    add(ctx, {
      verb: 'updated',
      oldValue: assignee.name,
      newValue: '',
      field: 'assignees',
      comment: 'removed assignee ',
      oldIdentifier: assignee.id
    })
  }
}

/** Plane `IssueSubscriber.objects.bulk_create(..., batch_size=10, ignore_conflicts=True)`. */
export async function bulkCreateSubscribers(
  db: LancityDb,
  issueId: number,
  projectId: number,
  workspaceId: number,
  subscriberIds: number[]
): Promise<void> {
  const ids = [...new Set(subscriberIds)]
  for (let i = 0; i < ids.length; i += 10) {
    await db
      .insert(issueSubscribers)
      .values(
        ids.slice(i, i + 10).map(id => ({
          subscriberId: id,
          issueId,
          projectId,
          workspaceId,
          createdById: id,
          updatedById: id
        }))
      )
      .onConflictDoNothing()
  }
}

async function findEstimate(ctx: ActivityContext, id: number | null) {
  if (id === null) return null
  const [row] = await ctx.db
    .select({ id: estimatePoints.id, value: estimatePoints.value, type: estimates.type })
    .from(estimatePoints)
    .innerJoin(estimates, eq(estimates.id, estimatePoints.estimateId))
    .where(
      and(eq(estimatePoints.id, id), eq(estimatePoints.projectId, ctx.projectId), isNull(estimatePoints.deletedAt))
    )
    .limit(1)
  return row ?? null
}

/**
 * PD-1147. Plane builds the field as `estimate_<new_estimate.estimate.type>` and crashes when the estimate is
 * removed, so the whole task is lost. Here the old estimate's type is used for removals.
 */
export const trackEstimatePoints: Tracker = async (ctx, requested, current) => {
  const cur = val(current, 'estimate_point')
  const req = val(requested, 'estimate_point')
  if (cur === req) return
  const oldEstimate = await findEstimate(ctx, toId(cur))
  const newEstimate = await findEstimate(ctx, toId(req))
  if (req !== null && !newEstimate) return
  const type = (newEstimate ?? oldEstimate)?.type
  if (!type) return
  add(ctx, {
    verb: newEstimate ? 'updated' : 'removed',
    oldIdentifier: toId(cur),
    newIdentifier: toId(req),
    oldValue: oldEstimate?.value ?? null,
    newValue: newEstimate?.value ?? null,
    field: `estimate_${type}`,
    comment: 'updated the estimate point to '
  })
}

/** PD-1148 */
export const trackArchiveAt: Tracker = (ctx, requested, current) => {
  if (val(current, 'archived_at') === val(requested, 'archived_at')) return
  if (val(requested, 'archived_at') === null) {
    add(ctx, {
      verb: 'updated',
      field: 'archived_at',
      oldValue: 'archive',
      newValue: 'restore',
      comment: 'has restored the issue'
    })
    return
  }
  const automation = Boolean(val(requested, 'automation'))
  add(ctx, {
    verb: 'updated',
    field: 'archived_at',
    oldValue: null,
    newValue: automation ? 'archive' : 'manual_archive',
    comment: automation ? 'Plane has archived the issue' : 'Actor has archived the issue'
  })
}

/** PD-1149. A missing state is skipped (Plane raises and loses the task). */
export const trackClosedTo: Tracker = async (ctx, requested) => {
  if (val(requested, 'closed_to') === null) return
  const state = await findState(ctx, toId(val(requested, 'closed_to')))
  if (!state) return
  add(ctx, {
    verb: 'updated',
    oldValue: null,
    newValue: state.name,
    field: 'state',
    comment: 'Plane updated the state to ',
    oldIdentifier: null,
    newIdentifier: state.id
  })
}

/** PD-1150 */
export const createIssueActivity: Tracker = async (ctx, requested, current) => {
  if (ctx.issueId === null) return
  const [issue] = await ctx.db
    .select({ createdAt: issues.createdAt, createdById: issues.createdById })
    .from(issues)
    .where(eq(issues.id, ctx.issueId))
    .limit(1)
  if (!issue) return
  add(ctx, {
    verb: 'created',
    comment: 'created the issue',
    createdAt: issue.createdAt,
    actorId: issue.createdById ?? ctx.actorId
  })
  if (val(requested, 'assignee_ids') !== null) await trackAssignees(ctx, requested, current)
}

const ISSUE_ACTIVITY_MAPPER: Record<string, Tracker> = {
  name: trackName,
  parent_id: trackParent,
  priority: trackPriority,
  state_id: trackState,
  description_html: trackDescription,
  target_date: trackTargetDate,
  start_date: trackStartDate,
  label_ids: trackLabels,
  assignee_ids: trackAssignees,
  estimate_point: trackEstimatePoints,
  archived_at: trackArchiveAt,
  closed_to: trackClosedTo,
  // External endpoint keys
  parent: trackParent,
  state: trackState,
  assignees: trackAssignees,
  labels: trackLabels
}

/** PD-1151. A tracker mapped by two keys (`state_id` and `state`) runs once. */
export const updateIssueActivity: Tracker = async (ctx, requested, current) => {
  const done = new Set<Tracker>()
  for (const key of Object.keys(requested ?? {})) {
    const tracker = ISSUE_ACTIVITY_MAPPER[key]
    if (!tracker || done.has(tracker)) continue
    done.add(tracker)
    await tracker(ctx, requested, current)
  }
}

/** PD-1152 */
export const deleteIssueActivity: Tracker = ctx =>
  add(ctx, { verb: 'deleted', field: 'issue', comment: 'deleted the issue' })

/** PD-1153 */
export const createCommentActivity: Tracker = (ctx, requested) => {
  const id = toId(val(requested, 'id'))
  add(ctx, {
    verb: 'created',
    field: 'comment',
    comment: 'created a comment',
    newValue: text(val(requested, 'comment_html')) ?? '',
    newIdentifier: id,
    issueCommentId: id
  })
}

/** PD-1154 */
export const updateCommentActivity: Tracker = (ctx, requested, current) => {
  // Only a change to the comment HTML is recorded; payloads without it (for example access only) are not.
  if (!requested || !('comment_html' in requested) || val(current, 'comment_html') === requested.comment_html) return
  const id = toId(val(current, 'id'))
  add(ctx, {
    verb: 'updated',
    field: 'comment',
    comment: 'updated a comment',
    oldValue: text(val(current, 'comment_html')) ?? '',
    oldIdentifier: id,
    newValue: text(requested.comment_html) ?? '',
    newIdentifier: id,
    issueCommentId: id
  })
}

/** PD-1155 */
export const deleteCommentActivity: Tracker = (ctx, requested) =>
  add(ctx, {
    verb: 'deleted',
    field: 'comment',
    comment: 'deleted the comment',
    issueCommentId: toId(val(requested, 'comment_id'))
  })

function asRecords(value: unknown): Data[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  return Array.isArray(parsed) ? parsed.filter((x): x is Data => !!x && typeof x === 'object') : []
}

async function findCycle(ctx: ActivityContext, id: number | null) {
  if (id === null) return null
  const [row] = await ctx.db
    .select({ id: cycles.id, name: cycles.name })
    .from(cycles)
    .where(and(eq(cycles.id, id), eq(cycles.projectId, ctx.projectId), isNull(cycles.deletedAt)))
    .limit(1)
  return row ?? null
}

/** PD-1156. `created_cycle_issues` keeps the Django serializer shape (`{fields: {cycle, issue}}`). */
export const createCycleIssueActivity: Tracker = async (ctx, _requested, current) => {
  for (const record of asRecords(val(current, 'updated_cycle_issues'))) {
    const issueId = toId(record.issue_id)
    const oldCycle = await findCycle(ctx, toId(record.old_cycle_id))
    const newCycle = await findCycle(ctx, toId(record.new_cycle_id))
    if (!(await touchIssue(ctx, issueId))) continue
    add(ctx, {
      issueId,
      verb: 'updated',
      oldValue: oldCycle?.name ?? '',
      newValue: newCycle?.name ?? '',
      field: 'cycles',
      comment: `updated cycle from ${oldCycle?.name ?? ''}\n                to ${newCycle?.name ?? ''}`,
      oldIdentifier: oldCycle?.id ?? null,
      newIdentifier: newCycle?.id ?? null
    })
  }
  for (const record of asRecords(val(current, 'created_cycle_issues'))) {
    const fields = (record.fields as Data | undefined) ?? record
    const issueId = toId(fields.issue ?? fields.issue_id)
    const cycle = await findCycle(ctx, toId(fields.cycle ?? fields.cycle_id))
    if (!cycle || !(await touchIssue(ctx, issueId))) continue
    add(ctx, {
      issueId,
      verb: 'created',
      oldValue: '',
      newValue: cycle.name,
      field: 'cycles',
      comment: `added cycle ${cycle.name}`,
      newIdentifier: cycle.id
    })
  }
}

/** PD-1157 */
export const deleteCycleIssueActivity: Tracker = async (ctx, requested) => {
  const cycleId = toId(val(requested, 'cycle_id'))
  const cycleName = text(val(requested, 'cycle_name')) ?? ''
  const cycle = await findCycle(ctx, cycleId)
  const listed = requested?.issues
  for (const raw of Array.isArray(listed) ? listed : []) {
    const issueId = toId(raw)
    if (!(await touchIssue(ctx, issueId))) continue
    const name = cycle?.name ?? cycleName
    add(ctx, {
      issueId,
      verb: 'deleted',
      oldValue: name,
      newValue: '',
      field: 'cycles',
      comment: `removed this issue from ${name}`,
      oldIdentifier: cycleId
    })
  }
}

/** PD-1158 */
export const createModuleIssueActivity: Tracker = async (ctx, requested) => {
  const moduleId = toId(val(requested, 'module_id'))
  const [mod] = moduleId
    ? await ctx.db
        .select({ id: modules.id, name: modules.name })
        .from(modules)
        .where(and(eq(modules.id, moduleId), eq(modules.projectId, ctx.projectId), isNull(modules.deletedAt)))
        .limit(1)
    : []
  if (!mod || !(await touchIssue(ctx, ctx.issueId))) return
  add(ctx, {
    verb: 'created',
    oldValue: '',
    newValue: mod.name,
    field: 'modules',
    comment: `added module ${mod.name}`,
    newIdentifier: moduleId
  })
}

/** PD-1159 */
export const deleteModuleIssueActivity: Tracker = async (ctx, requested, current) => {
  const moduleName = text(val(current, 'module_name'))
  const exists = await touchIssue(ctx, ctx.issueId)
  if (ctx.issueId !== null && !exists) return
  add(ctx, {
    verb: 'deleted',
    oldValue: moduleName,
    newValue: '',
    field: 'modules',
    comment: `removed this issue from ${moduleName}`,
    oldIdentifier: toId(val(requested, 'module_id'))
  })
}

/** PD-1160 */
export const createLinkActivity: Tracker = (ctx, requested) =>
  add(ctx, {
    verb: 'created',
    field: 'link',
    comment: 'created a link',
    newValue: text(val(requested, 'url')) ?? '',
    newIdentifier: toId(val(requested, 'id'))
  })

/** PD-1161 */
export const updateLinkActivity: Tracker = (ctx, requested, current) => {
  if (val(current, 'url') === val(requested, 'url')) return
  const id = toId(val(current, 'id'))
  add(ctx, {
    verb: 'updated',
    field: 'link',
    comment: 'updated a link',
    oldValue: text(val(current, 'url')) ?? '',
    oldIdentifier: id,
    newValue: text(val(requested, 'url')) ?? '',
    newIdentifier: id
  })
}

/** PD-1162 */
export const deleteLinkActivity: Tracker = (ctx, _requested, current) =>
  add(ctx, {
    verb: 'deleted',
    field: 'link',
    comment: 'deleted the link',
    oldValue: text(val(current, 'url')) ?? '',
    newValue: ''
  })

/** PD-1163 */
export const createAttachmentActivity: Tracker = (ctx, _requested, current) =>
  add(ctx, {
    verb: 'created',
    field: 'attachment',
    comment: 'created an attachment',
    newValue: text(val(current, 'asset')) ?? '',
    newIdentifier: toId(val(current, 'id'))
  })

/** PD-1164 */
export const deleteAttachmentActivity: Tracker = ctx =>
  add(ctx, { verb: 'deleted', field: 'attachment', comment: 'deleted the attachment' })

/** PD-1165 */
export const createIssueReactionActivity: Tracker = async (ctx, requested) => {
  const reaction = text(val(requested, 'reaction'))
  if (!reaction || ctx.actorId === null) return
  const [row] = await ctx.db
    .select({ id: issueReactions.id })
    .from(issueReactions)
    .where(
      and(
        eq(issueReactions.reaction, reaction),
        eq(issueReactions.projectId, ctx.projectId),
        eq(issueReactions.actorId, ctx.actorId),
        isNull(issueReactions.deletedAt)
      )
    )
    .orderBy(desc(issueReactions.id))
    .limit(1)
  if (!row) return
  add(ctx, {
    verb: 'created',
    oldValue: null,
    newValue: reaction,
    field: 'reaction',
    comment: 'added the reaction',
    oldIdentifier: null,
    newIdentifier: row.id
  })
}

/** PD-1166 */
export const deleteIssueReactionActivity: Tracker = (ctx, _requested, current) => {
  if (val(current, 'reaction') === null) return
  add(ctx, {
    verb: 'deleted',
    oldValue: text(val(current, 'reaction')),
    newValue: null,
    field: 'reaction',
    comment: 'removed the reaction',
    oldIdentifier: toId(val(current, 'identifier')),
    newIdentifier: null
  })
}

/** PD-1167 */
export const createCommentReactionActivity: Tracker = async (ctx, requested) => {
  const reaction = text(val(requested, 'reaction'))
  if (!reaction || ctx.actorId === null) return
  const [row] = await ctx.db
    .select({ id: commentReactions.id, issueId: issueComments.issueId })
    .from(commentReactions)
    .innerJoin(issueComments, eq(issueComments.id, commentReactions.commentId))
    .where(
      and(
        eq(commentReactions.reaction, reaction),
        eq(commentReactions.projectId, ctx.projectId),
        eq(commentReactions.actorId, ctx.actorId),
        eq(issueComments.projectId, ctx.projectId),
        isNull(commentReactions.deletedAt)
      )
    )
    .orderBy(desc(commentReactions.id))
    .limit(1)
  if (!row) return
  add(ctx, {
    issueId: row.issueId,
    verb: 'created',
    oldValue: null,
    newValue: reaction,
    field: 'reaction',
    comment: 'added the reaction',
    oldIdentifier: null,
    newIdentifier: row.id
  })
}

/** PD-1168 */
export const deleteCommentReactionActivity: Tracker = async (ctx, _requested, current) => {
  if (val(current, 'reaction') === null) return
  const commentId = toId(val(current, 'comment_id'))
  const [comment] = commentId
    ? await ctx.db
        .select({ issueId: issueComments.issueId })
        .from(issueComments)
        .where(and(eq(issueComments.id, commentId), eq(issueComments.projectId, ctx.projectId)))
        .limit(1)
    : []
  if (!comment) return
  add(ctx, {
    issueId: comment.issueId,
    verb: 'deleted',
    oldValue: text(val(current, 'reaction')),
    newValue: null,
    field: 'reaction',
    comment: 'removed the reaction',
    oldIdentifier: toId(val(current, 'identifier')),
    newIdentifier: null
  })
}

/** PD-1169 */
export const createIssueVoteActivity: Tracker = (ctx, requested) => {
  if (val(requested, 'vote') === null) return
  add(ctx, {
    verb: 'updated',
    oldValue: null,
    newValue: text(val(requested, 'vote')),
    field: 'vote',
    comment: 'added the vote',
    oldIdentifier: null,
    newIdentifier: null
  })
}

/** PD-1170 */
export const deleteIssueVoteActivity: Tracker = (ctx, _requested, current) => {
  if (val(current, 'vote') === null) return
  add(ctx, {
    verb: 'deleted',
    oldValue: text(val(current, 'vote')),
    newValue: null,
    field: 'vote',
    comment: 'removed the vote',
    oldIdentifier: toId(val(current, 'identifier')),
    newIdentifier: null
  })
}

/** Plane `get_inverse_relation` (utils/issue_relation_mapper.py). */
export function getInverseRelation(relationType: string): string {
  const mapping: Record<string, string> = {
    start_after: 'start_before',
    finish_after: 'finish_before',
    blocked_by: 'blocking',
    blocking: 'blocked_by',
    start_before: 'start_after',
    finish_before: 'finish_after',
    implemented_by: 'implements',
    implements: 'implemented_by'
  }
  return mapping[relationType] ?? relationType
}

/**
 * PD-1171. The reverse activity is stored with the related issue's own project, because the issue/project
 * foreign key rejects the current project when the relation spans projects (Plane allows cross-project relations).
 */
export const createIssueRelationActivity: Tracker = async (ctx, requested, current) => {
  const related = requested?.issues
  if (current !== null || !Array.isArray(related) || ctx.issueId === null) return
  const currentIssue = await issueRef(ctx, ctx.issueId, 'workspace')
  if (!currentIssue || currentIssue.projectId !== ctx.projectId) return
  const relationType = text(val(requested, 'relation_type')) ?? ''
  const inverse = getInverseRelation(relationType)
  for (const raw of related) {
    const relatedId = toId(raw)
    const issue = relatedId === null ? null : await issueRef(ctx, relatedId, 'workspace')
    if (!issue || relatedId === null) continue
    add(ctx, {
      verb: 'updated',
      oldValue: '',
      newValue: `${issue.identifier}-${issue.sequenceId}`,
      field: relationType,
      comment: `added ${relationType} relation`,
      oldIdentifier: relatedId
    })
    add(ctx, {
      issueId: relatedId,
      projectId: issue.projectId,
      verb: 'updated',
      oldValue: '',
      newValue: `${currentIssue.identifier}-${currentIssue.sequenceId}`,
      field: inverse,
      comment: `added ${inverse} relation`,
      oldIdentifier: ctx.issueId
    })
  }
}

/** PD-1172 */
export const deleteIssueRelationActivity: Tracker = async (ctx, requested) => {
  const relatedId = toId(val(requested, 'related_issue'))
  const currentIssue = ctx.issueId === null ? null : await issueRef(ctx, ctx.issueId, 'workspace')
  const issue = relatedId === null ? null : await issueRef(ctx, relatedId, 'workspace')
  if (!currentIssue || currentIssue.projectId !== ctx.projectId || !issue || relatedId === null) return
  const relationType = text(val(requested, 'relation_type')) ?? ''
  add(ctx, {
    verb: 'deleted',
    oldValue: `${issue.identifier}-${issue.sequenceId}`,
    newValue: '',
    field: relationType,
    comment: `deleted ${relationType} relation`,
    oldIdentifier: relatedId
  })
  add(ctx, {
    issueId: relatedId,
    projectId: issue.projectId,
    verb: 'deleted',
    oldValue: `${currentIssue.identifier}-${currentIssue.sequenceId}`,
    newValue: '',
    field: relationType === 'blocked_by' ? 'blocking' : relationType === 'blocking' ? 'blocked_by' : relationType,
    comment: `deleted ${relationType} relation`,
    oldIdentifier: relatedId
  })
}

/** PD-1173 */
export const createDraftIssueActivity: Tracker = ctx =>
  add(ctx, { verb: 'created', field: 'draft', comment: 'drafted the issue' })

/** PD-1174 */
export const updateDraftIssueActivity: Tracker = (ctx, requested) => {
  if (val(requested, 'is_draft') === false) add(ctx, { verb: 'updated', comment: 'created the issue' })
  else add(ctx, { verb: 'updated', field: 'draft', comment: 'updated the draft issue' })
}

/** PD-1175 */
export const deleteDraftIssueActivity: Tracker = ctx =>
  add(ctx, { verb: 'deleted', field: 'draft', comment: 'deleted the draft issue' })

const INTAKE_STATUS: Record<number, string> = {
  [-2]: 'Pending',
  [-1]: 'Rejected',
  0: 'Snoozed',
  1: 'Accepted',
  2: 'Duplicate'
}

/** PD-1176. As in Plane the verb of the row is the status value. */
export const createIntakeActivity: Tracker = (ctx, requested, current) => {
  const status = val(requested, 'status')
  if (status === null) return
  const old = val(current, 'status')
  add(ctx, {
    verb: String(status),
    field: 'intake',
    comment: 'updated the intake status',
    oldValue: typeof old === 'number' ? (INTAKE_STATUS[old] ?? null) : null,
    newValue: typeof status === 'number' ? (INTAKE_STATUS[status] ?? null) : null
  })
}

export const ACTIVITY_MAPPER: Record<string, Tracker> = {
  'issue.activity.created': createIssueActivity,
  'issue.activity.updated': updateIssueActivity,
  'issue.activity.deleted': deleteIssueActivity,
  'comment.activity.created': createCommentActivity,
  'comment.activity.updated': updateCommentActivity,
  'comment.activity.deleted': deleteCommentActivity,
  'cycle.activity.created': createCycleIssueActivity,
  'cycle.activity.deleted': deleteCycleIssueActivity,
  'module.activity.created': createModuleIssueActivity,
  'module.activity.deleted': deleteModuleIssueActivity,
  'link.activity.created': createLinkActivity,
  'link.activity.updated': updateLinkActivity,
  'link.activity.deleted': deleteLinkActivity,
  'attachment.activity.created': createAttachmentActivity,
  'attachment.activity.deleted': deleteAttachmentActivity,
  'issue_relation.activity.created': createIssueRelationActivity,
  'issue_relation.activity.deleted': deleteIssueRelationActivity,
  'issue_reaction.activity.created': createIssueReactionActivity,
  'issue_reaction.activity.deleted': deleteIssueReactionActivity,
  'comment_reaction.activity.created': createCommentReactionActivity,
  'comment_reaction.activity.deleted': deleteCommentReactionActivity,
  'issue_vote.activity.created': createIssueVoteActivity,
  'issue_vote.activity.deleted': deleteIssueVoteActivity,
  'issue_draft.activity.created': createDraftIssueActivity,
  'issue_draft.activity.updated': updateDraftIssueActivity,
  'issue_draft.activity.deleted': deleteDraftIssueActivity,
  'intake.activity.created': createIntakeActivity
}

/** Drop rows that would break the issue or comment foreign keys (for example a hard-deleted issue). */
async function withExistingTargets(ctx: ActivityContext): Promise<NewActivity[]> {
  const issueIds = [...new Set(ctx.activities.map(a => a.issueId).filter((x): x is number => typeof x === 'number'))]
  const commentIds = [
    ...new Set(ctx.activities.map(a => a.issueCommentId).filter((x): x is number => typeof x === 'number'))
  ]
  const found = async (table: typeof issues | typeof issueComments, ids: number[]) => {
    const live = new Set<number>()
    for (let i = 0; i < ids.length; i += 50) {
      const rows = await ctx.db
        .select({ id: table.id, projectId: table.projectId })
        .from(table)
        .where(inArray(table.id, ids.slice(i, i + 50)))
      for (const row of rows) live.add(row.projectId * 1e9 + row.id)
    }
    return live
  }
  const [issueKeys, commentKeys] = [await found(issues, issueIds), await found(issueComments, commentIds)]
  return ctx.activities.filter(
    a =>
      (a.issueId == null || issueKeys.has(a.projectId * 1e9 + a.issueId)) &&
      (a.issueCommentId == null || commentKeys.has(a.projectId * 1e9 + a.issueCommentId))
  )
}

/**
 * Insert all activities in one atomic D1 batch (5 rows per statement keeps under the 100-variable limit). The claim
 * of the job goes into the same batch, so a redelivery either finds all rows and the claim, or neither.
 */
async function saveActivities(ctx: ActivityContext, claimKey: string | null, jobId?: string) {
  const rows = await withExistingTargets(ctx)
  if (!rows.length) return []
  const statements = []
  for (let i = 0; i < rows.length; i += 4)
    statements.push(
      ctx.db
        .insert(issueActivities)
        .values(rows.slice(i, i + 4).map(row => ({ ...row, mutationId: jobId ?? null })))
        .returning()
    )
  const rowStatements = statements.length
  if (claimKey) statements.push(jobClaimStatement(ctx.db, claimKey) as unknown as (typeof statements)[number])
  const results = await ctx.db.batch(
    statements as unknown as [(typeof statements)[number], ...(typeof statements)[number][]]
  )
  return (results.slice(0, rowStatements) as unknown as (typeof issueActivities.$inferSelect)[][]).flat()
}

/** Seconds before the job epoch in which a service may have written the rows it announced with `activityRecorded`. */
const RECORDED_WINDOW_SECONDS = 5

/**
 * Activity rows a service stored right before it queued the job. Services stamp `epoch` with the database clock,
 * so rows of the same actor and issue in a short window ending at the job epoch belong to this event.
 */
async function loadRecordedActivities(ctx: ActivityContext) {
  if (!ctx.issueId || !ctx.actorId || ctx.epoch === null) return []
  return ctx.db
    .select()
    .from(issueActivities)
    .where(
      and(
        eq(issueActivities.issueId, ctx.issueId),
        eq(issueActivities.projectId, ctx.projectId),
        eq(issueActivities.actorId, ctx.actorId),
        isNull(issueActivities.mutationId),
        gte(issueActivities.epoch, ctx.epoch - RECORDED_WINDOW_SECONDS),
        lte(issueActivities.epoch, ctx.epoch + 1)
      )
    )
    .orderBy(asc(issueActivities.id))
}

/** Activity rows already stored by an earlier delivery of the job `jobId` (it claimed them when it stored them). */
async function rowsClaimedBy(db: LancityDb, jobId: string) {
  const ids = await claimedActivityIds(db, jobId)
  const rows: (typeof issueActivities.$inferSelect)[] = []
  for (let i = 0; i < ids.length; i += 80)
    rows.push(...(await db.select().from(issueActivities).where(inArray(issueActivities.id, ids.slice(i, i + 80)))))
  return rows.sort((a, b) => a.id - b.id)
}

/**
 * Plane `issue_activity` Celery task (PD-1177). Returns the stored activities.
 * `jobId` is the id of the queue message. Queues deliver at least once, so the job is safe to run again: stored rows
 * are claimed in the batch that writes them, and the notification and webhook jobs get ids derived from `jobId`.
 */
export async function issueActivity(env: InfraEnv, raw: unknown, jobId?: string) {
  const parsed = issueActivityJobSchema.safeParse(raw)
  if (!parsed.success) {
    logIssueJob('error', 'issue.activity', {
      message: 'Invalid payload',
      issues: parsed.error.issues.map(i => i.message)
    })
    return []
  }
  const p = parsed.data
  const db = drizzle(env.DB, { schema }) as unknown as LancityDb
  const [project] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, p.projectId))
    .limit(1)
  if (!project) return []
  const ctx: ActivityContext = {
    db,
    issueId: p.issueId ?? null,
    projectId: p.projectId,
    workspaceId: project.workspaceId,
    actorId: p.actorId ?? null,
    epoch: p.epoch ?? null,
    activities: []
  }
  if (p.activityRecorded) {
    // The service wrote the rows in its mutation batch. Read them back instead of inserting a second copy.
    const candidates = p.mutationId
      ? await db.select().from(issueActivities).where(eq(issueActivities.mutationId, p.mutationId)).orderBy(asc(issueActivities.id))
      : await loadRecordedActivities(ctx)
    // A row belongs to one job only, so a later job of the same actor does not notify an earlier event again.
    const recorded = jobId ? await claimActivityRows(db, jobId, candidates) : candidates
    if (recorded.length) await dispatchHooks(env, p, ctx, recorded, jobId)
    return recorded
  }
  const claimKey = jobId ? `${ISSUE_JOB.activity}:${jobId}` : null
  const claim = claimKey ? await checkJobClaim(db, claimKey) : { done: false, available: false }
  if (claim.done && jobId) {
    // An earlier delivery stored the rows. Fan out again: the child jobs have fixed ids, so this cannot duplicate.
    const byMutation = await db.select().from(issueActivities).where(eq(issueActivities.mutationId, jobId)).orderBy(asc(issueActivities.id))
    const stored = byMutation.length ? byMutation : await rowsClaimedBy(db, jobId)
    if (stored.length) await dispatchHooks(env, p, ctx, stored, jobId)
    return stored
  }
  try {
    await touchIssue(ctx, ctx.issueId)
    const tracker = ACTIVITY_MAPPER[p.type]
    // Payload errors are logged and dropped like Plane, so the queue does not retry a task that can never succeed.
    if (tracker) await tracker(ctx, parseJsonObject(p.requestedData), parseJsonObject(p.currentInstance))
  } catch (error) {
    logIssueJob('error', 'issue.activity', {
      type: p.type,
      message: error instanceof Error ? error.message : String(error)
    })
    return []
  }
  let created: (typeof issueActivities.$inferSelect)[]
  try { created = await saveActivities(ctx, claim.available ? claimKey : null, jobId) }
  catch (error) {
    if (!jobId || !isClaimConflict(error)) throw error
    created = await db.select().from(issueActivities).where(eq(issueActivities.mutationId, jobId)).orderBy(asc(issueActivities.id))
  }
  if (!created.length) return created
  // Record which rows belong to this job, so a redelivery can rebuild the fan-out.
  const owned = jobId ? await claimActivityRows(db, jobId, created) : created
  await dispatchHooks(env, p, ctx, owned, jobId)
  return created
}

const MAX_NOTIFICATION_BYTES = 100_000

/** Notification and webhook hooks. Failures are logged because the activities are already stored. */
async function dispatchHooks(
  env: InfraEnv,
  p: ReturnType<typeof issueActivityJobSchema.parse>,
  ctx: ActivityContext,
  created: (typeof issueActivities.$inferSelect)[],
  jobId?: string
) {
  // Fixed child ids: if this job is delivered again the same child jobs are enqueued and their handlers skip them.
  const childId = (suffix: string) => (jobId ? `${jobId}:${suffix}` : undefined)
  try {
    if (p.notification) {
      let activities: Record<string, unknown>[] = created.map(a => ({
        ...a,
        createdAt: a.createdAt?.toISOString(),
        updatedAt: a.updatedAt?.toISOString(),
        deletedAt: null
      }))
      let truncated = false
      // Queue messages are limited to 128 KB. The consumer can reload the full rows by id when truncated.
      if (JSON.stringify(activities).length > MAX_NOTIFICATION_BYTES) {
        activities = activities.map(a => ({ ...a, oldValue: null, newValue: null }))
        truncated = true
      }
      const notificationPayload = {
          type: p.type,
          issueId: ctx.issueId,
          actorId: ctx.actorId,
          projectId: ctx.projectId,
          subscriber: p.subscriber,
          issueActivitiesCreated: activities,
          truncated,
          requestedData: parseJsonObject(p.requestedData),
          currentInstance: parseJsonObject(p.currentInstance)
      }
      if (jobId) await enqueueOutboxChild(ctx.db, `${jobId}:notification`, NOTIFICATION_ISSUE_JOB, notificationPayload, env)
      else await enqueueJob(env, { type: NOTIFICATION_ISSUE_JOB, payload: notificationPayload })
    }
    if (p.webhook)
      await enqueueJob(env, {
        id: childId('webhook'),
        type: WEBHOOK_DISPATCH_JOB,
        payload: {
          source: ISSUE_JOB.activity,
          type: p.type,
          issueId: ctx.issueId,
          projectId: ctx.projectId,
          workspaceId: ctx.workspaceId,
          actorId: ctx.actorId,
          activityIds: created.map(a => a.id)
        }
      })
  } catch (error) {
    logIssueJob('error', 'issue.activity.hooks', { message: error instanceof Error ? error.message : String(error) })
    throw error
  }
}
