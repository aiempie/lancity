import { and, asc, eq, inArray, isNotNull, lte } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@/db/schema'
import { user } from '@/db/schema/auth'
import { exporters } from '@/db/schema/integration'
import { workspaceMembers } from '@/db/schema/workspace'
import { requireBucket, deleteFiles, uploadFile } from '@/server/asset/storage'
import { logException } from '@/server/common/exception-logger'
import { logJson, type InfraEnv } from '@/server/common/env'
import { sendMail } from '@/server/common/mail'
import { linkEmail } from '@/server/common/mail-templates'
import { DataExporter } from '@/server/export/exporter'
import { loadIssueExportRecords } from '@/server/export/queries'
import { EXPORT_LINK_DAYS, exportDownloadPath, retentionCutoff } from '@/server/export/model-rules'
import { serializeIssuesForExport } from '@/server/export/presenters'
import { createZipFile, type ZipInput } from '@/server/export/zip'
import type { LancityDb } from '@/types/database/schema'
import type { ExportIssuesPayload, IssueExportRecord } from '@/types/reporting/p3-export-schema'

const openDb = (env: InfraEnv) => drizzle(env.DB, { schema }) as unknown as LancityDb
const BATCH = 80

async function markFailed(db: LancityDb, exportId: number, reason: string): Promise<void> {
  await db.update(exporters).set({ status: 'failed', reason: reason.slice(0, 1000) }).where(eq(exporters.id, exportId))
}

/** PD-1132 `upload_to_s3`: store the ZIP in R2 and complete the history row with its download URL. */
export async function uploadToBucket(
  env: InfraEnv,
  db: LancityDb,
  zip: Uint8Array,
  payload: Pick<ExportIssuesPayload, 'exportId' | 'workspaceId' | 'token' | 'slug'>,
  today = new Date().toISOString().slice(0, 10)
): Promise<string> {
  const key = `${payload.workspaceId}/export-${payload.slug}-${payload.token}-${today}.zip`
  await uploadFile(requireBucket(env.ASSET_BUCKET), key, zip, 'application/zip')
  await db
    .update(exporters)
    .set({ url: exportDownloadPath(payload.slug, payload.exportId), status: 'completed', key })
    .where(eq(exporters.id, payload.exportId))
  return key
}

async function notifyInitiator(env: InfraEnv, db: LancityDb, initiatedById: number, payload: ExportIssuesPayload): Promise<void> {
  const [initiator] = await db.select({ email: user.email }).from(user).where(eq(user.id, initiatedById))
  if (!initiator) return
  const base = typeof env.BETTER_AUTH_URL === 'string' ? env.BETTER_AUTH_URL.replace(/\/$/, '') : ''
  const mail = linkEmail(
    'Your export is ready',
    'Your issue export is ready',
    `The export of ${payload.slug} can be downloaded for ${EXPORT_LINK_DAYS} days. Sign in to download it.`,
    'Download export',
    `${base}${exportDownloadPath(payload.slug, payload.exportId)}`
  )
  await sendMail({ to: initiator.email, ...mail }, env)
}

/**
 * PD-1133 `issue_export_task`. Runs once per export: a finished export is skipped, so a redelivered message does
 * no second upload. Errors end in status `failed` with a `reason`, as in Plane, instead of a retry.
 */
export async function issueExportTask(env: InfraEnv, payload: ExportIssuesPayload): Promise<void> {
  const db = openDb(env)
  const [exporter] = await db.select().from(exporters).where(eq(exporters.token, payload.token))
  if (!exporter || exporter.status === 'completed' || exporter.status === 'failed') return
  await db.update(exporters).set({ status: 'processing' }).where(eq(exporters.id, exporter.id))
  try {
    let dataExporter: DataExporter<IssueExportRecord>
    try {
      dataExporter = new DataExporter(serializeIssuesForExport, payload.provider)
    } catch (error) {
      await markFailed(db, exporter.id, error instanceof Error ? error.message : String(error))
      return
    }
    const [member] = await db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, payload.workspaceId),
          eq(workspaceMembers.memberId, exporter.initiatedById),
          eq(workspaceMembers.isActive, true)
        )
      )
    if (!member) {
      await markFailed(db, exporter.id, 'The member left the workspace')
      return
    }
    const records = await loadIssueExportRecords(db, {
      workspaceId: payload.workspaceId,
      workspaceSlug: payload.slug,
      userId: exporter.initiatedById,
      projectIds: payload.projectIds
    })
    const files: ZipInput[] = []
    if (payload.multiple) {
      // One file per requested project, empty when the member cannot see any issue there.
      for (const projectId of payload.projectIds) {
        const [name, content] = await dataExporter.export(
          `${payload.slug}-${projectId}`,
          records.filter(record => record.projectId === projectId)
        )
        files.push({ name, data: content })
      }
    } else {
      const [name, content] = await dataExporter.export(`${payload.slug}-${payload.workspaceId}`, records)
      files.push({ name, data: content })
    }
    await uploadToBucket(env, db, await createZipFile(files), { ...payload, exportId: exporter.id })
    try {
      await notifyInitiator(env, db, exporter.initiatedById, { ...payload, exportId: exporter.id })
    } catch (error) {
      logException(error, { warning: true, context: { label: 'export.mail', exportId: exporter.id } })
    }
  } catch (error) {
    logException(error, { context: { label: 'export.issues', exportId: exporter.id } })
    await markFailed(db, exporter.id, error instanceof Error ? error.message : String(error))
  }
}

/**
 * PD-1134 `delete_old_s3_link`: remove the file of every export older than 8 days and clear its URL.
 * Safe to run twice, a cleared row is not selected again.
 */
export async function deleteOldS3Link(env: InfraEnv, now = Date.now()): Promise<number> {
  const db = openDb(env)
  let deleted = 0
  for (;;) {
    const rows = await db
      .select({ id: exporters.id, key: exporters.key })
      .from(exporters)
      .where(and(isNotNull(exporters.url), lte(exporters.createdAt, retentionCutoff(now))))
      .orderBy(asc(exporters.id))
      .limit(BATCH)
    if (!rows.length) break
    const keys = rows.map(row => row.key).filter(Boolean)
    if (keys.length) {
      if (!env.ASSET_BUCKET) {
        logJson('warn', 'export.expired', { message: 'ASSET_BUCKET is not bound, expired exports were not removed' })
        break
      }
      await deleteFiles(env.ASSET_BUCKET, keys)
    }
    await db
      .update(exporters)
      .set({ url: null })
      .where(
        inArray(
          exporters.id,
          rows.map(row => row.id)
        )
      )
    deleted += rows.length
  }
  return deleted
}
