import { withJobClaim } from '@/server/common/job-claims'
import { registerJobHandler } from '@/server/common/jobs'
import { IMPORT_ISSUES_JOB } from '@/server/import/events'
import { importIssuesTask } from '@/server/import/tasks'
import type { ImportIssuesPayload } from '@/types/reporting/p3-export-schema'

export { IMPORT_ISSUES_JOB }

/** Called once by `job-registry.ts`. A chunk is idempotent: rows already created are recognised by external id. */
export function register(): void {
  registerJobHandler<ImportIssuesPayload>(IMPORT_ISSUES_JOB, (payload, env, meta) =>
    withJobClaim(env, IMPORT_ISSUES_JOB, meta?.jobId, () => importIssuesTask(env, payload))
  )
}
