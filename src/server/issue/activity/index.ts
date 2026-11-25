import { enqueueJob } from '@/server/common/jobs'
import type { InfraEnv } from '@/server/common/env'
import type {
  BulkSubscribersJob,
  IssueActivityJob,
  IssueDescriptionVersionJob,
  IssueVersionJob,
  LinkCrawlJob,
  VersionSyncJob
} from '@/types/issue/p1-issue-background-schema'

/** Job types of the issue background tasks. Other domains enqueue these through the helpers below. */
export const ISSUE_JOB = {
  activity: 'issue.activity',
  version: 'issue.version.update',
  descriptionVersion: 'issue.description_version.update',
  versionSync: 'issue.version.sync',
  versionSchedule: 'issue.version.schedule',
  descriptionVersionSync: 'issue.description_version.sync',
  descriptionVersionSchedule: 'issue.description_version.schedule',
  linkCrawl: 'issue.link.crawl',
  subscribersBulk: 'issue.subscribers.bulk',
  archiveAndClose: 'issue.automation.archive_and_close',
  unsnoozeIntake: 'issue.automation.unsnooze_intake'
} as const

/** Hooks owned by other agents. Only the enqueue side lives here. */
export const NOTIFICATION_ISSUE_JOB = 'notification.issue'
export const WEBHOOK_DISPATCH_JOB = 'webhook.dispatch'

type Ctx = { waitUntil(promise: Promise<unknown>): void }

/** Plane `issue_activity.delay(...)`. */
export function enqueueIssueActivity(env: InfraEnv, payload: IssueActivityJob, ctx?: Ctx) {
  return enqueueJob(env, { type: ISSUE_JOB.activity, payload }, ctx)
}

/** Plane `issue_task.delay(...)`: record an issue version after an update. */
export function enqueueIssueVersion(env: InfraEnv, payload: IssueVersionJob, ctx?: Ctx) {
  return enqueueJob(env, { type: ISSUE_JOB.version, payload }, ctx)
}

/** Plane `issue_description_version_task.delay(...)`. */
export function enqueueIssueDescriptionVersion(env: InfraEnv, payload: IssueDescriptionVersionJob, ctx?: Ctx) {
  return enqueueJob(env, { type: ISSUE_JOB.descriptionVersion, payload }, ctx)
}

/** Plane `schedule_issue_version.delay(...)` (management command). */
export function enqueueIssueVersionBackfill(env: InfraEnv, payload: VersionSyncJob = {}) {
  return enqueueJob(env, { type: ISSUE_JOB.versionSchedule, payload })
}

/** Plane `schedule_issue_description_version.delay(...)` (management command). */
export function enqueueIssueDescriptionVersionBackfill(env: InfraEnv, payload: VersionSyncJob = {}) {
  return enqueueJob(env, { type: ISSUE_JOB.descriptionVersionSchedule, payload })
}

/** Plane `crawl_work_item_link_title.delay(...)`. */
export function enqueueLinkCrawl(env: InfraEnv, payload: LinkCrawlJob, ctx?: Ctx) {
  return enqueueJob(env, { type: ISSUE_JOB.linkCrawl, payload }, ctx)
}

export function enqueueBulkSubscribers(env: InfraEnv, payload: BulkSubscribersJob, ctx?: Ctx) {
  return enqueueJob(env, { type: ISSUE_JOB.subscribersBulk, payload }, ctx)
}

/** One JSON log line. Kept local so these modules also load outside the Worker runtime (tests). */
export function logIssueJob(level: 'info' | 'warn' | 'error', label: string, data: Record<string, unknown> = {}) {
  console[level === 'info' ? 'log' : level](JSON.stringify({ level, label, ...data }))
}

/** Parse a Plane JSON blob (string or object) into an object. Returns null for null, undefined or non-objects. */
export function parseJsonObject(value: unknown): Record<string, unknown> | null {
  const parsed = typeof value === 'string' ? (value ? JSON.parse(value) : null) : value
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
}
