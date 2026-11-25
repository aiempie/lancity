import { ANALYTICS_JOB } from '@/server/analytics/events'
import { analyticExportTask, exportAnalyticsToCsvEmail } from '@/server/analytics/export'
import { withJobClaim } from '@/server/common/job-claims'
import { registerJobHandler } from '@/server/common/jobs'
import type { AnalyticCsvEmailJob, AnalyticExportJob } from '@/types/reporting/p3-analytics-schema'

/** Called once by `job-registry.ts`. Both handlers take a claim per queue message, so a redelivery sends no second email. */
export function register(): void {
  registerJobHandler<AnalyticExportJob>(ANALYTICS_JOB.exportPlot, (payload, env, meta) =>
    withJobClaim(env, ANALYTICS_JOB.exportPlot, meta?.jobId, () => analyticExportTask(env, payload))
  )
  // This job inserts an export row and sends an email, so a redelivery must not repeat it.
  registerJobHandler<AnalyticCsvEmailJob>(ANALYTICS_JOB.exportCsvEmail, (payload, env, meta) =>
    withJobClaim(env, ANALYTICS_JOB.exportCsvEmail, meta?.jobId, () => exportAnalyticsToCsvEmail(env, payload))
  )
}
