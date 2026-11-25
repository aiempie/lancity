import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import {
  issues,
  issueSequences,
  projectIssueCounters,
  states,
  labels,
  issueComments,
  issueActivities,
  issueVersions,
  issueLabels,
  issueAssignees,
  issueSubscribers
} from '@/db/schema/issue'
import { user } from '@/db/schema/auth'
import { projectMembers, workspaceMembers } from '@/db/schema/workspace'
import { parseInput } from '@/server/api/v1/validation'
import { ServiceError } from '@/server/common/errors'
import { toPlaneData } from '@/server/issue/events'
import { outboxStatement, publishOutbox } from '@/server/common/outbox'
import type { InfraEnv } from '@/server/common/env'

import {
  activityStatement,
  assigneeActivitiesStatement,
  assigneeSubscribersStatement,
  commentActivityStatement,
  estimateActivity,
  issueIdentifierLabel,
  versionStatement
} from '@/server/issue/jobs/history'
import {
  createdIssueIdSql,
  currentSequenceSql,
  newIssueSortOrderSql,
  nextSequenceSql,
  sanitizeDescriptionHtml,
  stripTags
} from '@/server/issue/sequence'
import { resolveInitialIssueState, resolveIssueCompletionTime } from '@/server/issue/state'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import {
  createIssueInputSchema,
  updateIssueInputSchema,
  createCommentInputSchema,
  type UpdateIssueInput,
  type CreateIssueInput,
  type CreateCommentInput
} from '@/types/issue/schema'

export {
  listStates,
  getState,
  createState,
  updateState,
  deleteState,
  markAsDefaultState,
  getIntakeState,
  getWorkspaceStates
} from '@/server/issue/state'
export { listLabels, getLabel, createLabel, updateLabel, deleteLabel } from '@/server/issue/label'

/**
 * Recheck write access in the same SQLite statement as the mutation.
 * With `issueId`, the issue's creator may also write (Plane `allow_permission(creator=True)`), as long as they
 * are still an active project member.
 */
export function writableProject(actor: Actor, slug: string, projectId: number, issueId?: number) {
  return sql`exists (select 1 from projects p
    join workspaces w on w.id = p.workspace_id
    join workspace_members wm on wm.workspace_id = w.id and wm.member_id = ${actor.userId}
    join project_members pm on pm.project_id = p.id and pm.workspace_id = w.id and pm.member_id = ${actor.userId}
    where p.id = ${projectId} and w.slug = ${slug} and p.deleted_at is null and w.deleted_at is null
      and wm.is_active = 1 and wm.deleted_at is null and pm.is_active = 1 and pm.deleted_at is null
      and (wm.role = 20 or pm.role >= 15 or (${issueId ?? null} is not null
        and exists (select 1 from issues ci where ci.id = ${issueId ?? null} and ci.created_by_id = ${actor.userId}))))`
}
/** Delete rule of `IssueViewSet.destroy`: a project or workspace admin, or the creator. */
function deletableIssue(actor: Actor, slug: string, projectId: number, issueId: number) {
  return sql`exists (select 1 from projects p
    join workspaces w on w.id = p.workspace_id
    join workspace_members wm on wm.workspace_id = w.id and wm.member_id = ${actor.userId}
    join project_members pm on pm.project_id = p.id and pm.workspace_id = w.id and pm.member_id = ${actor.userId}
    where p.id = ${projectId} and w.slug = ${slug} and p.deleted_at is null and w.deleted_at is null
      and wm.is_active = 1 and wm.deleted_at is null and pm.is_active = 1 and pm.deleted_at is null
      and (wm.role = 20 or pm.role = 20
        or exists (select 1 from issues ci where ci.id = ${issueId} and ci.created_by_id = ${actor.userId})))`
}
function validState(stateId: number | null, projectId: number) {
  return sql`(${stateId} is null or exists (select 1 from states s where s.id = ${stateId} and s.project_id = ${projectId} and s.deleted_at is null and s.is_triage = 0))`
}
function validParent(parentId: number | null, projectId: number) {
  return sql`(${parentId} is null or exists (select 1 from issues p where p.id = ${parentId} and p.project_id = ${projectId} and p.deleted_at is null and p.archived_at is null and p.is_draft = 0))`
}

async function assertState(db: LancityDb, stateId: number | null | undefined, projectId: number) {
  if (!stateId) return
  const [state] = await db
    .select({ id: states.id })
    .from(states)
    .where(
      and(eq(states.id, stateId), eq(states.projectId, projectId), eq(states.isTriage, false), isNull(states.deletedAt))
    )
  if (!state) throw new ServiceError(400, 'INVALID_STATE', 'State does not belong to this project')
}

async function assertParent(db: LancityDb, parentId: number | null | undefined, projectId: number, issueId?: number) {
  if (!parentId) return
  if (parentId === issueId) throw new ServiceError(400, 'INVALID_PARENT', 'An issue cannot be its own parent')
  const [parent] = await db
    .select({ id: issues.id })
    .from(issues)
    .where(
      and(
        eq(issues.id, parentId),
        eq(issues.projectId, projectId),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt),
        eq(issues.isDraft, false)
      )
    )
  if (!parent) throw new ServiceError(400, 'INVALID_PARENT', 'Parent issue does not belong to this project')
  if (issueId) {
    // Walk up from the new parent: reaching the issue itself would create a cycle.
    const [loop] = await db.all<{ id: number }>(sql`with recursive up(id) as (
      select ${parentId} union select i.parent_id from issues i join up on i.id = up.id where i.parent_id is not null
    ) select id from up where id = ${issueId} limit 1`)
    if (loop) throw new ServiceError(400, 'INVALID_PARENT', 'Parent issue is a descendant of this issue')
  }
}

