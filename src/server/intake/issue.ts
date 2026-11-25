import { and, asc, eq, gte, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { issueAssignees, issueLabels, issueSequences, issues, projectIssueCounters, states } from '@/db/schema/issue'
import { intakeIssues } from '@/db/schema/planning'
import { parseInput } from '@/server/api/v1/validation'
import { ServiceError } from '@/server/common/errors'
import { OffsetPaginator, paginate } from '@/server/common/pagination'
import { requirePermission, ROLE } from '@/server/common/permissions'
import { pickFields, fieldsFromQuery } from '@/server/common/serializers'
import { issueEventBody, issueEventStatement, publishIssueEvent } from '@/server/issue/events'
import { isRestrictedGuest } from '@/server/issue/access'
import { issueFilters } from '@/server/issue/filter'
import { activityStatement, versionStatement } from '@/server/issue/jobs/history'
import { retrieveIssueDetail } from '@/server/issue/list'
import {
  sanitizeDescriptionHtml,
  createdIssueIdSql,
  currentSequenceSql,
  newIssueSortOrderSql,
  nextSequenceSql,
  stripTags
} from '@/server/issue/sequence'
import { deleteIssue, runBatch, updateIssue } from '@/server/issue/service'
import { resolveIssueCompletionTime } from '@/server/issue/state'
import { INTAKE_STATUS_LABEL, resolveSnoozedTill } from '@/server/intake/model-rules'
import {
  toIntakeIssueApiResponse,
  toIntakeIssueDetailResponse,
  toIntakeIssueResponse,
  toIssueIntake
} from '@/server/intake/presenters'
import {
  findIntakeIssue,
  firstProjectIntake,
  intakeIssueColumns,
  intakeIssueOrder,
  labelIdsByIssue,
  queryIntakeIssue
} from '@/server/intake/queries'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { UpdateIssueInput } from '@/types/issue/schema'
import {
  createIntakeIssueApiInputSchema,
  createIntakeIssueInputSchema,
  INTAKE_STATUS,
  parseIntakeStatusQuery,
  updateIntakeIssueApiInputSchema,
  updateIntakeIssueInputSchema,
  type CreateIntakeIssueApiInput,
  type CreateIntakeIssueInput,
  type UpdateIntakeIssueApiInput
} from '@/types/planning/p2-intake-schema'

export type IntakeQuery = Record<string, string | undefined>
type Statement = BatchItem<'sqlite'>
type IntakeIssueRow = typeof intakeIssues.$inferSelect
type NewIssue = CreateIntakeIssueInput['issue'] | CreateIntakeIssueApiInput['issue']

const NOT_ENABLED = "Intake is not enabled for this project enable it through the project's api"
/** Plane `allow_permission(..., creator=True, model=Issue)`: the creator of the work item passes without the role. */
const ISSUE_MODEL = { table: issues, id: issues.id, createdById: issues.createdById, deletedAt: issues.deletedAt }

async function intakeContext(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const access = await requireProjectAccess(db, actor, slug, projectId, 5)
  const intake = await firstProjectIntake(db, access.workspace.id, projectId)
  return { ...access, intake }
}

function requireIntake<T>(intake: T | null): T {
  if (!intake) throw new ServiceError(404, 'INTAKE_NOT_FOUND', 'Intake not found')
  return intake
}

/** Triage state of the project, created on first use like Plane's `State.triage_objects.first()` fallback. */
async function ensureTriageState(db: LancityDb, workspaceId: number, projectId: number) {
  const find = () =>
    db
      .select()
      .from(states)
      .where(and(eq(states.projectId, projectId), eq(states.group, 'triage'), isNull(states.deletedAt)))
      .orderBy(asc(states.sequence), asc(states.id))
      .limit(1)
  const [existing] = await find()
  if (existing) return existing
  await db
    .insert(states)
    .values({
      name: 'Triage',
      slug: 'triage',
      group: 'triage',
      isTriage: true,
      color: '#4E5355',
      sequence: 65000,
      default: false,
      projectId,
      workspaceId
    })
    .onConflictDoNothing()
  const [created] = await find()
  return created
}

/** Re-checks active workspace and project membership inside the first statement of a batch. */
function memberGuard(actor: Actor, slug: string, projectId: number) {
  return sql`exists (select 1 from projects p
    join workspaces w on w.id = p.workspace_id
    join workspace_members wm on wm.workspace_id = w.id and wm.member_id = ${actor.userId}
    join project_members pm on pm.project_id = p.id and pm.workspace_id = w.id and pm.member_id = ${actor.userId}
    where p.id = ${projectId} and w.slug = ${slug} and p.deleted_at is null and w.deleted_at is null
      and wm.is_active = 1 and wm.deleted_at is null and pm.is_active = 1 and pm.deleted_at is null)`
}

const nowMs = sql`cast(unixepoch('subsec') * 1000 as integer)`

/** Labels of the project and assignees that are active members (role member or admin); others are dropped, as in Plane. */
function linkStatements(db: LancityDb, actor: Actor, issueId: SQL<number>, labelIds: number[], assigneeIds: number[]) {
  const statements: Statement[] = []
  if (labelIds.length)
    statements.push(
      db.insert(issueLabels).select(
        sql`select null, ${nowMs}, ${nowMs}, ${actor.userId}, ${actor.userId}, i.id, l.id, i.project_id, i.workspace_id, null
          from issues i join labels l on l.project_id = i.project_id and l.deleted_at is null
          where i.id = ${issueId} and l.id in (select value from json_each(${JSON.stringify(labelIds)}))`
      )
    )
  if (assigneeIds.length)
    statements.push(
      db.insert(issueAssignees).select(
        sql`select null, ${nowMs}, ${nowMs}, ${actor.userId}, ${actor.userId}, pm.member_id, i.id, i.project_id, i.workspace_id, null
          from issues i join project_members pm on pm.project_id = i.project_id and pm.is_active = 1 and pm.deleted_at is null and pm.role >= 15
          where i.id = ${issueId} and pm.member_id in (select value from json_each(${JSON.stringify(assigneeIds)}))`
      )
    )
  return statements
}

/**
 * Create the triage work item and its intake row in one D1 batch (PD-0121, PD-0551): sequence counter, issue in the
 * triage state, intake issue, links, sequence reservation, activity and version. Mirrors `createIssue` of the issue
 * service, which refuses triage states and therefore cannot be used here.
 */
async function insertIntakeIssue(
  db: LancityDb,
  actor: Actor,
  slug: string,
  workspaceId: number,
  projectId: number,
  intakeId: number,
  data: NewIssue
) {
  const html = sanitizeDescriptionHtml(data.description_html ?? '<p></p>')
  const triage = await ensureTriageState(db, workspaceId, projectId)
  const extra = data as Partial<CreateIntakeIssueInput['issue']>
  const json = data.description_json ?? data.description
  const currentSequence = currentSequenceSql(projectId)
  const createdIssueId = createdIssueIdSql(projectId)
  const nextSequence = nextSequenceSql(projectId)
  const mutationId = crypto.randomUUID()
  const event = {
    event: 'created' as const,
    issueId: 0,
    projectId,
    actorId: actor.userId,
    requestedData: data,
    currentInstance: null
  }
  let results: unknown[][]
  try {
    results = await runBatch(db, [
      db
        .insert(projectIssueCounters)
        .select(sql`select null, ${projectId}, ${nextSequence} where ${memberGuard(actor, slug, projectId)}`)
        .onConflictDoUpdate({ target: projectIssueCounters.projectId, set: { lastSequence: nextSequence } }),
      db
        .insert(issues)
        .values({
          name: data.name,
          priority: data.priority ?? 'none',
          stateId: triage.id,
          completedAt: null,
          descriptionHtml: html,
          descriptionStripped: stripTags(html),
          ...(json === undefined || json === null ? {} : { descriptionJson: json }),
          startDate: extra.start_date ?? null,
          targetDate: extra.target_date ?? null,
          sortOrder: newIssueSortOrderSql(projectId, triage.id),
          projectId,
          workspaceId,
          sequenceId: sql`case when changes() = 1 then ${currentSequence} else null end`,
          createdById: actor.userId,
          updatedById: actor.userId
        })
        .returning({ id: issues.id }),
      db
        .insert(intakeIssues)
        .values({
          intakeId,
          projectId,
          workspaceId,
          issueId: createdIssueId,
          source: 'IN_APP',
          createdById: actor.userId,
          updatedById: actor.userId
        })
        .returning(),
      ...linkStatements(
        db,
        actor,
        createdIssueId,
        [...new Set(extra.label_ids ?? [])],
        [...new Set(extra.assignee_ids ?? [])]
      ),
      db.insert(issueSequences).values({
        projectId,
        workspaceId,
        sequence: currentSequence,
        issueId: createdIssueId,
        createdById: actor.userId,
        updatedById: actor.userId
      }),
      activityStatement(db, createdIssueId, projectId, actor.userId, 'created', null, null, null, 'created the issue', null, null, false, mutationId),
      versionStatement(db, createdIssueId, projectId, actor.userId),
      issueEventStatement(db, mutationId, event, sql`json_set(${JSON.stringify(issueEventBody(event, mutationId))},
        '$.issueId', ${createdIssueId}, '$.intake', (select id from intake_issues where issue_id = ${createdIssueId} and intake_id = ${intakeId}))`)
    ])
  } catch (error) {
    await requireProjectAccess(db, actor, slug, projectId, 5)
    throw error
  }
  const [row] = results[2] as IntakeIssueRow[]
  await publishIssueEvent(db, mutationId)
  return row
}

// ---------------------------------------------------------------------------------------------------------------
// read helpers

async function liteIssue(db: LancityDb, issueId: number) {
  const [issue] = await db
    .select(intakeIssueColumns)
    .from(issues)
    .where(and(eq(issues.id, issueId), isNull(issues.deletedAt)))
  return issue ?? null
}

async function toDetail(db: LancityDb, actor: Actor, slug: string, projectId: number, row: IntakeIssueRow) {
  const issue = await retrieveIssueDetail(db, actor, slug, projectId, sql`issues.id = ${row.issueId}`)
  let duplicate: ReturnType<typeof toIssueIntake> | null = null
  if (row.duplicateToId) {
    const lite = await liteIssue(db, row.duplicateToId)
    if (lite) duplicate = toIssueIntake(lite, (await labelIdsByIssue(db, [lite.id])).get(lite.id) ?? [])
  }
  return toIntakeIssueDetailResponse(row, issue, duplicate)
}

/** Public API `issue_detail` (`IssueExpandSerializer`): the issue row, label and assignee ids. */
async function issueExpand(db: LancityDb, issueIds: number[]) {
  const result = new Map<number, Record<string, unknown>>()
  const labels = await labelIdsByIssue(db, issueIds)
  for (let i = 0; i < issueIds.length; i += 80) {
    const chunk = issueIds.slice(i, i + 80)
    const [rows, assignees] = await Promise.all([
      db.select().from(issues).where(inArray(issues.id, chunk)),
      db
        .select({ issueId: issueAssignees.issueId, assigneeId: issueAssignees.assigneeId })
        .from(issueAssignees)
        .where(and(inArray(issueAssignees.issueId, chunk), isNull(issueAssignees.deletedAt)))
        .orderBy(asc(issueAssignees.id))
    ])
    for (const { descriptionBinary: _binary, ...issue } of rows) {
      void _binary
      result.set(issue.id, {
        ...issue,
        labels: labels.get(issue.id) ?? [],
        assignees: assignees.filter(a => a.issueId === issue.id).map(a => a.assigneeId)
      })
    }
  }
  return result
}

function emptyPage(query: IntakeQuery) {
  return paginate<never>(query, {
    paginator: new OffsetPaginator<never>({ fetch: async () => [], count: async () => 0 })
  })
}

// ---------------------------------------------------------------------------------------------------------------
// app API (`inbox-issues`)

/** PD-0549, PD-0550 `IntakeIssueViewSet.list`: pending items by default, `status` and issue filters, paginated. */
export async function listIntakeIssues(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  query: IntakeQuery = {}
) {
  const ctx = await intakeContext(db, actor, slug, projectId)
  const intake = requireIntake(ctx.intake)
  const statuses = parseIntakeStatusQuery(query.status)
  const restricted = await isRestrictedGuest(db, actor.userId, projectId, slug)
  const source = queryIntakeIssue(db, intake.id, projectId, [
    ...issueFilters(query),
    statuses.length ? inArray(intakeIssues.status, statuses) : undefined,
    restricted ? eq(intakeIssues.createdById, actor.userId) : undefined
  ])
  const order = source.page(intakeIssueOrder(query.order_by))
  return paginate(query, {
    paginator: new OffsetPaginator({
      orderBy: query.order_by,
      count: source.count,
      fetch: async (offset, limit) => {
        const rows = await order(offset, limit)
        const labels = await labelIdsByIssue(
          db,
          rows.map(r => r.issue.id)
        )
        return rows.map(r => toIntakeIssueResponse(r.row, r.issue, labels.get(r.issue.id) ?? []))
      }
    })
  })
}

/** PD-0551 `IntakeIssueViewSet.create`: submit a work item to the intake. Any project member, guests included. */
export async function createIntakeIssue(db: LancityDb, actor: Actor, slug: string, projectId: number, raw: unknown) {
  const input = parseInput(createIntakeIssueInputSchema, raw)
  const ctx = await intakeContext(db, actor, slug, projectId)
  const intake = requireIntake(ctx.intake)
  const row = await insertIntakeIssue(db, actor, slug, ctx.workspace.id, projectId, intake.id, input.issue)
  return toDetail(db, actor, slug, projectId, row)
}

/** PD-0553 `IntakeIssueViewSet.retrieve`: a restricted guest only reads items they created (403). */
export async function getIntakeIssue(db: LancityDb, actor: Actor, slug: string, projectId: number, issueId: number) {
  const ctx = await intakeContext(db, actor, slug, projectId)
  const row = await findIntakeIssue(db, requireIntake(ctx.intake).id, projectId, issueId)
  if (!row) throw new ServiceError(404, 'INTAKE_ISSUE_NOT_FOUND', 'The required object does not exist.')
  if (row.createdById !== actor.userId && (await isRestrictedGuest(db, actor.userId, projectId, slug)))
    throw new ServiceError(403, 'FORBIDDEN', 'You are not allowed to view this issue')
  return toDetail(db, actor, slug, projectId, row)
}

/** Fields of the embedded `issue` object mapped to the issue service input (guests may only edit name and description). */
function issueEdit(issue: NonNullable<UpdateIntakeIssueApiInput['issue']>, guest: boolean) {
  const html = issue.description_html
  const json = issue.description_json ?? issue.description
  const edit: Record<string, unknown> = {
    ...(issue.name === undefined ? {} : { name: issue.name }),
    ...(html === undefined || html === null ? {} : { descriptionHtml: sanitizeDescriptionHtml(html) }),
    ...(json === undefined || json === null ? {} : { descriptionJson: json })
  }
  if (!guest) {
    if (issue.priority !== undefined) edit.priority = issue.priority
    if (issue.start_date !== undefined) edit.startDate = issue.start_date
    if (issue.target_date !== undefined) edit.targetDate = issue.target_date
    if (issue.label_ids !== undefined) edit.labelIds = issue.label_ids
    if (issue.assignee_ids !== undefined) edit.assigneeIds = issue.assignee_ids
  }
  return edit
}

type IntakeUpdateContext = {
  workspaceId: number
  projectId: number
  timezone: string
  row: IntakeIssueRow
  canEditIntake: boolean
  guestIssueEdit: boolean
}

/**
 * Shared tail of the app and public update (PD-0124, PD-0552, PD-0016, PD-0317): validate the intake attributes,
 * edit the issue through the issue service, then update the intake row. Accepting a triage item moves it to the
 * project's default state in the same batch as the status change and its activity.
 */
async function applyIntakeUpdate(
  db: LancityDb,
  actor: Actor,
  slug: string,
  ctx: IntakeUpdateContext,
  input: UpdateIntakeIssueApiInput
) {
  const { projectId, row } = ctx
  const patch: Partial<typeof intakeIssues.$inferInsert> = {}
  let transition: { stateId: number; completedAt: Date | null } | null = null
  if (ctx.canEditIntake) {
    if (input.status !== undefined) patch.status = input.status
    if (input.snoozed_till !== undefined) patch.snoozedTill = resolveSnoozedTill(input.snoozed_till, ctx.timezone)
    if (input.source !== undefined) patch.source = input.source
    if (input.source_email !== undefined) patch.sourceEmail = input.source_email
    if (input.duplicate_to !== undefined) {
      if (input.duplicate_to !== null) {
        // PD-0014: a duplicate must be a work item of the intake's own project.
        const [target] = await db
          .select({ id: issues.id })
          .from(issues)
          .where(and(eq(issues.id, input.duplicate_to), eq(issues.projectId, projectId), isNull(issues.deletedAt)))
        if (!target) throw new ServiceError(400, 'VALIDATION_ERROR', 'Work item must belong to the same project')
      }
      patch.duplicateToId = input.duplicate_to
    }
    if (input.status === INTAKE_STATUS.ACCEPTED) {
      // PD-0015: a triage item can only be accepted when the project has a default state to move it to.
      const [current] = await db
        .select({ group: states.group })
        .from(issues)
        .leftJoin(states, eq(states.id, issues.stateId))
        .where(eq(issues.id, row.issueId))
      if (current?.group === 'triage') {
        const [fallback] = await db
          .select({ id: states.id, group: states.group })
          .from(states)
          .where(
            and(
              eq(states.projectId, projectId),
              eq(states.default, true),
              eq(states.isTriage, false),
              isNull(states.deletedAt)
            )
          )
          .orderBy(asc(states.sequence), asc(states.id))
          .limit(1)
        if (!fallback)
          throw new ServiceError(
            400,
            'VALIDATION_ERROR',
            'Cannot accept intake issue: No default state found for the project',
            {
              status: 'Cannot accept intake issue: No default state found for the project'
            }
          )
        transition = {
          stateId: fallback.id,
          completedAt: resolveIssueCompletionTime(fallback.group, { adding: false, stateChanged: true }) ?? null
        }
      }
    }
  }
  if (input.issue) {
    const edit = issueEdit(input.issue, ctx.guestIssueEdit)
    if (Object.keys(edit).length) await updateIssue(db, actor, slug, projectId, row.issueId, edit as UpdateIssueInput)
  }
  if (!Object.keys(patch).length) return
  const intakeUpdate = db
    .update(intakeIssues)
    .set({ ...patch, updatedById: actor.userId })
    .where(and(eq(intakeIssues.id, row.id), isNull(intakeIssues.deletedAt)))
    .returning({ id: intakeIssues.id })
  const statements: Statement[] = []
  if (transition)
    statements.push(
      db
        .update(issues)
        .set({ stateId: transition.stateId, completedAt: transition.completedAt, updatedById: actor.userId })
        .where(
          and(
            eq(issues.id, row.issueId),
            eq(issues.projectId, projectId),
            isNull(issues.deletedAt),
            sql`exists (select 1 from states s where s.id = ${issues.stateId} and (s."group" = 'triage' or s.is_triage = 1))`
          )
        ),
      versionStatement(db, row.issueId, projectId, actor.userId)
    )
  const updateIndex = statements.length
  statements.push(intakeUpdate)
  // Plane `intake.activity.created`: one row per status change, verb is the new status.
  if (input.status !== undefined && patch.status !== undefined)
    statements.push(
      activityStatement(
        db,
        row.issueId,
        projectId,
        actor.userId,
        String(patch.status),
        'intake',
        INTAKE_STATUS_LABEL[row.status] ?? null,
        INTAKE_STATUS_LABEL[patch.status] ?? null,
        'updated the intake status'
      )
    )
  const results = await runBatch(db, statements)
  if (!results[updateIndex]?.length)
    throw new ServiceError(404, 'INTAKE_ISSUE_NOT_FOUND', 'The required object does not exist.')
}

/**
 * PD-0552 `IntakeIssueViewSet.partial_update`. Allowed for project admins and the creator of the work item. Only a
 * project or workspace admin changes the intake attributes; everyone allowed may edit the issue part.
 */
export async function updateIntakeIssue(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  raw: unknown
) {
  const input = parseInput(updateIntakeIssueInputSchema, raw)
  const ctx = await intakeContext(db, actor, slug, projectId)
  const intake = requireIntake(ctx.intake)
  await requirePermission(db, actor, { slug, projectId, pk: issueId }, [ROLE.ADMIN], {
    creator: true,
    model: ISSUE_MODEL
  })
  const row = await findIntakeIssue(db, intake.id, projectId, issueId)
  if (!row) throw new ServiceError(404, 'INTAKE_ISSUE_NOT_FOUND', 'The required object does not exist.')
  const role = ctx.membership.role
  const workspaceAdmin = ctx.workspaceMembership.role === ROLE.ADMIN
  if (role <= ROLE.GUEST && !workspaceAdmin && row.createdById !== actor.userId)
    throw new ServiceError(400, 'CANNOT_EDIT_INTAKE', 'You cannot edit intake issues')
  await applyIntakeUpdate(
    db,
    actor,
    slug,
    {
      workspaceId: ctx.workspace.id,
      projectId,
      timezone: ctx.project.timezone,
      row,
      canEditIntake: role > ROLE.MEMBER || workspaceAdmin,
      guestIssueEdit: role <= ROLE.GUEST
    },
    // The app serializer writes status, duplicate_to, snoozed_till and source only.
    { ...input, source_email: undefined }
  )
  const fresh = await findIntakeIssue(db, intake.id, projectId, issueId)
  return toDetail(db, actor, slug, projectId, fresh ?? row)
}

/** Soft delete an intake issue; the work item goes with it unless it was accepted (PD-0125, PD-0554). */
async function removeIntakeIssue(db: LancityDb, actor: Actor, slug: string, projectId: number, row: IntakeIssueRow) {
  if (
    [INTAKE_STATUS.PENDING, INTAKE_STATUS.REJECTED, INTAKE_STATUS.SNOOZED, INTAKE_STATUS.DUPLICATE].includes(
      row.status as -2
    )
  )
    await deleteIssue(db, actor, slug, projectId, row.issueId)
  await db
    .update(intakeIssues)
    .set({ deletedAt: new Date(), updatedById: actor.userId })
    .where(and(eq(intakeIssues.id, row.id), isNull(intakeIssues.deletedAt)))
}

/** PD-0554 `IntakeIssueViewSet.destroy`: project admin or creator of the work item. */
export async function deleteIntakeIssue(db: LancityDb, actor: Actor, slug: string, projectId: number, issueId: number) {
  const ctx = await intakeContext(db, actor, slug, projectId)
  const intake = requireIntake(ctx.intake)
  await requirePermission(db, actor, { slug, projectId, pk: issueId }, [ROLE.ADMIN], {
    creator: true,
    model: ISSUE_MODEL
  })
  const row = await findIntakeIssue(db, intake.id, projectId, issueId)
  if (!row) throw new ServiceError(404, 'INTAKE_ISSUE_NOT_FOUND', 'The required object does not exist.')
  await removeIntakeIssue(db, actor, slug, projectId, row)
}

// ---------------------------------------------------------------------------------------------------------------
// public API (`intake-issues`): needs `projects.intake_view`, hides lapsed snoozes, answers with `issue_detail`

/** PD-0118 / PD-0122 `get_queryset` conditions: not snoozed past now, and only own items for a restricted guest. */
async function apiConditions(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const restricted = await isRestrictedGuest(db, actor.userId, projectId, slug)
  return [
    or(gte(intakeIssues.snoozedTill, new Date()), isNull(intakeIssues.snoozedTill)),
    restricted ? eq(intakeIssues.createdById, actor.userId) : undefined
  ]
}

async function apiRows(db: LancityDb, rows: IntakeIssueRow[], query: IntakeQuery) {
  const expanded = await issueExpand(
    db,
    rows.map(row => row.issueId)
  )
  const fields = fieldsFromQuery(new URLSearchParams(query as Record<string, string>))
  return rows.map(row => pickFields(toIntakeIssueApiResponse(row, expanded.get(row.issueId) ?? {}), fields))
}

/** PD-0119, PD-0120 `IntakeIssueListCreateAPIEndpoint.get`. */
export async function listIntakeIssuesApi(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  query: IntakeQuery = {}
) {
  const ctx = await intakeContext(db, actor, slug, projectId)
  if (!ctx.intake || !ctx.project.intakeView) return emptyPage(query)
  const source = queryIntakeIssue(db, ctx.intake.id, projectId, await apiConditions(db, actor, slug, projectId))
  const order = source.page(intakeIssueOrder(undefined, '-created_at'))
  return paginate(query, {
    paginator: new OffsetPaginator({
      count: source.count,
      fetch: async (offset, limit) =>
        apiRows(
          db,
          (await order(offset, limit)).map(r => r.row),
          query
        )
    })
  })
}

/** PD-0121 `IntakeIssueListCreateAPIEndpoint.post`. */
export async function createIntakeIssueApi(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  raw: unknown,
  query: IntakeQuery = {}
) {
  const input = parseInput(createIntakeIssueApiInputSchema, raw)
  const ctx = await intakeContext(db, actor, slug, projectId)
  if (!ctx.intake) throw new ServiceError(400, 'INTAKE_DISABLED', NOT_ENABLED)
  const row = await insertIntakeIssue(db, actor, slug, ctx.workspace.id, projectId, ctx.intake.id, input.issue)
  return (await apiRows(db, [row], query))[0]
}

/** PD-0123 `IntakeIssueDetailAPIEndpoint.get`. */
export async function getIntakeIssueApi(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  query: IntakeQuery = {}
) {
  const ctx = await intakeContext(db, actor, slug, projectId)
  if (!ctx.intake || !ctx.project.intakeView)
    throw new ServiceError(404, 'INTAKE_ISSUE_NOT_FOUND', 'The required object does not exist.')
  const source = queryIntakeIssue(db, ctx.intake.id, projectId, [
    eq(intakeIssues.issueId, issueId),
    ...(await apiConditions(db, actor, slug, projectId))
  ])
  const [found] = await source.page(intakeIssueOrder(undefined, '-created_at'))(0, 1)
  if (!found) throw new ServiceError(404, 'INTAKE_ISSUE_NOT_FOUND', 'The required object does not exist.')
  return (await apiRows(db, [found.row], query))[0]
}

/** PD-0124 `IntakeIssueDetailAPIEndpoint.patch`. */
export async function updateIntakeIssueApi(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  raw: unknown,
  query: IntakeQuery = {}
) {
  const input = parseInput(updateIntakeIssueApiInputSchema, raw)
  const ctx = await intakeContext(db, actor, slug, projectId)
  if (!ctx.intake) throw new ServiceError(400, 'INTAKE_DISABLED', NOT_ENABLED)
  const row = await findIntakeIssue(db, ctx.intake.id, projectId, issueId)
  if (!row) throw new ServiceError(404, 'INTAKE_ISSUE_NOT_FOUND', 'The required object does not exist.')
  const role = ctx.membership.role
  // Guests edit only items they created; members and admins reach the creator / admin rule below.
  if (role <= ROLE.GUEST && row.createdById !== actor.userId)
    throw new ServiceError(400, 'CANNOT_EDIT_INTAKE', 'You cannot edit intake work items')
  const [issue] = await db.select({ createdById: issues.createdById }).from(issues).where(eq(issues.id, issueId))
  const workspaceAdmin = ctx.workspaceMembership.role === ROLE.ADMIN
  if (!(role === ROLE.ADMIN || issue?.createdById === actor.userId || workspaceAdmin))
    throw new ServiceError(403, 'FORBIDDEN', 'Only admin or creator can update the work item')
  await applyIntakeUpdate(
    db,
    actor,
    slug,
    {
      workspaceId: ctx.workspace.id,
      projectId,
      timezone: ctx.project.timezone,
      row,
      canEditIntake: role > ROLE.MEMBER,
      guestIssueEdit: role <= ROLE.GUEST
    },
    input
  )
  const fresh = (await findIntakeIssue(db, ctx.intake.id, projectId, issueId)) ?? row
  return (await apiRows(db, [fresh], query))[0]
}

/** PD-0125 `IntakeIssueDetailAPIEndpoint.delete`. */
export async function deleteIntakeIssueApi(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number
) {
  const ctx = await intakeContext(db, actor, slug, projectId)
  if (!ctx.intake) throw new ServiceError(400, 'INTAKE_DISABLED', NOT_ENABLED)
  const row = await findIntakeIssue(db, ctx.intake.id, projectId, issueId)
  if (!row) throw new ServiceError(404, 'INTAKE_ISSUE_NOT_FOUND', 'The required object does not exist.')
  // A restricted guest does not see items of other people at all.
  if (row.createdById !== actor.userId && (await isRestrictedGuest(db, actor.userId, projectId, slug)))
    throw new ServiceError(404, 'INTAKE_ISSUE_NOT_FOUND', 'The required object does not exist.')
  const [issue] = await db.select({ createdById: issues.createdById }).from(issues).where(eq(issues.id, issueId))
  const admin = ctx.membership.role === ROLE.ADMIN || ctx.workspaceMembership.role === ROLE.ADMIN
  if (!(issue?.createdById === actor.userId || admin))
    throw new ServiceError(403, 'FORBIDDEN', 'Only admin or creator can delete the work item')
  await removeIntakeIssue(db, actor, slug, projectId, row)
}
