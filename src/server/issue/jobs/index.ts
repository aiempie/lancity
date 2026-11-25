import { registerOutbox } from '@/server/common/outbox'
import { withJobClaim } from '@/server/common/job-claims'
import { registerJobHandler, registerScheduled } from '@/server/common/jobs'
import { ISSUE_JOB } from '@/server/issue/activity/index'
import { issueActivity } from '@/server/issue/jobs/issue-activities'
import { archiveAndCloseOldIssues, unsnoozeExpiredIntakeIssues } from '@/server/issue/jobs/issue-automation'
import { issueDescriptionVersionTask } from '@/server/issue/jobs/issue-description-version'
import {
  scheduleIssueDescriptionVersion,
  syncIssueDescriptionVersion
} from '@/server/issue/jobs/issue-description-version-sync'
import { bulkSubscribeIssue } from '@/server/issue/jobs/issue-subscribers'
import { issueTask, scheduleIssueVersion, syncIssueVersion } from '@/server/issue/jobs/issue-version-sync'
import { crawlWorkItemLinkTitle } from '@/server/issue/jobs/work-item-link'

/**
 * Called once by `job-registry.ts`. Queues deliver at least once, so handlers are not idempotent by default.
 * `issue.activity` is deduplicated with job claims written in its own batch (see `common/job-claims.ts`). The version
 * jobs take a claim per queue message (`withJobClaim`). Subscribers, link crawl and automation repeat safely on their own.
 */
export function register(): void {
  registerOutbox()
  registerJobHandler(ISSUE_JOB.activity, async (payload, env, meta) => void (await issueActivity(env, payload, meta?.jobId)))
  registerJobHandler(ISSUE_JOB.version, (payload, env, meta) =>
    withJobClaim(env, ISSUE_JOB.version, meta?.jobId, () => issueTask(env, payload))
  )
  registerJobHandler(ISSUE_JOB.descriptionVersion, (payload, env, meta) =>
    (payload && typeof payload === 'object' && 'snapshot' in payload)
      ? issueDescriptionVersionTask(env, payload, meta?.jobId)
      : withJobClaim(env, ISSUE_JOB.descriptionVersion, meta?.jobId, () => issueDescriptionVersionTask(env, payload))
  )
  registerJobHandler(ISSUE_JOB.versionSync, (payload, env, meta) =>
    withJobClaim(env, ISSUE_JOB.versionSync, meta?.jobId, () => syncIssueVersion(env, payload, meta?.jobId))
  )
  registerJobHandler(ISSUE_JOB.versionSchedule, (payload, env, meta) =>
    withJobClaim(env, ISSUE_JOB.versionSchedule, meta?.jobId, () => scheduleIssueVersion(env, payload, meta?.jobId))
  )
  registerJobHandler(ISSUE_JOB.descriptionVersionSync, (payload, env, meta) =>
    withJobClaim(env, ISSUE_JOB.descriptionVersionSync, meta?.jobId, () => syncIssueDescriptionVersion(env, payload, meta?.jobId))
  )
  registerJobHandler(ISSUE_JOB.descriptionVersionSchedule, (payload, env, meta) =>
    withJobClaim(env, ISSUE_JOB.descriptionVersionSchedule, meta?.jobId, () => scheduleIssueDescriptionVersion(env, payload, meta?.jobId))
  )
  registerJobHandler(ISSUE_JOB.linkCrawl, (payload, env) => crawlWorkItemLinkTitle(env, payload))
  registerJobHandler(ISSUE_JOB.subscribersBulk, (payload, env) => bulkSubscribeIssue(env, payload))
  registerJobHandler(ISSUE_JOB.archiveAndClose, (_payload, env) => archiveAndCloseOldIssues(env))
  registerJobHandler(ISSUE_JOB.unsnoozeIntake, async (_payload, env) => void (await unsnoozeExpiredIntakeIssues(env)))
  // Celery beat: daily at 01:00 UTC and every 5 minutes.
  registerScheduled('0 1 * * *', env => archiveAndCloseOldIssues(env), 'issue.archive_and_close')
  registerScheduled('*/5 * * * *', async env => void (await unsnoozeExpiredIntakeIssues(env)), 'issue.unsnooze_intake')
}