async function assertEstimateAndType(
  db: LancityDb,
  projectId: number,
  workspaceId: number,
  estimatePointId?: number | null,
  typeId?: number | null
) {
  if (estimatePointId) {
    const [point] = await db.all<{ id: number }>(
      sql`select id from estimate_points where id = ${estimatePointId} and project_id = ${projectId} and deleted_at is null`
    )
    if (!point)
      throw new ServiceError(400, 'INVALID_ESTIMATE_POINT', 'Estimate point is not valid please pass a valid estimate_point_id')
  }
  if (typeId) {
    const [type] = await db.all<{ id: number }>(
      sql`select id from issue_types where id = ${typeId} and workspace_id = ${workspaceId} and deleted_at is null`
    )
    if (!type) throw new ServiceError(400, 'INVALID_TYPE', 'Issue type does not belong to this workspace')
  }
}

async function assertExternalId(
  db: LancityDb,
  projectId: number,
  externalId: string | null | undefined,
  externalSource: string | null | undefined,
  exceptId?: number
) {
  if (!externalId || !externalSource) return
  const [other] = await db
    .select({ id: issues.id })
    .from(issues)
    .where(
      and(
        eq(issues.projectId, projectId),
        eq(issues.externalId, externalId),
        eq(issues.externalSource, externalSource),
        isNull(issues.deletedAt),
        exceptId ? sql`${issues.id} <> ${exceptId}` : undefined
      )
    )
    .limit(1)
  if (other)
    throw new ServiceError(409, 'EXTERNAL_ID_EXISTS', 'Issue with the same external id and external source already exists', {
      id: other.id
    })
}

/** Plane silently drops assignees that are not active project members above guest. */
async function eligibleAssignees(db: LancityDb, projectId: number, ids: number[]) {
  if (!ids.length) return []
  const rows = await db.all<{ member_id: number }>(sql`select distinct pm.member_id from project_members pm
    join workspace_members wm on wm.workspace_id = pm.workspace_id and wm.member_id = pm.member_id
    where pm.project_id = ${projectId} and pm.is_active = 1 and pm.deleted_at is null and pm.role >= 15
      and wm.is_active = 1 and wm.deleted_at is null and pm.member_id in (select value from json_each(${JSON.stringify(ids)}))`)
  return rows.map(row => row.member_id)
}
/** Plane silently drops labels that do not belong to the project. */
async function projectLabelIds(db: LancityDb, projectId: number, ids: number[]) {
  if (!ids.length) return []
  const rows = await db.all<{ id: number }>(sql`select id from labels where project_id = ${projectId} and deleted_at is null
    and id in (select value from json_each(${JSON.stringify(ids)}))`)
  return rows.map(row => row.id)
}

type Statement = BatchItem<'sqlite'>

/** Run statements as one atomic D1 batch. Statements decide at run time whether to apply, using `changes()`. */
export async function runBatch(db: LancityDb, statements: Statement[]): Promise<unknown[][]> {
  return (await db.batch(statements as [Statement, ...Statement[]])) as unknown as unknown[][]
}

/** Persist the full mutation snapshot in D1; the queue carries only its outbox id. */
function issueEventPayload(event: 'created' | 'updated' | 'deleted', issueId: number, projectId: number, actorId: number, mutationId: string, requestedData: unknown, currentInstance: unknown) {
  return { event, issueId, projectId, actorId, mutationId, requestedData: toPlaneData(requestedData), currentInstance: toPlaneData(currentInstance), epoch: Math.floor(Date.now() / 1000), notification: true, activityRecorded: true, webhook: true }
}
function descriptionPayload(issueId: number | SQL<number>, userId: number, oldHtml: string | null, isCreating: boolean) {
  const base = JSON.stringify({ updatedIssue: { description_html: oldHtml }, userId, isCreating })
  return sql`(select json_set(${base}, '$.issueId', i.id, '$.snapshot', json_object('descriptionHtml', i.description_html, 'descriptionStripped', i.description_stripped, 'descriptionJson', json(i.description_json), 'descriptionBinaryHex', hex(i.description_binary))) from issues i where i.id = ${issueId})`
}

/** Plane `display_name`: the username, falling back to the name. */
const userDisplayName = sql<string>`coalesce(${user.username}, ${user.name})`
const nowMs = sql`cast(unixepoch('subsec') * 1000 as integer)`
/** INSERT ... SELECT rows linking the issue created in this batch to every id of a JSON array. */
function linkInsert(db: LancityDb, kind: 'labels' | 'assignees', actor: Actor, ids: number[], issueId: SQL<number> | number) {
  const json = JSON.stringify(ids)
  return kind === 'labels'
    ? db
        .insert(issueLabels)
        .select(
          sql`select null, ${nowMs}, ${nowMs}, ${actor.userId}, ${actor.userId}, i.id, je.value, i.project_id, i.workspace_id, null
            from issues i, json_each(${json}) je where i.id = ${issueId}`
        )
    : db
        .insert(issueAssignees)
        .select(
          sql`select null, ${nowMs}, ${nowMs}, ${actor.userId}, ${actor.userId}, je.value, i.id, i.project_id, i.workspace_id, null
            from issues i, json_each(${json}) je where i.id = ${issueId}`
        )
}

/**
 * Port of `IssueCreateSerializer.create` and `Issue.save` (PD-0323, PD-1418). Sequence, sort order, issue row,
 * assignees, labels, sequence reservation, activity and version are one D1 batch. The counter statement
 * serialises concurrent creations, so a project's sequence numbers stay unique.
 */
