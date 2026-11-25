import { and, eq, isNull, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { issueSequences, issues } from '@/db/schema/issue'
import { parseInput } from '@/server/api/v1/validation'
import { ServiceError } from '@/server/common/errors'
import type { InfraEnv } from '@/server/common/env'
import { issueEventStatement, publishIssueEvent } from '@/server/issue/events'
import { outboxStatement, publishOutbox } from '@/server/common/outbox'
import { activityStatement, archiveActivityValues, versionStatement } from '@/server/issue/jobs/history'
import { LIVE_ISSUES, issueListContext, paginateIssues, parsePagination, retrieveIssueDetail } from '@/server/issue/list'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import {
  bulkIssueIdsInputSchema,
  bulkUpdateDatesInputSchema,
  type BulkIssueIdsInput,
  type BulkUpdateDatesInput,
  type IssueListQuery
} from '@/types/issue/schema'

type Statement = BatchItem<'sqlite'>
const ARCHIVABLE_GROUPS = ['completed', 'cancelled']
const BATCH_ISSUES = 20
const nowMs = sql`cast(unixepoch('subsec') * 1000 as integer)`
const today = () => new Date().toISOString().slice(0, 10)
const idList = (ids: number[]) =>
  sql.join(
    ids.map(id => sql`${id}`),
    sql`, `
  )

async function run(db: LancityDb, statements: Statement[]) {
  return (await db.batch(statements as [Statement, ...Statement[]])) as unknown as unknown[][]
}

/** The actor is an active admin or member of the project, rechecked inside the mutation statement. */
function canWrite(actor: Actor, slug: string, projectId: number) {
  return sql`exists (select 1 from project_members pm
    join workspace_members wm on wm.workspace_id = pm.workspace_id and wm.member_id = pm.member_id
    join workspaces w on w.id = pm.workspace_id
    where pm.project_id = ${projectId} and pm.member_id = ${actor.userId} and pm.is_active = 1 and pm.deleted_at is null
      and wm.is_active = 1 and wm.deleted_at is null and w.slug = ${slug} and (wm.role = 20 or pm.role >= 15))`
}

type ArchiveRow = { id: number; state_group: string | null; archived_at: string | null }
async function loadIssues(db: LancityDb, projectId: number, workspaceId: number, ids: number[], live: boolean) {
  return db.all<ArchiveRow>(sql`select issues.id, s."group" as state_group, issues.archived_at
    from issues left join states s on s.id = issues.state_id
    where issues.id in (${idList(ids)}) and issues.project_id = ${projectId} and issues.workspace_id = ${workspaceId}
      and ${live ? LIVE_ISSUES : sql`issues.deleted_at is null`} order by issues.id`)
}

/** Port of `IssueArchiveViewSet.list` (PD-0562): archived issues, filters and grouping as in the main list. */
export async function listIssueArchives(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  query: IssueListQuery
) {
  const ctx = await issueListContext(db, actor, slug, projectId, 15)
  parsePagination(query)
  return paginateIssues(db, ctx, query, 'archived')
}

/** Port of `IssueArchiveViewSet.retrieve` (PD-0566). */
export async function getIssueArchive(db: LancityDb, actor: Actor, slug: string, projectId: number, issueId: number) {
  await requireProjectAccess(db, actor, slug, projectId, 15)
  return retrieveIssueDetail(db, actor, slug, projectId, sql`issues.id = ${issueId} and issues.archived_at is not null`)
}

/** Set or clear `archived_at` for rows already validated by the caller (`applyAnnotations` of the archive view, PD-0560). */
async function archiveRows(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  rows: ArchiveRow[],
  archivedAt: string | null
) {
  // Plane `track_archive_at`: `manual_archive` and `restore` (not the dates).
  const activity = archiveActivityValues(archivedAt !== null)
  for (let start = 0; start < rows.length; start += BATCH_ISSUES) {
    const statements: Statement[] = []
    const publications: string[] = []
    for (const row of rows.slice(start, start + BATCH_ISSUES)) {
      const mutationId = crypto.randomUUID()
      publications.push(mutationId)
      statements.push(
        db.update(issues)
          .set({ archivedAt, updatedById: actor.userId, updatedAt: sql`max(${issues.updatedAt} + 1, ${nowMs})` })
          .where(and(eq(issues.id, row.id), eq(issues.projectId, projectId), isNull(issues.deletedAt), canWrite(actor, slug, projectId))),
        activityStatement(db, row.id, projectId, actor.userId, 'updated', 'archived_at', activity.oldValue,
          activity.newValue, activity.comment, null, null, false, mutationId),
        issueEventStatement(db, mutationId, {
          event: archivedAt ? 'archived' : 'unarchived', issueId: row.id, projectId, actorId: actor.userId,
          requestedData: { archived_at: archivedAt, automation: false }, currentInstance: { archived_at: row.archived_at }
        }),
        versionStatement(db, row.id, projectId, actor.userId)
      )
    }
    await run(db, statements)
    for (const key of publications) await publishIssueEvent(db, key)
  }
}

/** Port of `IssueArchiveViewSet.archive` (PD-0567). Only completed or cancelled issues can be archived. */
export async function archiveIssue(db: LancityDb, actor: Actor, slug: string, projectId: number, issueId: number) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 15)
  const [row] = await loadIssues(db, projectId, workspace.id, [issueId], true)
  if (!row) throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Issue not found')
  if (!row.state_group || !ARCHIVABLE_GROUPS.includes(row.state_group))
    throw new ServiceError(400, 'INVALID_ARCHIVE_STATE_GROUP', 'Can only archive completed or cancelled state group issue')
  const archivedAt = today()
  await archiveRows(db, actor, slug, projectId, [row], archivedAt)
  return { archivedAt }
}

