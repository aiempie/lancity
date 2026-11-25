import { and, asc, count, desc, eq, isNull } from 'drizzle-orm'
import { importJobs } from '@/db/schema/ext-p3-export'
import { ROLE } from '@/server/common/permissions'
import { checkRateLimit, parseRate } from '@/server/common/rate-limit'
import { ServiceError, notFoundError, parseError } from '@/server/common/errors'
import { OffsetPaginator, paginate } from '@/server/common/pagination'
import { requireBucket, deleteFiles, uploadFile } from '@/server/asset/storage'
import { IMPORT_ISSUES_JOB } from '@/server/import/events'
import { ImportParseError, decodeImportFile, importFormatOf } from '@/server/import/mapping'
import { presentImportJob } from '@/server/import/presenters'
import { requireProjectAccess } from '@/server/project/permissions'
import { parseInput } from '@/server/api/v1/validation'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import { MAX_IMPORT_BYTES, importIssuesFieldsSchema, type ImportIssuesPayload } from '@/types/reporting/p3-export-schema'

const IMPORT_RATE = parseRate('10/hour')

async function queueImportJob(payload: ImportIssuesPayload): Promise<void> {
  const [{ getEnv }, { enqueueJob }] = await Promise.all([import('@/server/common/env'), import('@/server/common/jobs')])
  await enqueueJob(getEnv(), { type: IMPORT_ISSUES_JOB, payload })
}

/**
 * Start an import of issues from an uploaded CSV, JSON or XLSX file, or from a Plane export (`source=plane`).
 * The upload is validated and counted here, stored in R2 and handled by the `import.issues` job in chunks.
 */
export async function startImport(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  file: File,
  rawFields: unknown,
  bucket?: R2Bucket
) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, ROLE.MEMBER)
  const fields = parseInput(importIssuesFieldsSchema, rawFields)
  const format = importFormatOf(file.name)
  if (!format) throw new ServiceError(400, 'UNSUPPORTED_FILE', 'Upload a .csv, .json or .xlsx file')
  if (file.size > MAX_IMPORT_BYTES) throw new ServiceError(413, 'FILE_TOO_LARGE', `The file exceeds ${MAX_IMPORT_BYTES / 1024 / 1024} MiB`)
  const store = requireBucket(bucket)
  const bytes = new Uint8Array(await file.arrayBuffer())
  let totalRows: number
  try {
    totalRows = (await decodeImportFile(format, bytes)).length
  } catch (error) {
    if (error instanceof ImportParseError) throw new ServiceError(400, 'INVALID_IMPORT_FILE', error.message)
    throw error
  }
  if (!totalRows) throw new ServiceError(400, 'EMPTY_IMPORT', 'The file has no rows')
  const limit = await checkRateLimit(db, `import:${actor.userId}`, IMPORT_RATE)
  if (!limit.allowed) throw new ServiceError(429, 'RATE_LIMITED', 'Too many imports, try again later', { retry_after: limit.retryAfter })
  const key = `${workspace.id}/imports/${projectId}/${crypto.randomUUID().replaceAll('-', '')}.${format}`
  await uploadFile(store, key, bytes)
  const [created] = await db
    .insert(importJobs)
    .values({
      workspaceId: workspace.id,
      projectId,
      initiatedById: actor.userId,
      source: fields.source,
      format,
      fileName: file.name.slice(0, 255),
      fileKey: key,
      totalRows,
      createdById: actor.userId,
      updatedById: actor.userId
    })
    .returning()
  try {
    await queueImportJob({ importId: created.id })
  } catch (error) {
    await db.update(importJobs).set({ status: 'failed', reason: 'The import could not be queued' }).where(eq(importJobs.id, created.id))
    await deleteFiles(store, [key])
    throw error
  }
  return presentImportJob(created)
}

async function importScope(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { workspace, membership, workspaceMembership } = await requireProjectAccess(db, actor, slug, projectId, ROLE.MEMBER)
  const isAdmin = workspaceMembership.role === ROLE.ADMIN || membership.role === ROLE.ADMIN
  return and(
    eq(importJobs.workspaceId, workspace.id),
    eq(importJobs.projectId, projectId),
    isNull(importJobs.deletedAt),
    isAdmin ? undefined : eq(importJobs.initiatedById, actor.userId)
  )
}

/** Imports of a project, newest first. Admins see all of them, other members their own. */
export async function listImports(db: LancityDb, actor: Actor, slug: string, projectId: number, query: URLSearchParams) {
  const where = await importScope(db, actor, slug, projectId)
  if (!query.get('per_page') || !query.get('cursor')) throw parseError('per_page and cursor are required')
  const paginator = new OffsetPaginator({
    orderBy: '-created_at',
    fetch: async (offset, limit) =>
      (await db.select().from(importJobs).where(where).orderBy(desc(importJobs.createdAt), asc(importJobs.id)).limit(limit).offset(offset)).map(row =>
        presentImportJob(row)
      ),
    count: async () => (await db.select({ total: count() }).from(importJobs).where(where))[0]?.total ?? 0
  })
  return paginate(query, { paginator })
}

/** One import with its row errors and warnings. */
export async function getImport(db: LancityDb, actor: Actor, slug: string, projectId: number, importId: number) {
  const where = await importScope(db, actor, slug, projectId)
  const [row] = await db.select().from(importJobs).where(and(where, eq(importJobs.id, importId)))
  if (!row) throw notFoundError('The import does not exist.', 'IMPORT_NOT_FOUND')
  return presentImportJob(row, { includeErrors: true })
}