export async function createIssue(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  raw: CreateIssueInput,
  env?: InfraEnv
) {
  const input = parseInput(createIssueInputSchema, raw)
  const { workspace, project } = await requireProjectAccess(db, actor, slug, projectId, 15)
  // Store the sanitized HTML, never the raw input (Plane `validate_html_content`).
  const cleanHtml = sanitizeDescriptionHtml(input.descriptionHtml)
  await assertState(db, input.stateId, projectId)
  await assertParent(db, input.parentId, projectId)
  await assertEstimateAndType(db, projectId, workspace.id, input.estimatePointId, input.typeId)
  await assertExternalId(db, projectId, input.externalId, input.externalSource)
  const stateId = await resolveInitialIssueState(db, projectId, input.stateId)
  const [stateRow] = stateId
    ? await db.select({ group: states.group }).from(states).where(eq(states.id, stateId))
    : []
  let assigneeIds = await eligibleAssignees(db, projectId, [...new Set(input.assigneeIds ?? [])])
  if (!assigneeIds.length && project.defaultAssigneeId)
    assigneeIds = await eligibleAssignees(db, projectId, [project.defaultAssigneeId])
  const labelIds = await projectLabelIds(db, projectId, [...new Set(input.labelIds ?? [])])
  const descriptionHtml = cleanHtml || '<p></p>'
  const currentSequence = currentSequenceSql(projectId)
  const createdIssueId = createdIssueIdSql(projectId)
  const nextSequence = nextSequenceSql(projectId)
  const completedAt = resolveIssueCompletionTime(stateRow?.group, { adding: true, stateChanged: true })
  const mutationId = crypto.randomUUID()
  const versionKey = `${mutationId}:description`
  let created: (typeof issues.$inferSelect)[]
  try {
    ;[, created] = (await runBatch(db, [
      db
        .insert(projectIssueCounters)
        .select(
          sql`select null, ${projectId}, ${nextSequence} where ${writableProject(actor, slug, projectId)} and ${validState(stateId, projectId)} and ${validParent(input.parentId ?? null, projectId)}`
        )
        .onConflictDoUpdate({ target: projectIssueCounters.projectId, set: { lastSequence: nextSequence } }),
      db
        .insert(issues)
        .values({
          name: input.name,
          priority: input.priority ?? 'none',
          stateId,
          completedAt: completedAt ?? null,
          parentId: input.parentId ?? null,
          startDate: input.startDate ?? null,
          targetDate: input.targetDate ?? null,
          descriptionHtml,
          descriptionStripped: stripTags(descriptionHtml),
          ...(input.descriptionJson === undefined ? {} : { descriptionJson: input.descriptionJson }),
          estimatePointId: input.estimatePointId ?? null,
          typeId: input.typeId ?? null,
          point: input.point ?? null,
          externalId: input.externalId ?? null,
          externalSource: input.externalSource ?? null,
          sortOrder: newIssueSortOrderSql(projectId, stateId),
          projectId,
          workspaceId: workspace.id,
          sequenceId: sql`case when changes() = 1 then ${currentSequence} else null end`,
          createdById: actor.userId,
          updatedById: actor.userId
        })
        .returning(),
      ...(assigneeIds.length ? [linkInsert(db, 'assignees', actor, assigneeIds, createdIssueId)] : []),
      ...(labelIds.length ? [linkInsert(db, 'labels', actor, labelIds, createdIssueId)] : []),
      db.insert(issueSequences).values({
        projectId,
        workspaceId: workspace.id,
        sequence: currentSequence,
        issueId: createdIssueId,
        createdById: actor.userId,
        updatedById: actor.userId
      }),
      activityStatement(db, createdIssueId, projectId, actor.userId, 'created', null, null, null, 'created the issue', null, null, false, mutationId),
      versionStatement(db, createdIssueId, projectId, actor.userId),
      // Multi-row statements go last: the ones above depend on `changes() = 1`.
      ...(assigneeIds.length
        ? [
            assigneeActivitiesStatement(db, createdIssueId, actor.userId, assigneeIds, mutationId),
            assigneeSubscribersStatement(db, createdIssueId, assigneeIds)
          ]
        : []),
      outboxStatement(db, mutationId, 'issue.activity', sql`json_set(${JSON.stringify(issueEventPayload('created', 1, projectId, actor.userId, mutationId, input, null))}, '$.issueId', ${createdIssueId})`),
      outboxStatement(db, versionKey, 'issue.description_version.update', descriptionPayload(createdIssueId, actor.userId, descriptionHtml, true))
    ])) as [unknown[], (typeof issues.$inferSelect)[]]
  } catch (error) {
    await requireProjectAccess(db, actor, slug, projectId, 15)
    await assertState(db, stateId, projectId)
    await assertParent(db, input.parentId, projectId)
    throw error
  }
  const issue = created[0]
  await publishOutbox(db, mutationId, env)
  await publishOutbox(db, versionKey, env)
  return issue
}

/** Legacy flat list kept for the web page. Filtered and paginated lists live in `list.ts`. */
export async function listIssues(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { project, membership, workspaceMembership } = await requireProjectAccess(db, actor, slug, projectId, 5)
  const ownOnly = membership.role === 5 && workspaceMembership.role !== 20 && !project.guestViewAllFeatures
  return db
    .select()
    .from(issues)
    .where(
      and(
        eq(issues.projectId, projectId),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt),
        eq(issues.isDraft, false),
        // A sub-issue disappears with its deleted parent before the background cascade runs.
        sql`(${issues.parentId} is null or not exists (select 1 from issues dp where dp.id = ${issues.parentId} and dp.deleted_at is not null))`,
        ownOnly ? eq(issues.createdById, actor.userId) : undefined
      )
    )
}

export async function getIssue(db: LancityDb, actor: Actor, slug: string, projectId: number, issueId: number) {
  const { project, membership, workspaceMembership } = await requireProjectAccess(db, actor, slug, projectId, 5)
  const ownOnly = membership.role === 5 && workspaceMembership.role !== 20 && !project.guestViewAllFeatures
  const [issue] = await db
    .select()
    .from(issues)
    .where(
      and(
        eq(issues.id, issueId),
        eq(issues.projectId, projectId),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt),
        eq(issues.isDraft, false),
        ownOnly ? eq(issues.createdById, actor.userId) : undefined
      )
    )
  if (!issue) throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Issue not found')
  return issue
}

