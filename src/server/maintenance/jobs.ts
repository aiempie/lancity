import { getDb } from '@/db/client'
import { enqueueOutboxChild } from '@/server/common/outbox'
import { enqueueJob, registerJobHandler, registerScheduled } from '@/server/common/jobs'
import { getEnv, retentionDays, type InfraEnv } from '@/server/common/env'
import { CLEANUP_TASKS, DEFAULT_RETENTION_DAYS, processCleanupTask, type CleanupTask } from '@/server/maintenance/cleanup'
import { softDeleteRelatedObjects } from '@/server/maintenance/cascade'
import { HARD_DELETE_AFTER_DAYS, hardDelete } from '@/server/maintenance/deletion'
import { createDummyData } from '@/server/maintenance/dummy-data'
import { processLogs } from '@/server/maintenance/logger'
import { copyIssueCommentToDescription } from '@/server/maintenance/ops'
import { recordRun } from '@/server/maintenance/runs'
import { MAINTENANCE_WORKSPACE_SEED_JOB, workspaceSeed } from '@/server/maintenance/workspace-seed'
import { dummyDataSchema, type ApiLogData } from '@/types/instance/p4-maintenance-schema'

export { MAINTENANCE_WORKSPACE_SEED_JOB }
export const MAINTENANCE_JOB = {
  cleanup: 'maintenance.cleanup',
  hardDelete: 'maintenance.hard_delete',
  softDeleteRelated: 'maintenance.soft_delete_related',
  processLogs: 'maintenance.process_logs',
  dummyData: 'maintenance.dummy_data',
  copyCommentDescriptions: 'maintenance.copy_comment_descriptions'
} as const

/** Retention window in days of a cleanup task (env override as in settings/common.py). */
function cleanupDays(task: CleanupTask, env: InfraEnv): number | undefined {
  if (task === 'api_logs') return retentionDays(env.API_ACTIVITY_LOG_RETENTION_DAYS, DEFAULT_RETENTION_DAYS.api_logs)
  if (task === 'webhook_logs') return retentionDays(env.WEBHOOK_LOG_RETENTION_DAYS, DEFAULT_RETENTION_DAYS.webhook_logs)
  if (task === 'email_logs') return retentionDays(env.EMAIL_LOG_RETENTION_DAYS, DEFAULT_RETENTION_DAYS.email_logs)
  if (task === 'job_claims') return retentionDays(env.JOB_CLAIM_RETENTION_DAYS, DEFAULT_RETENTION_DAYS.job_claims)
  return undefined
}

/** One cleanup run. A task that hit its batch budget queues itself again, so a large backlog finishes across invocations. */
export async function runCleanup(env: InfraEnv, task: CleanupTask) {
  const db = getDb(env.DB)
  const result = await recordRun(db, `cleanup.${task}`, async () => ({ ...(await processCleanupTask(db, task, { days: cleanupDays(task, env) })) }))
  if (!result.done && !result.failed) await enqueueJob(env, { type: MAINTENANCE_JOB.cleanup, payload: { task }, delaySeconds: 5 })
  return result
}

/** One hard delete run; continues from `next` when the statement budget was used up. */
export async function runHardDelete(env: InfraEnv, from = 0) {
  const db = getDb(env.DB)
  const result = await recordRun(db, 'hard_delete', async () => ({
    ...(await hardDelete(db, { days: retentionDays(env.HARD_DELETE_AFTER_DAYS, HARD_DELETE_AFTER_DAYS), from }))
  }))
  if (result.next !== null) await enqueueJob(env, { type: MAINTENANCE_JOB.hardDelete, payload: { from: result.next }, delaySeconds: 5 })
  return result
}

export const enqueueCleanup = (task: CleanupTask, env = getEnv()) => enqueueJob(env, { type: MAINTENANCE_JOB.cleanup, payload: { task } })
export const enqueueHardDelete = (env = getEnv()) => enqueueJob(env, { type: MAINTENANCE_JOB.hardDelete, payload: { from: 0 } })
/** Plane `soft_delete_related_objects.delay(app_label, model_name, pk)`; pass it as `onSoftDeleted` of `deleteRecord`. */
export const enqueueSoftDeleteRelated = (model: string, id: number, env = getEnv()) =>
  enqueueJob(env, { type: MAINTENANCE_JOB.softDeleteRelated, payload: { model, id } })