/** Port of `IssueArchiveViewSet.unarchive` (PD-0568). */
export async function unarchiveIssue(db: LancityDb, actor: Actor, slug: string, projectId: number, issueId: number) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 15)
  const [row] = await loadIssues(db, projectId, workspace.id, [issueId], false)
  if (!row?.archived_at) throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Issue not found')
  await archiveRows(db, actor, slug, projectId, [row], null)
}

/**
 * Port of `BulkArchiveIssuesEndpoint.post` (PD-0569). Every issue is checked first, so one that is not completed or
 * cancelled leaves all of them untouched. Unknown ids are skipped.
 */
export async function bulkArchiveIssues(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  rawInput: BulkIssueIdsInput
) {
  const input = parseInput(bulkIssueIdsInputSchema, rawInput)
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 15)
  const rows = await loadIssues(db, projectId, workspace.id, [...new Set(input.issueIds)], false)
  if (rows.some(row => !row.state_group || !ARCHIVABLE_GROUPS.includes(row.state_group)))
    throw new ServiceError(400, 'INVALID_ARCHIVE_STATE_GROUP', 'INVALID_ARCHIVE_STATE_GROUP')
  const archivedAt = today()
  await archiveRows(db, actor, slug, projectId, rows, archivedAt)
  return { archivedAt }
}

/**
 * Port of `BulkDeleteIssuesEndpoint.delete` (PD-0592): admins only. Soft deletes live issues together with their
 * related rows asynchronously, and keeps the sequence reservations so numbers are never reused.
 */
export async function bulkDeleteIssues(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  rawInput: BulkIssueIdsInput,
  env?: InfraEnv
) {
  const input = parseInput(bulkIssueIdsInputSchema, rawInput)
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 20)
  // `BulkDeleteIssuesEndpoint` uses `Issue.issue_objects`: archived issues are not part of a bulk delete.
  const rows = await loadIssues(db, projectId, workspace.id, [...new Set(input.issueIds)], true)
  const ids = rows.map(row => row.id)
  for (const id of ids) {
    const mutationId = crypto.randomUUID()
    const cascadeKey = `${mutationId}:cascade`
    const event = { event: 'deleted' as const, issueId: id, projectId, actorId: actor.userId,
      requestedData: { issueId: id }, currentInstance: null }
    await run(db, [
      db.update(issues)
        .set({ deletedAt: new Date(), updatedById: actor.userId, updatedAt: sql`max(${issues.updatedAt} + 1, ${nowMs})` })
        .where(and(eq(issues.id, id), eq(issues.projectId, projectId), isNull(issues.deletedAt), canWrite(actor, slug, projectId))),
      activityStatement(db, id, projectId, actor.userId, 'deleted', 'issue', null, null, 'deleted the issue', null, null, true, mutationId),
      issueEventStatement(db, mutationId, event),
      outboxStatement(db, cascadeKey, 'maintenance.soft_delete_related', { model: 'issues', id }, sql`changes() = 1`),
      db.update(issueSequences).set({ deleted: true, updatedById: actor.userId })
        .where(and(eq(issueSequences.issueId, id), sql`changes() = 1`))
    ])
    await publishOutbox(db, mutationId, env)
    await publishOutbox(db, cascadeKey, env)
  }
  return { message: `${ids.length} issues were deleted`, deleted: ids.length }
}