export async function listComments(db: LancityDb, actor: Actor, slug: string, projectId: number, issueId: number) {
  await getIssue(db, actor, slug, projectId, issueId)
  return db
    .select()
    .from(issueComments)
    .where(
      and(eq(issueComments.issueId, issueId), eq(issueComments.projectId, projectId), isNull(issueComments.deletedAt))
    )
    .orderBy(issueComments.createdAt)
}

export async function createComment(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  raw: CreateCommentInput
) {
  const input = parseInput(createCommentInputSchema, raw)
  await getIssue(db, actor, slug, projectId, issueId)
  const escaped = input.text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
  const insert = db
    .insert(issueComments)
    .select(
      sql`select
    null, cast(unixepoch('subsec') * 1000 as integer), cast(unixepoch('subsec') * 1000 as integer), ${actor.userId}, ${actor.userId},
    '[]', id, project_id, workspace_id, ${actor.userId}, ${input.text}, ${`<p>${escaped}</p>`}, '{}', 'INTERNAL', null, null, null, null, null, null
    from issues where id = ${issueId} and project_id = ${projectId} and ${canEditComment(actor, slug, projectId, issueId, false)}`
    )
    .returning()
  const commentId = sql<number>`last_insert_rowid()`
  const [created] = await db.batch([
    insert,
    commentActivityStatement(db, commentId, issueId, projectId, actor.userId, 'created', null, `<p>${escaped}</p>`)
  ])
  if (!created.length) {
    await getIssue(db, actor, slug, projectId, issueId)
    throw new ServiceError(409, 'COMMENT_CONFLICT', 'Issue or permissions changed; reload and try again')
  }
  return created[0]
}

/**
 * Port of `IssueCreateSerializer.update` and `IssueViewSet.partial_update` (PD-0324, PD-0588). Admins, members and the
 * issue's creator may edit. Scalar fields, assignee and label changes, one activity row per change and the version
 * snapshot are one D1 batch guarded by the issue's `updated_at`, so a concurrent edit gets a 409 instead of a lost update.
 */
