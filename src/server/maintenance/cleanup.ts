import { sql } from 'drizzle-orm'
import type { LancityDb } from '@/types/database/schema'
import { changes, q } from '@/server/maintenance/cascade'

/** Plane `cleanup_task.BATCH_SIZE`. */
export const CLEANUP_BATCH_SIZE = 500
/** Versions kept per page and per issue (`row_num > 20`). */
export const MAX_VERSIONS = 20
const DAY_MS = 86_400_000

export type CleanupTask = 'api_logs' | 'email_logs' | 'page_versions' | 'issue_description_versions' | 'webhook_logs' | 'job_claims'
export const CLEANUP_TASKS: readonly CleanupTask[] = [
  'api_logs',
  'email_logs',
  'page_versions',
  'issue_description_versions',
  'webhook_logs',
  'job_claims'
]

/** Default retention windows in days (settings/common.py). */
export const DEFAULT_RETENTION_DAYS = { api_logs: 14, email_logs: 7, webhook_logs: 14, job_claims: 7 } as const

type Spec = { table: string; label: string; ids: (cutoff: number) => string }

/** Rows beyond `MAX_VERSIONS` per parent, newest first (Window + RowNumber in Plane). */
const excessVersions = (table: string, parent: string) =>
  `select id from (select id, row_number() over (partition by ${parent} order by created_at desc, id desc) as row_num from ${table}) where row_num > ${MAX_VERSIONS}`

// Every queryset ignores `deleted_at` on purpose: Plane reads `all_objects`, so soft-deleted rows are removed too.
const SPECS: Record<CleanupTask, Spec> = {
  // PD-1087 get_api_logs_queryset
  api_logs: {
    table: 'api_activity_logs',
    label: 'API Activity Log',
    ids: cutoff => `select id from api_activity_logs where created_at <= ${cutoff}`
  },
  // PD-1088 get_email_logs_queryset
  email_logs: {
    table: 'email_notification_logs',
    label: 'Email Notification Log',
    ids: cutoff => `select id from email_notification_logs where sent_at <= ${cutoff}`
  },
  // PD-1089 get_page_versions_queryset
  page_versions: {
    table: 'page_versions',
    label: 'Page Version',
    ids: () => excessVersions('page_versions', 'page_id')
  },
  // PD-1090 get_issue_description_versions_queryset
  issue_description_versions: {
    table: 'issue_description_versions',
    label: 'Issue Description Version',
    ids: () => excessVersions('issue_description_versions', 'issue_id')
  },
  // PD-1091 get_webhook_logs_queryset
  webhook_logs: {
    table: 'webhook_logs',
    label: 'Webhook Log',
    ids: cutoff => `select id from webhook_logs where created_at <= ${cutoff} order by created_at`
  },
  // Lancity only: idempotency claims of background jobs (src/server/common/job-claims.ts) are useless once Queues stop redelivering.
  job_claims: {
    table: 'job_claims',
    label: 'Job Claim',
    ids: cutoff => `select id from job_claims where created_at <= ${cutoff}`
  }
}

/** Table and selection SQL of one cleanup task (PD-1087..1091). Exposed for tests. */
export const cleanupSpec = (task: CleanupTask) => SPECS[task]

export type CleanupResult = { task: CleanupTask; deleted: number; batches: number; done: boolean; failed: boolean }

/**
 * PD-1085 `process_cleanup_task` and its `flush` (PD-1086): hard delete the selected ids in batches of 500.
 * A failed batch stops the task and is reported (Plane logs it and moves on, but re-selecting the same ids here would
 * loop). `maxBatches` bounds one invocation; `done: false` means the caller should queue a continuation.
 */
export async function processCleanupTask(
  db: LancityDb,
  task: CleanupTask,
  options: { days?: number; now?: number; maxBatches?: number } = {}
): Promise<CleanupResult> {
  const spec = SPECS[task]
  const days = options.days ?? (task in DEFAULT_RETENTION_DAYS ? DEFAULT_RETENTION_DAYS[task as keyof typeof DEFAULT_RETENTION_DAYS] : 0)
  const cutoff = (options.now ?? Date.now()) - days * DAY_MS
  const maxBatches = options.maxBatches ?? 40
  const result: CleanupResult = { task, deleted: 0, batches: 0, done: false, failed: false }
  while (result.batches < maxBatches) {
    let deleted: number
    try {
      deleted = changes(
        await db.run(
          sql.raw(`delete from ${q(spec.table)} where id in (select id from (${spec.ids(cutoff)}) limit ${CLEANUP_BATCH_SIZE})`)
        )
      )
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', label: 'maintenance.cleanup', task, message: String(error) }))
      result.failed = true
      return result
    }
    result.batches++
    result.deleted += deleted
    if (deleted < CLEANUP_BATCH_SIZE) {
      result.done = true
      return result
    }
  }
  return result
}

/** PD-1092 `delete_api_logs`. */
export const deleteApiLogs = (db: LancityDb, days?: number) => processCleanupTask(db, 'api_logs', { days })
/** PD-1093 `delete_email_notification_logs`. The scheduled run lives in the notification group; this is the manual path. */
export const deleteEmailNotificationLogs = (db: LancityDb, days?: number) => processCleanupTask(db, 'email_logs', { days })
/** PD-1094 `delete_page_versions`. */
export const deletePageVersions = (db: LancityDb) => processCleanupTask(db, 'page_versions')
/** PD-1095 `delete_issue_description_versions`. */
export const deleteIssueDescriptionVersions = (db: LancityDb) => processCleanupTask(db, 'issue_description_versions')
/** Lancity only: delete job claims older than the retention window (default 7 days). */
export const deleteJobClaims = (db: LancityDb, days?: number) => processCleanupTask(db, 'job_claims', { days })
/** PD-1096 `delete_webhook_logs`. */
export const deleteWebhookLogs = (db: LancityDb, days?: number) => processCleanupTask(db, 'webhook_logs', { days })

// Names used by the checklist for the queryset helpers.
export const getApiLogsQueryset = (cutoff: number) => SPECS.api_logs.ids(cutoff)
export const getEmailLogsQueryset = (cutoff: number) => SPECS.email_logs.ids(cutoff)
export const getPageVersionsQueryset = () => SPECS.page_versions.ids(0)
export const getIssueDescriptionVersionsQueryset = () => SPECS.issue_description_versions.ids(0)
export const getWebhookLogsQueryset = (cutoff: number) => SPECS.webhook_logs.ids(cutoff)