/** Port of `IssueBulkUpdateDateEndpoint.validate_dates` (PD-0601): the effective start must not pass the target. */
export function validateDatesIssueBulkUpdateDate(
  currentStart: string | null,
  currentTarget: string | null,
  newStart?: string | null,
  newTarget?: string | null
) {
  const start = newStart || currentStart
  const target = newTarget || currentTarget
  return !(start && target && start > target)
}

/** Port of `IssueBulkUpdateDateEndpoint.post` (PD-0602): every update is validated before any is applied. */
export async function bulkUpdateIssueDates(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  rawInput: BulkUpdateDatesInput
) {
  const input = parseInput(bulkUpdateDatesInputSchema, rawInput)
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 15)
  const ids = [...new Set(input.updates.map(update => update.id))]
  const found = await db.all<{ id: number; start_date: string | null; target_date: string | null }>(
    sql`select id, start_date, target_date from issues where id in (${idList(ids)}) and project_id = ${projectId}
      and workspace_id = ${workspace.id} and deleted_at is null`
  )
  const byId = new Map(found.map(row => [row.id, row]))
  const work: Array<{ id: number; start?: string; target?: string; before: { start: string | null; target: string | null } }> = []
  for (const update of input.updates) {
    const issue = byId.get(update.id)
    if (!issue) continue
    if (!validateDatesIssueBulkUpdateDate(issue.start_date, issue.target_date, update.startDate, update.targetDate))
      throw new ServiceError(400, 'VALIDATION_ERROR', 'Start date cannot exceed target date')
    if (update.startDate || update.targetDate)
      work.push({
        id: update.id,
        start: update.startDate,
        target: update.targetDate,
        before: { start: issue.start_date, target: issue.target_date }
      })
  }
  for (let start = 0; start < work.length; start += BATCH_ISSUES) {
    const statements: Statement[] = []
    const publications: string[] = []
    for (const item of work.slice(start, start + BATCH_ISSUES)) {
      statements.push(
        db
          .update(issues)
          .set({
            updatedById: actor.userId,
            updatedAt: sql`max(${issues.updatedAt} + 1, ${nowMs})`,
            ...(item.start ? { startDate: item.start } : {}),
            ...(item.target ? { targetDate: item.target } : {})
          })
          .where(
            and(
              eq(issues.id, item.id),
              eq(issues.projectId, projectId),
              isNull(issues.deletedAt),
              canWrite(actor, slug, projectId)
            )
          )
      )
      for (const [field, value, before, comment] of [
        ['start_date', item.start, item.before.start, 'updated the start date to '],
        ['target_date', item.target, item.before.target, 'updated the target date to']
      ] as const) {
        if (!value) continue
        const mutationId = crypto.randomUUID()
        publications.push(mutationId)
        statements.push(
          activityStatement(db, item.id, projectId, actor.userId, 'updated', field, before ?? '', value, comment, null, null, false, mutationId),
          issueEventStatement(db, mutationId, { event: 'updated', issueId: item.id, projectId, actorId: actor.userId,
            requestedData: { [field]: value }, currentInstance: { [field]: before } })
        )
      }
      statements.push(versionStatement(db, item.id, projectId, actor.userId))
    }
    await run(db, statements)
    for (const key of publications) await publishIssueEvent(db, key)
  }
  return { message: 'Issues updated successfully', updated: work.length }
}