export async function updateIssue(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  raw: UpdateIssueInput,
  env?: InfraEnv
) {
  const parsed = parseInput(updateIssueInputSchema, raw)
  const { workspace, membership, workspaceMembership } = await requireProjectAccess(db, actor, slug, projectId, 5)
  const current = await getIssue(db, actor, slug, projectId, issueId)
  const role = workspaceMembership.role === 20 ? 20 : membership.role
  if (role < 15 && current.createdById !== actor.userId)
    throw new ServiceError(403, 'FORBIDDEN', 'Insufficient project permissions')
  const input = {
    ...parsed,
    // Store the sanitized HTML, never the raw input (Plane `validate_html_content`).
    ...(parsed.descriptionHtml ? { descriptionHtml: sanitizeDescriptionHtml(parsed.descriptionHtml) } : {})
  }
  const startDate = input.startDate === undefined ? current.startDate : input.startDate
  const targetDate = input.targetDate === undefined ? current.targetDate : input.targetDate
  if (startDate && targetDate && startDate > targetDate)
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Start date cannot exceed target date')
  if (input.parentId !== undefined && input.parentId !== current.parentId)
    await assertParent(db, input.parentId, projectId, issueId)
  await assertEstimateAndType(db, projectId, workspace.id, input.estimatePointId, input.typeId)
  if (input.externalId && input.externalId !== current.externalId)
    await assertExternalId(db, projectId, input.externalId, input.externalSource ?? current.externalSource, issueId)
  let newState: typeof states.$inferSelect | undefined
  let oldState: typeof states.$inferSelect | undefined
  if (input.stateId !== undefined && input.stateId !== current.stateId) {
    ;[newState] = await db
      .select()
      .from(states)
      .where(
        and(
          eq(states.id, input.stateId),
          eq(states.projectId, projectId),
          eq(states.isTriage, false),
          isNull(states.deletedAt)
        )
      )
    if (!newState) throw new ServiceError(400, 'INVALID_STATE', 'State does not belong to this project')
    if (current.stateId)
      [oldState] = await db
        .select()
        .from(states)
        .where(and(eq(states.id, current.stateId), eq(states.projectId, projectId)))
  }

  const { assigneeIds, labelIds, ...scalars } = input
  const changes: Array<{
    field: string
    oldValue: string | null
    newValue: string | null
    comment: string
    oldId?: number | null
    newId?: number | null
    verb?: string
  }> = []
  if (input.name !== undefined && input.name !== current.name)
    changes.push({ field: 'name', oldValue: current.name, newValue: input.name, comment: 'updated the name to' })
  if (input.priority !== undefined && input.priority !== current.priority)
    changes.push({
      field: 'priority',
      oldValue: current.priority,
      newValue: input.priority,
      comment: 'updated the priority to'
    })
  if (input.startDate !== undefined && input.startDate !== current.startDate)
    changes.push({
      field: 'start_date',
      oldValue: current.startDate ?? '',
      newValue: input.startDate ?? '',
      comment: 'updated the start date to '
    })
  if (input.targetDate !== undefined && input.targetDate !== current.targetDate)
    changes.push({
      field: 'target_date',
      oldValue: current.targetDate ?? '',
      newValue: input.targetDate ?? '',
      comment: 'updated the target date to'
    })
  if (newState)
    changes.push({
      field: 'state',
      oldValue: oldState?.name ?? null,
      newValue: newState.name,
      oldId: current.stateId,
      newId: newState.id,
      comment: 'updated the state to'
    })
  if (input.descriptionHtml !== undefined && input.descriptionHtml !== current.descriptionHtml)
    changes.push({
      field: 'description',
      oldValue: current.descriptionHtml,
      newValue: input.descriptionHtml,
      comment: 'updated the description to'
    })
  if (input.parentId !== undefined && input.parentId !== current.parentId)
    changes.push({
      field: 'parent',
      // Plane `track_parent` stores `PROJ-12` (project identifier and sequence), not the row id.
      oldValue: await issueIdentifierLabel(db, projectId, current.parentId),
      newValue: await issueIdentifierLabel(db, projectId, input.parentId),
      oldId: current.parentId,
      newId: input.parentId,
      comment: 'updated the parent issue to'
    })
  if (input.estimatePointId !== undefined && input.estimatePointId !== current.estimatePointId) {
    // Plane `track_estimate_points`: field `estimate_<type>`, point values, verb `removed` when cleared.
    const estimate = await estimateActivity(db, projectId, current.estimatePointId, input.estimatePointId)
    if (estimate)
      changes.push({
        ...estimate,
        oldId: current.estimatePointId,
        newId: input.estimatePointId
      })
  }
  const scalarDirty = Object.entries(scalars).some(
    ([key, value]) => JSON.stringify(value) !== JSON.stringify((current as Record<string, unknown>)[key])
  )

  // Assignee and label sets are replaced: add what is new, soft delete what is gone (Plane drops invalid ids).
  const relationChanges: Array<{ kind: 'labels' | 'assignees'; id: number; name: string; add: boolean }> = []
  if (assigneeIds !== undefined) {
    const wanted = new Set(await eligibleAssignees(db, projectId, [...new Set(assigneeIds)]))
    const rows = await db
      .select({ id: issueAssignees.assigneeId, name: userDisplayName })
      .from(issueAssignees)
      .innerJoin(user, eq(user.id, issueAssignees.assigneeId))
      .where(and(eq(issueAssignees.issueId, issueId), isNull(issueAssignees.deletedAt)))
    const have = new Map(rows.map(row => [row.id, row.name]))
    for (const [id, name] of have) if (!wanted.has(id)) relationChanges.push({ kind: 'assignees', id, name, add: false })
    const names = wanted.size
      ? await db.all<{ id: number; name: string }>(
          sql`select id, coalesce(username, name) as name from "user" where id in (select value from json_each(${JSON.stringify([...wanted])}))`
        )
      : []
    for (const { id, name } of names) if (!have.has(id)) relationChanges.push({ kind: 'assignees', id, name, add: true })
  }
  if (labelIds !== undefined) {
    const wanted = new Set(await projectLabelIds(db, projectId, [...new Set(labelIds)]))
    const rows = await db
      .select({ id: issueLabels.labelId, name: labels.name })
      .from(issueLabels)
      .innerJoin(labels, eq(labels.id, issueLabels.labelId))
      .where(and(eq(issueLabels.issueId, issueId), isNull(issueLabels.deletedAt)))
    const have = new Map(rows.map(row => [row.id, row.name]))
    for (const [id, name] of have) if (!wanted.has(id)) relationChanges.push({ kind: 'labels', id, name, add: false })
    const names = wanted.size
      ? await db.all<{ id: number; name: string }>(
          sql`select id, name from labels where id in (select value from json_each(${JSON.stringify([...wanted])}))`
        )
      : []
    for (const { id, name } of names) if (!have.has(id)) relationChanges.push({ kind: 'labels', id, name, add: true })
  }
  if (!changes.length && !scalarDirty && !relationChanges.length) return current

  const descriptionFields =
    input.descriptionHtml === undefined ? {} : { descriptionStripped: stripTags(input.descriptionHtml) }
  const completedAt = resolveIssueCompletionTime(newState?.group, { adding: false, stateChanged: Boolean(newState) })
  const update = db
    .update(issues)
    .set({
      ...scalars,
      ...descriptionFields,
      updatedById: actor.userId,
      updatedAt: sql`max(${issues.updatedAt} + 1, cast(unixepoch('subsec') * 1000 as integer))`,
      ...(completedAt === undefined ? {} : { completedAt })
    })
    .where(
      and(
        eq(issues.id, issueId),
        eq(issues.projectId, projectId),
        isNull(issues.deletedAt),
        eq(issues.updatedAt, current.updatedAt),
        isNull(issues.archivedAt),
        eq(issues.isDraft, false),
        writableProject(actor, slug, projectId, issueId),
        // Only a new state is checked: intake items keep their triage state while their name is edited.
        input.stateId === undefined ? undefined : validState(input.stateId, projectId),
        validParent(input.parentId ?? null, projectId)
      )
    )
    .returning()
  const mutationId = crypto.randomUUID()
  const versionKey = `${mutationId}:description`
  const statements: Statement[] = [
    update,
    outboxStatement(db, mutationId, 'issue.activity', issueEventPayload('updated', issueId, projectId, actor.userId, mutationId, input, current), sql`changes() = 1`),
    ...(input.descriptionHtml !== undefined ? [outboxStatement(db, versionKey, 'issue.description_version.update', descriptionPayload(issueId, actor.userId, current.descriptionHtml, false), sql`changes() = 1`)] : [])
  ]
  for (const change of changes)
    statements.push(
      activityStatement(
        db,
        issueId,
        projectId,
        actor.userId,
        change.verb ?? 'updated',
        change.field,
        change.oldValue,
        change.newValue,
        change.comment,
        change.oldId,
        change.newId,
        false,
        mutationId
      )
    )
  // Every statement of the chain runs only if the one before it changed a row (`changes() = 1`).
  for (const change of relationChanges) {
    const table = change.kind === 'labels' ? issueLabels : issueAssignees
    const column = change.kind === 'labels' ? issueLabels.labelId : issueAssignees.assigneeId
    const json = JSON.stringify([change.id])
    statements.push(
      change.add
        ? change.kind === 'labels'
          ? db.insert(issueLabels).select(
              sql`select null, ${nowMs}, ${nowMs}, ${actor.userId}, ${actor.userId}, i.id, je.value, i.project_id, i.workspace_id, null
                from issues i, json_each(${json}) je where i.id = ${issueId} and changes() = 1`
            )
          : db.insert(issueAssignees).select(
              sql`select null, ${nowMs}, ${nowMs}, ${actor.userId}, ${actor.userId}, je.value, i.id, i.project_id, i.workspace_id, null
                from issues i, json_each(${json}) je where i.id = ${issueId} and changes() = 1`
            )
        : db
            .update(table)
            .set({ deletedAt: new Date(), updatedById: actor.userId })
            .where(and(eq(table.issueId, issueId), eq(column, change.id), isNull(table.deletedAt), sql`changes() = 1`)),
      activityStatement(
        db,
        issueId,
        projectId,
        actor.userId,
        'updated',
        change.kind,
        change.add ? '' : change.name,
        change.add ? change.name : '',
        `${change.add ? 'added' : 'removed'} ${change.kind === 'labels' ? 'label' : 'assignee'} `,
        change.add ? null : change.id,
        change.add ? change.id : null,
        false,
        mutationId
      )
    )
  }
  statements.push(versionStatement(db, issueId, projectId, actor.userId))
  // New assignees follow the issue (Plane subscribes them in the activity task).
  for (const change of relationChanges)
    if (change.kind === 'assignees' && change.add)
      statements.push(
        db
          .insert(issueSubscribers)
          .select(
            sql`select null, ${nowMs}, ${nowMs}, ${change.id}, ${change.id}, ${issueId}, ${projectId}, ${change.id}, ${workspace.id}, null
              where exists (select 1 from issue_assignees where issue_id = ${issueId} and assignee_id = ${change.id} and deleted_at is null)`
          )
          .onConflictDoNothing()
      )
  let updated: (typeof issues.$inferSelect)[]
  try {
    ;[updated] = (await runBatch(db, statements)) as [(typeof issues.$inferSelect)[]]
  } catch (error) {
    await requireProjectAccess(db, actor, slug, projectId, 5)
    await assertState(db, input.stateId, projectId)
    throw error
  }
  if (!updated.length) {
    await requireProjectAccess(db, actor, slug, projectId, 5)
    if (input.stateId !== undefined) await assertState(db, input.stateId, projectId)
    if (input.parentId) await assertParent(db, input.parentId, projectId, issueId)
    throw new ServiceError(409, 'ISSUE_CONFLICT', 'Issue changed; reload and try again')
  }
  await publishOutbox(db, mutationId, env)
  if (input.descriptionHtml !== undefined) await publishOutbox(db, versionKey, env)
  return updated[0]
}

