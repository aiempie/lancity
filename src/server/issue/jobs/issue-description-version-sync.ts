import type { InfraEnv } from '@/server/common/env'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@/db/schema'
import { enqueueJob } from '@/server/common/jobs'
import { ISSUE_JOB, logIssueJob } from '@/server/issue/activity/index'
import { backfillDescriptionVersions, countLiveIssues, getOwnerId } from '@/server/issue/version/snapshot'
import type { LancityDb } from '@/types/database/schema'
import { versionSyncJobSchema } from '@/types/issue/p1-issue-background-schema'

/** PD-1182 */
export { getOwnerId }

/**
 * PD-1183. Creates `issue_description_versions` for issues that have none, one window per job, and schedules the
 * next window after `countdown` seconds. Issues that already have a version are skipped, so reruns are safe.
 */
export async function syncIssueDescriptionVersion(env: InfraEnv, raw: unknown, jobId?: string): Promise<void> {
  const parsed = versionSyncJobSchema.safeParse(raw ?? {})
  if (!parsed.success) return logIssueJob('error', 'issue.description_version.sync', { message: 'Invalid payload' })
  const { batchSize, offset, countdown } = parsed.data
  const db = drizzle(env.DB, { schema }) as unknown as LancityDb
  const total = await countLiveIssues(db)
  if (total === 0) return
  const endOffset = Math.min(offset + batchSize, total)
  const created = await backfillDescriptionVersions(db, batchSize, offset)
  logIssueJob('info', 'issue.description_version.sync', { offset, endOffset, total, created })
  if (endOffset < total)
    await enqueueJob(env, {
      type: ISSUE_JOB.descriptionVersionSync,
      payload: { batchSize, offset: endOffset, countdown },
      id: jobId ? `${jobId}:next` : undefined,
      delaySeconds: countdown
    })
}

/** PD-1184 */
export async function scheduleIssueDescriptionVersion(env: InfraEnv, raw: unknown, jobId?: string): Promise<void> {
  const parsed = versionSyncJobSchema.safeParse(raw ?? {})
  if (!parsed.success) return logIssueJob('error', 'issue.description_version.schedule', { message: 'Invalid payload' })
  await enqueueJob(env, {
    type: ISSUE_JOB.descriptionVersionSync,
    payload: { batchSize: parsed.data.batchSize, offset: 0, countdown: parsed.data.countdown },
    id: jobId ? `${jobId}:sync` : undefined
  })
}