export const enqueueProcessLogs = (log: ApiLogData, env = getEnv()) => enqueueJob(env, { type: MAINTENANCE_JOB.processLogs, payload: log })
export const enqueueMaintenanceWorkspaceSeed = (workspaceId: number, env = getEnv()) =>
  enqueueJob(env, { type: MAINTENANCE_WORKSPACE_SEED_JOB, payload: { workspaceId } })
export const enqueueDummyData = (input: unknown, env = getEnv()) =>
  enqueueJob(env, { type: MAINTENANCE_JOB.dummyData, payload: dummyDataSchema.parse(input) })

export function register(): void {
  registerJobHandler<{ task: CleanupTask }>(MAINTENANCE_JOB.cleanup, async (payload, env) => {
    if (CLEANUP_TASKS.includes(payload?.task)) await runCleanup(env, payload.task)
  })
  registerJobHandler<{ from?: number }>(MAINTENANCE_JOB.hardDelete, async (payload, env) => void (await runHardDelete(env, payload?.from ?? 0)))
  registerJobHandler<{ model: string; id: number; jobKey?: string }>(MAINTENANCE_JOB.softDeleteRelated, async (payload, env, meta) => {
    const db = getDb(env.DB)
    const jobKey = payload.jobKey ?? meta?.jobId ?? `cascade:${payload.model}:${payload.id}`
    const result = await softDeleteRelatedObjects(db, payload.model, payload.id, new Date(), jobKey)
    if (result.continuation !== undefined)
      await enqueueOutboxChild(db, `${jobKey}:continue:${result.continuation}`, MAINTENANCE_JOB.softDeleteRelated,
        { model: payload.model, id: payload.id, jobKey }, env)
  })
  registerJobHandler(MAINTENANCE_JOB.processLogs, async (payload, env) => void (await processLogs(getDb(env.DB), payload)))
  registerJobHandler<{ workspaceId: number }>(MAINTENANCE_WORKSPACE_SEED_JOB, async (payload, env) => {
    const db = getDb(env.DB)
    await recordRun(db, 'workspace_seed', async () => ({ workspaceId: payload.workspaceId, ...(await workspaceSeed(db, payload.workspaceId)) }))
  })
  registerJobHandler(MAINTENANCE_JOB.dummyData, async (payload, env) => {
    const db = getDb(env.DB)
    const input = dummyDataSchema.parse(payload)
    await recordRun(db, 'dummy_data', async () => ({ ...(await createDummyData(db, input)) }))
  })
  registerJobHandler(MAINTENANCE_JOB.copyCommentDescriptions, async (_payload, env) => {
    const db = getDb(env.DB)
    const result = await recordRun(db, 'copy_comment_descriptions', async () => ({ ...(await copyIssueCommentToDescription(db)) }))
    if (!result.done) await enqueueJob(env, { type: MAINTENANCE_JOB.copyCommentDescriptions, delaySeconds: 5 })
  })

  // Celery beat times (UTC). `delete_email_notification_logs` (02:45) is scheduled by the notification group.
  registerScheduled('0 0 * * *', async env => void (await runHardDelete(env)), 'maintenance.hard_delete')
  registerScheduled('30 2 * * *', async env => void (await runCleanup(env, 'api_logs')), 'maintenance.cleanup.api_logs')
  registerScheduled('0 3 * * *', async env => void (await runCleanup(env, 'page_versions')), 'maintenance.cleanup.page_versions')
  registerScheduled('15 3 * * *', async env => void (await runCleanup(env, 'issue_description_versions')), 'maintenance.cleanup.issue_description_versions')
  registerScheduled('30 3 * * *', async env => void (await runCleanup(env, 'webhook_logs')), 'maintenance.cleanup.webhook_logs')
  registerScheduled('45 3 * * *', async env => void (await runCleanup(env, 'job_claims')), 'maintenance.cleanup.job_claims')
}
