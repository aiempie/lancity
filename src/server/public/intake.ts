import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { issueSequences, issues, projectIssueCounters, states } from '@/db/schema/issue'
import { intakeIssues } from '@/db/schema/planning'
import { parseInput } from '@/server/api/v1/validation'
import { ServiceError } from '@/server/common/errors'
import { sanitizeHtml } from '@/server/issue/comment-html'
import { issueFilters } from '@/server/issue/filter'
import { versionStatement } from '@/server/issue/jobs/history'
import {
  assertSafeDescriptionHtml,
  createdIssueIdSql,
  currentSequenceSql,
  newIssueSortOrderSql,
  nextSequenceSql,
  stripTags
} from '@/server/issue/sequence'
import { labelIdsByIssue, queryIntakeIssue } from '@/server/intake/queries'
import { publicActivityStatement, requireBoard, type PublicBoard } from '@/server/public/board'
import { publishOutbox } from '@/server/common/outbox'
import type { Actor } from '@/types/auth/schema'
import { publicIntakeCreateSchema, publicIntakeUpdateSchema } from '@/types/content/p3-public-schema'
import type { JsonValue, LancityDb } from '@/types/database/schema'

type IntakeIssueRow = typeof intakeIssues.$inferSelect
type IssueLite = {
  id: number
  name: string
  priority: string
  sequenceId: number
  projectId: number
  createdAt: Date
  createdById: number | null
}
const MAX_LIST = 200

/**
 * Every public intake route needs a session (Plane `BaseViewSet.permission_classes = [IsAuthenticated]`) and a board
 * whose intake is on. The intake in the URL must be the intake of the board.
 */
async function intakeBoard(db: LancityDb, anchor: string, intakeId: number) {
  const board = await requireBoard(db, anchor)
  if (!board.intakeId) throw new ServiceError(400, 'INTAKE_DISABLED', 'Intake is not enabled for this Project Board')
  if (board.intakeId !== intakeId)
    throw new ServiceError(400, 'INTAKE_MISMATCH', 'Intake does not belong to this Project Board')
  return { ...board, intakeId: board.intakeId }
}

/**
 * `IssueStateIntakeSerializer`: the issue card plus its intake state. `id` is the work item id and `bridgeId` the
 * intake issue id used by the item routes, as in Plane's `bridge_id` annotation.
 */
function toPublicIntakeItem(row: IntakeIssueRow, issue: IssueLite, labelIds: number[]) {
  return {
    id: issue.id,
    bridgeId: row.id,
    name: issue.name,
    priority: issue.priority,
    sequenceId: issue.sequenceId,
    projectId: issue.projectId,
    createdAt: issue.createdAt,
    createdBy: issue.createdById,
    labelIds,
    issueIntake: [
      { status: row.status, duplicateTo: row.duplicateToId, snoozedTill: row.snoozedTill, source: row.source }
    ]
  }
}

/** PD-1647 `IntakeIssuePublicViewSet.get_queryset`: the caller's intake issues of the board intake, never other people's. */
function ownIntakeIssues(
  db: LancityDb,
  board: PublicBoard & { intakeId: number },
  actor: Actor,
  where: (SQL | undefined)[] = []
) {
  return queryIntakeIssue(db, board.intakeId, board.projectId, [
    eq(intakeIssues.workspaceId, board.workspaceId),
    eq(intakeIssues.createdById, actor.userId),
    ...where
  ])
}

async function findOwnIntakeIssue(db: LancityDb, board: PublicBoard & { intakeId: number }, actor: Actor, pk: number) {
  const [found] = await ownIntakeIssues(db, board, actor, [eq(intakeIssues.id, pk)]).page(sql`${intakeIssues.id}`)(0, 1)
  if (!found) throw new ServiceError(404, 'INTAKE_ISSUE_NOT_FOUND', 'The required object does not exist.')
  return found
}

/** PD-1648 `IntakeIssuePublicViewSet.list`: with the standard issue filters, snoozed first then by status. */
export async function listPublicIntakeIssues(
  db: LancityDb,
  actor: Actor,
  anchor: string,
  intakeId: number,
  query: Record<string, string | undefined> = {}
) {
  const board = await intakeBoard(db, anchor, intakeId)
  const rows = await ownIntakeIssues(db, board, actor, issueFilters(query)).page(
    sql`${intakeIssues.snoozedTill} asc nulls last, ${intakeIssues.status} asc, ${intakeIssues.id} asc`
  )(0, MAX_LIST)
  const labels = await labelIdsByIssue(
    db,
    rows.map(r => r.issue.id)
  )
  return rows.map(r => toPublicIntakeItem(r.row, r.issue, labels.get(r.issue.id) ?? []))
}

