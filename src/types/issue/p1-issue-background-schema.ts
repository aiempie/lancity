import { z } from 'zod'

const id = z.number().int().positive()
// Plane passes JSON strings (json.dumps). Lancity accepts a string or an already parsed object.
const jsonBlob = z.union([z.string(), z.record(z.string(), z.unknown()), z.null()]).optional()

/** Activity types produced by services that send `event` (see `emitIssueEvent`) instead of a Plane `type`. */
export const ISSUE_EVENT_ACTIVITY_TYPE = {
  created: 'issue.activity.created',
  updated: 'issue.activity.updated',
  deleted: 'issue.activity.deleted',
  // Plane archives and restores through an `archived_at` update.
  archived: 'issue.activity.updated',
  unarchived: 'issue.activity.updated'
} as const

/**
 * Payload of the `issue.activity` job (Plane `issue_activity` Celery task). Accepts Plane's `type`, or the
 * service-side `event` which is mapped to a `type`. `activityRecorded` means the service already stored the
 * activity rows in its own D1 batch, so the job only fans out notifications and webhooks.
 */
export const issueActivityJobSchema = z
  .object({
    type: z.string().min(1).optional(),
    event: z.enum(['created', 'updated', 'deleted', 'archived', 'unarchived']).optional(),
    activityRecorded: z.boolean().default(false),
    mutationId: z.string().optional(),
    requestedData: jsonBlob,
    currentInstance: jsonBlob,
    issueId: id.nullable().optional(),
    actorId: id.nullable().optional(),
    projectId: id,
    epoch: z.number().nullable().optional(),
    subscriber: z.boolean().default(true),
    notification: z.boolean().default(false),
    /** Opt in to a `webhook.dispatch` job after the activities are stored. */
    webhook: z.boolean().default(false)
  })
  .refine(value => Boolean(value.type ?? value.event), { message: 'Either type or event is required', path: ['type'] })
  .transform(value => ({
    ...value,
    type: (value.type ?? ISSUE_EVENT_ACTIVITY_TYPE[value.event as keyof typeof ISSUE_EVENT_ACTIVITY_TYPE]) as string
  }))
export type IssueActivityJob = z.input<typeof issueActivityJobSchema>

/** Payload of `issue.version.update` (Plane `issue_task`). */
export const issueVersionJobSchema = z.object({ updatedIssue: jsonBlob, issueId: id, userId: id })
export type IssueVersionJob = z.input<typeof issueVersionJobSchema>

/** Payload of `issue.description_version.update` (Plane `issue_description_version_task`). */
export const issueDescriptionVersionJobSchema = z.object({
  updatedIssue: jsonBlob,
  issueId: id,
  userId: id,
  isCreating: z.boolean().default(false),
  snapshot: z.object({
    descriptionHtml: z.string(),
    descriptionStripped: z.string().nullable(),
    descriptionJson: z.unknown(),
    descriptionBinaryHex: z.string()
  }).optional()
})
export type IssueDescriptionVersionJob = z.input<typeof issueDescriptionVersionJobSchema>

/** Payload of the batch backfill jobs (`sync_issue_version`, `sync_issue_description_version`). */
export const versionSyncJobSchema = z.object({
  batchSize: z.number().int().min(1).max(5000).default(1000),
  offset: z.number().int().min(0).default(0),
  countdown: z.number().int().min(0).default(300)
})
export type VersionSyncJob = z.input<typeof versionSyncJobSchema>

/** Payload of `issue.link.crawl` (Plane `crawl_work_item_link_title`). */
export const linkCrawlJobSchema = z.object({ id, url: z.string().url() })
export type LinkCrawlJob = z.input<typeof linkCrawlJobSchema>

/** Payload of `issue.subscribers.bulk` (bulk subscribe users to one issue). */
export const bulkSubscribersJobSchema = z.object({
  issueId: id,
  projectId: id,
  subscriberIds: z.array(id).min(1).max(500)
})
export type BulkSubscribersJob = z.input<typeof bulkSubscribersJobSchema>