export async function listIssueActivities(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number
) {
  await getIssue(db, actor, slug, projectId, issueId)
  return db
    .select()
    .from(issueActivities)
    .where(
      and(
        eq(issueActivities.issueId, issueId),
        eq(issueActivities.projectId, projectId),
        isNull(issueActivities.deletedAt)
      )
    )
    .orderBy(desc(issueActivities.id))
}

export async function listIssueVersions(db: LancityDb, actor: Actor, slug: string, projectId: number, issueId: number) {
  await getIssue(db, actor, slug, projectId, issueId)
  return db
    .select()
    .from(issueVersions)
    .where(
      and(eq(issueVersions.issueId, issueId), eq(issueVersions.projectId, projectId), isNull(issueVersions.deletedAt))
    )
    .orderBy(desc(issueVersions.id))
}

/**
 * Port of `IssueViewSet.destroy` (PD-0589): soft delete by a project or workspace admin, or by the creator. The
 * issue's sequence stays reserved so numbers are never reused.
 */
export async function deleteIssue(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  env?: InfraEnv
) {
  const { membership, workspaceMembership, project } = await requireProjectAccess(db, actor, slug, projectId, 5)
  // `Issue.objects` includes archived issues, so an archived issue can be deleted (Plane `IssueViewSet.destroy`).
  const [current] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.id, issueId), eq(issues.projectId, projectId), isNull(issues.deletedAt), eq(issues.isDraft, false)))
  const ownOnly = membership.role === 5 && workspaceMembership.role !== 20 && !project.guestViewAllFeatures
  if (!current || (ownOnly && current.createdById !== actor.userId))
    throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Issue not found')
  const removed = db
    .update(issues)
    .set({
      deletedAt: new Date(),
      updatedById: actor.userId,
      updatedAt: sql`max(${issues.updatedAt} + 1, cast(unixepoch('subsec') * 1000 as integer))`
    })
    .where(
      and(
        eq(issues.id, issueId),
        eq(issues.projectId, projectId),
        isNull(issues.deletedAt),
        eq(issues.isDraft, false),
        eq(issues.updatedAt, current.updatedAt),
        deletableIssue(actor, slug, projectId, issueId)
      )
    )
    .returning({ id: issues.id })
  const mutationId = crypto.randomUUID()
  const cascadeKey = `${mutationId}:cascade`
  const activity = activityStatement(
    db,
    issueId,
    projectId,
    actor.userId,
    'deleted',
    'issue',
    null,
    null,
    'deleted the issue',
    null,
    null,
    true,
    mutationId
  )
  const sequence = db
    .insert(issueSequences)
    .select(
      sql`select null, cast(unixepoch('subsec') * 1000 as integer), cast(unixepoch('subsec') * 1000 as integer), ${actor.userId}, ${actor.userId}, sequence_id, 1, id, project_id, workspace_id, null from issues where id = ${issueId} and project_id = ${projectId} and deleted_at is not null and changes() = 1`
    )
    .onConflictDoUpdate({
      target: [issueSequences.projectId, issueSequences.sequence],
      set: {
        deleted: true,
        updatedById: actor.userId,
        sequence: sql`case when ${issueSequences.issueId} is null or ${issueSequences.issueId} = ${issueId} then ${issueSequences.sequence} else null end`,
        issueId
      }
    })
  const [rows] = await runBatch(db, [removed, outboxStatement(db, mutationId, 'issue.activity', issueEventPayload('deleted', issueId, projectId, actor.userId, mutationId, { issueId }, current), sql`changes() = 1`), outboxStatement(db, cascadeKey, 'maintenance.soft_delete_related', { model: 'issues', id: issueId }, sql`changes() = 1`), activity, sequence])
  if (!rows.length) {
    if (current.createdById !== actor.userId && membership.role !== 20 && workspaceMembership.role !== 20)
      throw new ServiceError(403, 'FORBIDDEN', 'Only admin or creator can delete the work item')
    throw new ServiceError(409, 'ISSUE_CONFLICT', 'Issue changed; reload and try again')
  }
  await publishOutbox(db, mutationId, env)
  await publishOutbox(db, cascadeKey, env)
}