/** PD-1651 `IntakeIssuePublicViewSet.retrieve`. */
export async function getPublicIntakeIssue(db: LancityDb, actor: Actor, anchor: string, intakeId: number, pk: number) {
  const board = await intakeBoard(db, anchor, intakeId)
  const found = await findOwnIntakeIssue(db, board, actor, pk)
  const labels = await labelIdsByIssue(db, [found.issue.id])
  return toPublicIntakeItem(found.row, found.issue, labels.get(found.issue.id) ?? [])
}

/** The project triage state, created on first use (`State.triage_objects.first()` fallback of Plane). */
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

/** Re-checks inside the first statement of the batch that the board still serves this intake. */
function boardGuard(anchor: string, intakeId: number) {
  return sql`exists (select 1 from deploy_boards d join projects p on p.id = d.project_id and p.workspace_id = d.workspace_id
    where d.anchor = ${anchor} and d.intake_id = ${intakeId} and d.entity_name = 'project' and d.entity_identifier = p.id
      and d.is_disabled = 0 and d.deleted_at is null and p.deleted_at is null and p.archived_at is null)`
}

/**
 * PD-1649 `IntakeIssuePublicViewSet.create`: a visitor files a work item into the board intake. The issue starts in
 * the triage state with source `IN_APP`. The queue handler records the activity (`issue.activity.created`), so the
 * batch writes the counter, the issue, the intake row, the sequence reservation and the version only.
 */
export async function createPublicIntakeIssue(
  db: LancityDb,
  actor: Actor,
  anchor: string,
  intakeId: number,
  raw: unknown
) {
  const board = await intakeBoard(db, anchor, intakeId)
  const { issue: data } = parseInput(publicIntakeCreateSchema, raw)
  const html = sanitizeHtml(data.description_html ?? '<p></p>') || '<p></p>'
  assertSafeDescriptionHtml(html)
  const triage = await ensureTriageState(db, board.workspaceId, board.projectId)
  const { projectId, workspaceId } = board
  const currentSequence = currentSequenceSql(projectId)
  const createdIssueId = createdIssueIdSql(projectId)
  const nextSequence = nextSequenceSql(projectId)
  const eventKey = crypto.randomUUID()
  const activity = { type: 'issue.activity.created' as const, requestedData: { issue: data }, currentInstance: null,
    issueId: 0, actorId: actor.userId, projectId, notification: true, epoch: Math.floor(Date.now() / 1000) }
  let results: unknown[][]
  try {
    results = await db.batch([
      db
        .insert(projectIssueCounters)
        .select(sql`select null, ${projectId}, ${nextSequence} where ${boardGuard(anchor, intakeId)}`)
        .onConflictDoUpdate({ target: projectIssueCounters.projectId, set: { lastSequence: nextSequence } }),
      db
        .insert(issues)
        .values({
          name: data.name,
          priority: data.priority ?? 'low',
          stateId: triage.id,
          completedAt: null,
          descriptionHtml: html,
          descriptionStripped: stripTags(html),
          descriptionJson: (data.description_json ?? {}) as JsonValue,
          sortOrder: newIssueSortOrderSql(projectId, triage.id),
          projectId,
          workspaceId,
          sequenceId: sql`case when changes() = 1 then ${currentSequence} else null end`,
          createdById: actor.userId,
          updatedById: actor.userId
        })
        .returning({ id: issues.id }),
      publicActivityStatement(db, eventKey, activity, sql`json_set(${JSON.stringify(activity)}, '$.issueId', ${createdIssueId})`),
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
      db.insert(issueSequences).values({
        projectId,
        workspaceId,
        sequence: currentSequence,
        issueId: createdIssueId,
        createdById: actor.userId,
        updatedById: actor.userId
      }),
      versionStatement(db, createdIssueId, projectId, actor.userId)
    ] as never)
  } catch (error) {
    await intakeBoard(db, anchor, intakeId)
    throw error
  }
  const [row] = results[3] as IntakeIssueRow[]
  await publishOutbox(db, eventKey)
  return getPublicIntakeIssue(db, actor, anchor, intakeId, row.id)
}

