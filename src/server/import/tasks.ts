import { and, eq, inArray, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@/db/schema'
import { user } from '@/db/schema/auth'
import { importJobs } from '@/db/schema/ext-p3-export'
import { issues, labels, states } from '@/db/schema/issue'
import { projectMembers, projects } from '@/db/schema/workspace'
import { requireBucket } from '@/server/asset/storage'
import { ServiceError } from '@/server/common/errors'
import { logException } from '@/server/common/exception-logger'
import type { InfraEnv } from '@/server/common/env'
import { enqueueJob } from '@/server/common/jobs'
import { IMPORT_ISSUES_JOB } from '@/server/import/events'
import { ImportParseError, decodeImportFile, mapImportRow, type ImportLookups } from '@/server/import/mapping'
import { createIssue } from '@/server/issue/service'
import type { LancityDb } from '@/types/database/schema'
import type { ImportFormat, ImportIssuesPayload } from '@/types/reporting/p3-export-schema'

/** Rows per job run. One `createIssue` costs about a dozen D1 calls, so this stays under the subrequest limit. */
export const IMPORT_CHUNK = 40
const MAX_ERRORS = 200

type RowIssue = { row: number; level: 'error' | 'warning'; message: string }

async function loadLookups(db: LancityDb, projectId: number): Promise<ImportLookups> {
  const [[project], stateRows, labelRows, memberRows] = await Promise.all([
    db.select({ identifier: projects.identifier }).from(projects).where(eq(projects.id, projectId)),
    db.select({ id: states.id, name: states.name }).from(states).where(and(eq(states.projectId, projectId), isNull(states.deletedAt), eq(states.isTriage, false))),
    db.select({ id: labels.id, name: labels.name }).from(labels).where(and(eq(labels.projectId, projectId), isNull(labels.deletedAt))),
    db
      .select({ id: user.id, name: user.name, email: user.email, username: user.username })
      .from(projectMembers)
      .innerJoin(user, eq(user.id, projectMembers.memberId))
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.isActive, true), isNull(projectMembers.deletedAt)))
  ])
  const byName = (rows: { id: number; name: string }[]) => new Map(rows.map(row => [row.name.toLowerCase(), row.id]))
  const members = new Map<string, number | null>()
  for (const member of memberRows) {
    for (const key of [member.email, member.username, member.name]) {
      if (!key) continue
      const lower = key.toLowerCase()
      members.set(lower, members.has(lower) && members.get(lower) !== member.id ? null : member.id)
    }
  }
  return { states: byName(stateRows), labels: byName(labelRows), members, projectIdentifier: project?.identifier ?? '' }
}

/**
 * Handle one chunk of an import and queue the next. The job row holds the offset: a redelivered message
 * restarts the chunk, and rows already created are recognised by their external id, so nothing is created twice.
 */
export async function importIssuesTask(env: InfraEnv, payload: ImportIssuesPayload): Promise<void> {
  const db = drizzle(env.DB, { schema }) as unknown as LancityDb
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, payload.importId))
  if (!job || job.status === 'completed' || job.status === 'failed') return
  const offset = payload.offset ?? job.processedRows
  if (payload.offset !== undefined && payload.offset < job.processedRows) {
    // This chunk is already stored (a redelivery after the row update). Only make sure the next one is queued.
    await enqueueJob(env, {
      type: IMPORT_ISSUES_JOB,
      payload: { importId: job.id, offset: job.processedRows },
      id: `${IMPORT_ISSUES_JOB}:${job.id}:${job.processedRows}`
    })
    return
  }
  const fail = (reason: string) =>
    db.update(importJobs).set({ status: 'failed', reason: reason.slice(0, 1000), completedAt: new Date() }).where(eq(importJobs.id, job.id))
  try {
    if (job.status === 'queued') await db.update(importJobs).set({ status: 'processing' }).where(eq(importJobs.id, job.id))
    const object = await requireBucket(env.ASSET_BUCKET).get(job.fileKey)
    if (!object) return void (await fail('The uploaded file is no longer available'))
    const records = await decodeImportFile(job.format as ImportFormat, new Uint8Array(await object.arrayBuffer()))
    const chunk = records.slice(offset, offset + IMPORT_CHUNK)
    const lookups = await loadLookups(db, job.projectId)
    const slug = await slugOf(db, job.workspaceId)
    const externalSource = `import:${job.id}`
    const externalIds = chunk.map((_, i) => String(offset + i + 1))
    const existing = chunk.length
      ? new Set(
          (
            await db
              .select({ externalId: issues.externalId })
              .from(issues)
              .where(and(eq(issues.projectId, job.projectId), eq(issues.externalSource, externalSource), inArray(issues.externalId, externalIds)))
          ).map(row => row.externalId)
        )
      : new Set<string | null>()
    const mapped = chunk.map((record, i) => mapImportRow(record, lookups, externalSource, externalIds[i]))
    const sequences = [...new Set(mapped.flatMap(row => (row.parentSequence ? [row.parentSequence] : [])))]
    const parents = new Map<number, number>()
    if (sequences.length) {
      const rows = await db
        .select({ id: issues.id, sequenceId: issues.sequenceId })
        .from(issues)
        .where(and(eq(issues.projectId, job.projectId), isNull(issues.deletedAt), inArray(issues.sequenceId, sequences)))
      for (const row of rows) parents.set(row.sequenceId, row.id)
    }
    const problems: RowIssue[] = []
    let created = 0
    let failed = 0
    for (const [i, row] of mapped.entries()) {
      const number = offset + i + 1
      for (const message of row.warnings) problems.push({ row: number, level: 'warning', message })
      if (existing.has(externalIds[i])) {
        created++
        continue
      }
      if (!row.input) {
        failed++
        problems.push({ row: number, level: 'error', message: row.error ?? 'The row is invalid' })
        continue
      }
      let parentId: number | undefined
      if (row.parentSequence) {
        parentId = parents.get(row.parentSequence)
        if (!parentId) problems.push({ row: number, level: 'warning', message: `Parent issue ${row.parentSequence} not found` })
      }
      try {
        await createIssue(db, { userId: job.initiatedById }, slug, job.projectId, {
          ...row.input,
          ...(parentId ? { parentId } : {})
        })
        created++
      } catch (error) {
        if (!(error instanceof ServiceError)) throw error
        failed++
        problems.push({ row: number, level: 'error', message: error.message })
      }
    }
    const next = offset + chunk.length
    const done = next >= records.length
    const errors = [...(job.errors as unknown as RowIssue[]), ...problems].slice(0, MAX_ERRORS)
    await db
      .update(importJobs)
      .set({
        processedRows: next,
        createdCount: job.createdCount + created,
        failedCount: job.failedCount + failed,
        errors,
        ...(done ? { status: 'completed' as const, completedAt: new Date() } : {})
      })
      .where(eq(importJobs.id, job.id))
    if (!done)
      await enqueueJob(env, { type: IMPORT_ISSUES_JOB, payload: { importId: job.id, offset: next }, id: `${IMPORT_ISSUES_JOB}:${job.id}:${next}` })
  } catch (error) {
    logException(error, { context: { label: 'import.issues', importId: job.id } })
    // A thrown error makes Queues retry the chunk. Errors that cannot succeed on retry end the import.
    if (error instanceof ServiceError || error instanceof ImportParseError) {
      await fail(error.message)
      return
    }
    throw error
  }
}

async function slugOf(db: LancityDb, workspaceId: number): Promise<string> {
  const [row] = await db.select({ slug: schema.workspaces.slug }).from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId))
  if (!row) throw new ServiceError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found')
  return row.slug
}
