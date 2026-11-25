import { and, eq, isNull } from 'drizzle-orm'
import { pages } from '@/db/schema/content'
import { getDb } from '@/db/client'
import { logJson, type InfraEnv } from '@/server/common/env'
import { ServiceError } from '@/server/common/errors'
import { enqueueJob } from '@/server/common/jobs'
import { requireBucket } from '@/server/asset/storage'
import { PDF_JOB, PDF_PREFIX, PDF_RETENTION_MS, pdfErrorKey, pdfKey } from '@/server/pdf/events'
import { enforceExportRate, exportToPdf, loadPageForPrint } from '@/server/pdf/pdf-export.service'
import type { Actor } from '@/types/auth/schema'
import type { PdfExportBody, PdfExportJob } from '@/types/content/p4-pdf-schema'
import type { LancityDb } from '@/types/database/schema'

/** Queue an export. Access is checked now; the job renders later and stores the PDF in R2. */
export async function startPdfExport(
  db: LancityDb,
  env: InfraEnv,
  actor: Actor,
  slug: string,
  projectId: number,
  pageId: number,
  input: Omit<PdfExportBody, 'async'>
) {
  requireBucket(env.ASSET_BUCKET)
  const page = await loadPageForPrint(db, actor, slug, projectId, pageId)
  await enforceExportRate(db, actor)
  const token = crypto.randomUUID()
  const { fileName, ...options } = input
  const payload: PdfExportJob = {
    token,
    workspaceId: page.workspaceId,
    pageId,
    userId: actor.userId,
    fileName,
    options
  }
  await enqueueJob(env, { type: PDF_JOB.export, payload })
  return { token, status: 'queued' as const }
}

/**
 * Job body. Idempotent: an existing result is kept. A failure is stored as a small JSON object so the status
 * endpoint can report it; the job itself does not retry a deterministic failure.
 */
export async function runPdfExportJob(env: InfraEnv, job: PdfExportJob): Promise<void> {
  const bucket = requireBucket(env.ASSET_BUCKET)
  if (await bucket.head(pdfKey(job.userId, job.token))) return
  const db = getDb(env.DB)
  const [page] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.id, job.pageId), eq(pages.workspaceId, job.workspaceId), isNull(pages.deletedAt)))
    .limit(1)
  try {
    if (!page) throw new ServiceError(404, 'PAGE_NOT_FOUND', 'Page not found')
    const result = await exportToPdf(db, env, page, { ...job.options, fileName: job.fileName, pageId: job.pageId })
    await bucket.put(pdfKey(job.userId, job.token), result.pdfBuffer, {
      httpMetadata: { contentType: 'application/pdf' },
      customMetadata: { fileName: result.outputFileName, pageId: String(job.pageId) }
    })
  } catch (error) {
    logJson('error', 'job:pdf.export', { token: job.token, error: String(error) })
    const status = error instanceof ServiceError ? error.status : 500
    // A 5xx from the browser may be transient: let Queues retry. Everything else is final.
    if (status >= 500 && status !== 500) throw error
    await bucket.put(
      pdfErrorKey(job.userId, job.token),
      JSON.stringify({ message: error instanceof ServiceError ? error.message : 'Failed to generate PDF' }),
      {
        httpMetadata: { contentType: 'application/json' }
      }
    )
  }
}

/** `queued`, `completed` or `failed` for a token of the caller. */
export async function getPdfExportStatus(env: InfraEnv, actor: Actor, token: string) {
  const bucket = requireBucket(env.ASSET_BUCKET)
  if (await bucket.head(pdfKey(actor.userId, token))) return { token, status: 'completed' as const }
  const failed = await bucket.get(pdfErrorKey(actor.userId, token))
  if (failed)
    return { token, status: 'failed' as const, reason: ((await failed.json()) as { message?: string }).message ?? null }
  return { token, status: 'queued' as const }
}

/** The stored PDF, or 404 while it is not ready. */
export async function downloadPdfExport(env: InfraEnv, actor: Actor, token: string) {
  const object = await requireBucket(env.ASSET_BUCKET).get(pdfKey(actor.userId, token))
  if (!object) throw new ServiceError(404, 'PDF_NOT_FOUND', 'PDF export not found or not ready')
  return { body: object.body, size: object.size, fileName: object.customMetadata?.fileName ?? `${token}.pdf` }
}

/** Delete exports older than the retention window (cron). */
export async function deleteOldPdfExports(env: InfraEnv, now = Date.now()): Promise<number> {
  const bucket = env.ASSET_BUCKET
  if (!bucket) return 0
  let deleted = 0
  let cursor: string | undefined
  do {
    const listing = await bucket.list({ prefix: PDF_PREFIX, cursor, limit: 500 })
    const old = listing.objects.filter(object => now - object.uploaded.getTime() > PDF_RETENTION_MS).map(o => o.key)
    if (old.length) await bucket.delete(old)
    deleted += old.length
    cursor = listing.truncated ? listing.cursor : undefined
  } while (cursor)
  return deleted
}