/**
 * PD-1650 `IntakeIssuePublicViewSet.partial_update`: the creator edits name and description. Plane never checks the
 * intake status; a work item that was already accepted or declined is locked here (409) because it belongs to the
 * project team by then.
 */
export async function updatePublicIntakeIssue(
  db: LancityDb,
  actor: Actor,
  anchor: string,
  intakeId: number,
  pk: number,
  raw: unknown
) {
  const board = await intakeBoard(db, anchor, intakeId)
  const { issue: data } = parseInput(publicIntakeUpdateSchema, raw)
  const found = await findOwnIntakeIssue(db, board, actor, pk)
  if (found.row.status !== -2)
    throw new ServiceError(409, 'INTAKE_ISSUE_LOCKED', 'This intake issue has already been reviewed')
  const [current] = await db
    .select({ name: issues.name, html: issues.descriptionHtml, json: issues.descriptionJson })
    .from(issues)
    .where(and(eq(issues.id, found.issue.id), eq(issues.projectId, board.projectId), isNull(issues.deletedAt)))
    .limit(1)
  if (!current) throw new ServiceError(404, 'INTAKE_ISSUE_NOT_FOUND', 'The required object does not exist.')
  const html = data.description_html === undefined ? undefined : sanitizeHtml(data.description_html) || '<p></p>'
  if (html) assertSafeDescriptionHtml(html)
  const set = {
    updatedById: actor.userId,
    ...(data.name === undefined ? {} : { name: data.name }),
    ...(html === undefined ? {} : { descriptionHtml: html, descriptionStripped: stripTags(html) }),
    ...(data.description_json === undefined ? {} : { descriptionJson: data.description_json as JsonValue })
  }
  const eventKey = crypto.randomUUID()
  const [updatedRows] = await db.batch([db
    .update(issues)
    .set(set)
    .where(
      and(
        eq(issues.id, found.issue.id),
        eq(issues.projectId, board.projectId),
        isNull(issues.deletedAt),
        sql`exists (select 1 from intake_issues ii where ii.id = ${pk} and ii.issue_id = issues.id and ii.status = -2
          and ii.created_by_id = ${actor.userId} and ii.deleted_at is null)`
      )
    )
    .returning({ id: issues.id }),
    publicActivityStatement(db, eventKey, {
      type: 'issue.activity.updated', requestedData: { name: data.name, description_html: html },
      currentInstance: { name: current.name, description_html: current.html }, issueId: found.issue.id,
      actorId: actor.userId, projectId: board.projectId, notification: true
    })
  ])
  const [updated] = updatedRows
  if (!updated) throw new ServiceError(409, 'INTAKE_ISSUE_LOCKED', 'This intake issue has already been reviewed')
  await publishOutbox(db, eventKey)
  return getPublicIntakeIssue(db, actor, anchor, intakeId, pk)
}

/**
 * PD-1652 `IntakeIssuePublicViewSet.destroy`: the creator withdraws a pending submission. Plane removes only the intake
 * row and leaves the triage work item behind; both are soft-deleted here.
 */
export async function deletePublicIntakeIssue(
  db: LancityDb,
  actor: Actor,
  anchor: string,
  intakeId: number,
  pk: number
) {
  const board = await intakeBoard(db, anchor, intakeId)
  const found = await findOwnIntakeIssue(db, board, actor, pk)
  if (found.row.status !== -2)
    throw new ServiceError(409, 'INTAKE_ISSUE_LOCKED', 'This intake issue has already been reviewed')
  const now = new Date()
  const [removed] = await db.batch([
    db
      .update(intakeIssues)
      .set({ deletedAt: now, updatedById: actor.userId })
      .where(
        and(
          eq(intakeIssues.id, pk),
          eq(intakeIssues.createdById, actor.userId),
          eq(intakeIssues.status, -2),
          isNull(intakeIssues.deletedAt)
        )
      )
      .returning({ id: intakeIssues.id }),
    db
      .update(issues)
      .set({ deletedAt: now, updatedById: actor.userId })
      .where(and(eq(issues.id, found.issue.id), eq(issues.projectId, board.projectId), sql`changes() = 1`))
  ])
  if (!removed[0]) throw new ServiceError(409, 'INTAKE_ISSUE_LOCKED', 'This intake issue has already been reviewed')
}