function canEditComment(actor: Actor, slug: string, projectId: number, issueId: number, edit = true) {
  return sql`exists (select 1 from issues i
    join projects p on p.id = i.project_id and p.workspace_id = i.workspace_id
    join workspaces w on w.id = p.workspace_id
    join workspace_members wm on wm.workspace_id = w.id and wm.member_id = ${actor.userId}
    join project_members pm on pm.project_id = p.id and pm.workspace_id = w.id and pm.member_id = ${actor.userId}
    where i.id = ${issueId} and p.id = ${projectId} and w.slug = ${slug}
      and i.deleted_at is null and i.archived_at is null and i.is_draft = 0 and p.deleted_at is null and w.deleted_at is null
      and wm.is_active = 1 and wm.deleted_at is null and pm.is_active = 1 and pm.deleted_at is null
      and (wm.role = 20 or pm.role >= 15 or p.guest_view_all_features = 1 or i.created_by_id = ${actor.userId})
      and ${edit ? sql`(${issueComments.createdById} = ${actor.userId} or wm.role = 20 or pm.role = 20)` : sql`1`})`
}

async function editableComment(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  commentId: number
) {
  await getIssue(db, actor, slug, projectId, issueId)
  const { membership, workspaceMembership } = await requireProjectAccess(db, actor, slug, projectId)
  const [comment] = await db
    .select()
    .from(issueComments)
    .where(
      and(
        eq(issueComments.id, commentId),
        eq(issueComments.issueId, issueId),
        eq(issueComments.projectId, projectId),
        isNull(issueComments.deletedAt)
      )
    )
  if (!comment) throw new ServiceError(404, 'COMMENT_NOT_FOUND', 'Comment not found')
  if (comment.createdById !== actor.userId && membership.role !== 20 && workspaceMembership.role !== 20)
    throw new ServiceError(403, 'FORBIDDEN', 'Only the author or a project admin may change this comment')
  return comment
}

export async function updateComment(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  commentId: number,
  raw: CreateCommentInput
) {
  const input = parseInput(createCommentInputSchema, raw)
  const current = await editableComment(db, actor, slug, projectId, issueId, commentId)
  if (current.commentStripped === input.text) return current
  const escaped = input.text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
  const html = `<p>${escaped}</p>`
  const update = db
    .update(issueComments)
    .set({
      commentStripped: input.text,
      commentHtml: html,
      editedAt: new Date(),
      updatedById: actor.userId,
      updatedAt: sql`max(${issueComments.updatedAt} + 1, cast(unixepoch('subsec') * 1000 as integer))`
    })
    .where(
      and(
        eq(issueComments.id, commentId),
        eq(issueComments.issueId, issueId),
        eq(issueComments.projectId, projectId),
        isNull(issueComments.deletedAt),
        eq(issueComments.updatedAt, current.updatedAt),
        canEditComment(actor, slug, projectId, issueId)
      )
    )
    .returning()
  const [updated] = await db.batch([
    update,
    commentActivityStatement(db, commentId, issueId, projectId, actor.userId, 'updated', current.commentHtml, html)
  ])
  if (!updated.length)
    throw new ServiceError(409, 'COMMENT_CONFLICT', 'Comment or permissions changed; reload and try again')
  return updated[0]
}

export async function deleteComment(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  commentId: number
) {
  const current = await editableComment(db, actor, slug, projectId, issueId, commentId)
  const update = db
    .update(issueComments)
    .set({
      deletedAt: new Date(),
      updatedById: actor.userId,
      updatedAt: sql`max(${issueComments.updatedAt} + 1, cast(unixepoch('subsec') * 1000 as integer))`
    })
    .where(
      and(
        eq(issueComments.id, commentId),
        eq(issueComments.issueId, issueId),
        eq(issueComments.projectId, projectId),
        isNull(issueComments.deletedAt),
        eq(issueComments.updatedAt, current.updatedAt),
        canEditComment(actor, slug, projectId, issueId)
      )
    )
    .returning({ id: issueComments.id })
  const [deleted] = await db.batch([
    update,
    commentActivityStatement(db, commentId, issueId, projectId, actor.userId, 'deleted', null, null)
  ])
  if (!deleted.length)
    throw new ServiceError(409, 'COMMENT_CONFLICT', 'Comment or permissions changed; reload and try again')
}

