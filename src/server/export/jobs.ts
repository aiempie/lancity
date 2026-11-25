import { withJobClaim } from '@/server/common/job-claims'
import { registerJobHandler, registerScheduled } from '@/server/common/jobs'
import { EXPORT_EXPIRED_JOB, EXPORT_ISSUES_JOB } from '@/server/export/events'
import { deleteOldS3Link, issueExportTask } from '@/server/export/tasks'
import type { ExportIssuesPayload } from '@/types/reporting/p3-export-schema'

export { EXPORT_EXPIRED_JOB, EXPORT_ISSUES_JOB }

/** Called once by `job-registry.ts`. The export job takes a claim per queue message (no second upload or email); the cleanup is idempotent. */
export function register(): void {
  registerJobHandler<ExportIssuesPayload>(EXPORT_ISSUES_JOB, (payload, env, meta) =>
    withJobClaim(env, EXPORT_ISSUES_JOB, meta?.jobId, () => issueExportTask(env, payload))
  )
  registerJobHandler(EXPORT_EXPIRED_JOB, async (_payload, env) => {
    await deleteOldS3Link(env)
  })
  // Plane runs `delete_old_s3_link` daily at 01:30 UTC (it is listed twice in its beat schedule).
  registerScheduled(
    '30 1 * * *',
    async env => {
      await deleteOldS3Link(env)
    },
    'export.expired'
  )
}