type RelationKind = 'labels' | 'assignees'
/** Add or remove a single relationship and atomically record the resulting snapshot. */
export async function changeIssueRelation(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  kind: RelationKind,
  targetId: number,
  add: boolean
) {
  await requireProjectAccess(db, actor, slug, projectId, 15)
  const issue = await getIssue(db, actor, slug, projectId, issueId)
  const table = kind === 'labels' ? issueLabels : issueAssignees
  const targetColumn = kind === 'labels' ? issueLabels.labelId : issueAssignees.assigneeId
  const [existing] = await db
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        eq(table.issueId, issueId),
        eq(table.projectId, projectId),
        eq(targetColumn, targetId),
        isNull(table.deletedAt)
      )
    )
    .limit(1)
  if (add && existing) throw new ServiceError(409, 'RELATION_EXISTS', 'Relationship already exists')
  if (!add && !existing) throw new ServiceError(404, 'RELATION_NOT_FOUND', 'Relationship not found')
  let targetName: string
  if (kind === 'labels') {
    const [label] = await db
      .select({ name: labels.name })
      .from(labels)
      .where(and(eq(labels.id, targetId), eq(labels.projectId, projectId), isNull(labels.deletedAt)))
    if (!label) throw new ServiceError(400, 'INVALID_LABEL', 'Label does not belong to this project')
    targetName = label.name
  } else {
    const [member] = add
      ? await db
          .select({ name: userDisplayName })
          .from(user)
          .innerJoin(
            projectMembers,
            and(
              eq(projectMembers.memberId, user.id),
              eq(projectMembers.projectId, projectId),
              eq(projectMembers.workspaceId, issue.workspaceId),
              isNull(projectMembers.deletedAt),
              eq(projectMembers.isActive, true),
              sql`${projectMembers.role} >= 15`
            )
          )
          .innerJoin(
            workspaceMembers,
            and(
              eq(workspaceMembers.memberId, user.id),
              eq(workspaceMembers.workspaceId, issue.workspaceId),
              isNull(workspaceMembers.deletedAt),
              eq(workspaceMembers.isActive, true)
            )
          )
          .where(eq(user.id, targetId))
          .limit(1)
      : await db
          .select({ name: userDisplayName })
          .from(user)
          .innerJoin(
            workspaceMembers,
            and(
              eq(workspaceMembers.memberId, user.id),
              eq(workspaceMembers.workspaceId, issue.workspaceId),
              isNull(workspaceMembers.deletedAt)
            )
          )
          .where(eq(user.id, targetId))
          .limit(1)
    if (!member) throw new ServiceError(400, 'INVALID_ASSIGNEE', 'Assignee is not an eligible project member')
    targetName = member.name
  }
  const liveIssue = sql`exists (select 1 from issues i where i.id = ${issueId} and i.project_id = ${projectId} and i.deleted_at is null and i.archived_at is null and i.is_draft = 0)`
  const targetValid =
    kind === 'labels'
      ? sql`exists (select 1 from labels l where l.id = ${targetId} and l.project_id = ${projectId} and l.deleted_at is null)`
      : sql`exists (select 1 from project_members pm join workspace_members wm on wm.workspace_id = pm.workspace_id and wm.member_id = pm.member_id where pm.project_id = ${projectId} and pm.member_id = ${targetId} and pm.is_active = 1 and pm.deleted_at is null and pm.role >= 15 and wm.is_active = 1 and wm.deleted_at is null)`
  const guard = sql`${writableProject(actor, slug, projectId)} and ${liveIssue}`
  const insert =
    kind === 'labels'
      ? db
          .insert(issueLabels)
          .select(
            sql`select null, cast(unixepoch('subsec') * 1000 as integer), cast(unixepoch('subsec') * 1000 as integer), ${actor.userId}, ${actor.userId}, ${issueId}, ${targetId}, ${projectId}, ${issue.workspaceId}, null where ${guard} and ${targetValid} and not exists (select 1 from issue_labels where issue_id = ${issueId} and label_id = ${targetId} and deleted_at is null)`
          )
          .returning({ id: issueLabels.id })
      : db
          .insert(issueAssignees)
          .select(
            sql`select null, cast(unixepoch('subsec') * 1000 as integer), cast(unixepoch('subsec') * 1000 as integer), ${actor.userId}, ${actor.userId}, ${targetId}, ${issueId}, ${projectId}, ${issue.workspaceId}, null where ${guard} and ${targetValid} and not exists (select 1 from issue_assignees where issue_id = ${issueId} and assignee_id = ${targetId} and deleted_at is null)`
          )
          .returning({ id: issueAssignees.id })
  const remove = db
    .update(table)
    .set({ deletedAt: new Date(), updatedById: actor.userId })
    .where(and(eq(table.id, existing?.id ?? 0), isNull(table.deletedAt), guard))
    .returning({ id: table.id })
  const action = add ? insert : remove
  const activity = activityStatement(
    db,
    issueId,
    projectId,
    actor.userId,
    'updated',
    kind,
    add ? '' : targetName,
    add ? targetName : '',
    `${add ? 'added' : 'removed'} ${kind === 'labels' ? 'label' : 'assignee'} `,
    add ? null : targetId,
    add ? targetId : null
  )
  const snapshot = versionStatement(db, issueId, projectId, actor.userId)
  const subscriber = db
    .insert(issueSubscribers)
    .select(
      sql`select null, cast(unixepoch('subsec') * 1000 as integer), cast(unixepoch('subsec') * 1000 as integer), ${targetId}, ${targetId}, ${issueId}, ${projectId}, ${targetId}, ${issue.workspaceId}, null where changes() = 1`
    )
    .onConflictDoNothing()
  const [changed] =
    kind === 'assignees' && add
      ? await db.batch([action, activity, snapshot, subscriber])
      : await db.batch([action, activity, snapshot])
  if (!changed.length)
    throw new ServiceError(409, 'RELATION_CONFLICT', 'Issue, relationship or permissions changed; reload and try again')
  return { id: targetId }
}

/**
 * Port of `IssueDetailAPIEndpoint.put` (PD-0149): update the issue with this external id and source, or create it.
 * Both fields are required. Returns whether a new issue was created.
 */
export async function upsertIssueByExternalId(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  raw: Record<string, unknown>
) {
  const externalId = typeof raw.externalId === 'string' ? raw.externalId : ''
  const externalSource = typeof raw.externalSource === 'string' ? raw.externalSource : ''
  if (!externalId || !externalSource)
    throw new ServiceError(400, 'EXTERNAL_ID_REQUIRED', 'externalId and externalSource are required')
  await requireProjectAccess(db, actor, slug, projectId, 15)
  const [existing] = await db
    .select({ id: issues.id })
    .from(issues)
    .where(
      and(
        eq(issues.projectId, projectId),
        eq(issues.externalId, externalId),
        eq(issues.externalSource, externalSource),
        isNull(issues.deletedAt)
      )
    )
    .limit(1)
  if (!existing) return { issue: await createIssue(db, actor, slug, projectId, raw as CreateIssueInput), created: true }
  const updated = await updateIssue(db, actor, slug, projectId, existing.id, raw as UpdateIssueInput)
  return { issue: updated, created: false }
}
