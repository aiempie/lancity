import { sql, type SQL } from 'drizzle-orm'
import { outboxStatement, publishOutbox } from '@/server/common/outbox'
import type { LancityDb } from '@/types/database/schema'

/** Job type consumed by the activity group. Payload ids are plain numbers, so it fits a Queue message. */
export const ISSUE_ACTIVITY_JOB = 'issue.activity'

export type IssueEventInput = {
  /** Issue lifecycle event. Mapped to a Plane `issue.activity.*` type by the job schema. */
  event?: 'created' | 'updated' | 'deleted' | 'archived' | 'unarchived'
  /** Plane activity type (`comment.activity.created`, `link.activity.deleted`, ...). Used instead of `event`. */
  type?: string
  issueId: number
  projectId: number
  actorId: number
  requestedData: unknown
  currentInstance: unknown
  /** Send a `webhook.dispatch` job. Default true; the webhook job ignores types that have no webhook event. */
  webhook?: boolean
  /** Extra fields for the handler (for example `{ automation: false }`). */
  extra?: Record<string, unknown>
}

/** `descriptionHtml` -> `description_html`. Only the top-level keys are converted, nested values stay untouched. */
export function toSnakeCase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

/** Keys whose snake_case form differs from Plane's key (Plane tracks `estimate_point`, not `estimate_point_id`). */
const PLANE_KEY_ALIASES: Record<string, string> = { estimate_point_id: 'estimate_point' }

/**
 * Plane passes `requested_data` and `current_instance` in snake_case (`description_html`, `state_id`, `label_ids`).
 * The activity and notification jobs read those keys, but Lancity services work with camelCase inputs and Drizzle
 * rows. This is the single place where the payload is converted, so a mention in `descriptionHtml` is found by
 * the job as `description_html`. Dates become ISO strings, like a JSON round trip through the Queue.
 */
export function toPlaneData(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) return null
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const snake = toSnakeCase(key)
    out[PLANE_KEY_ALIASES[snake] ?? snake] = item instanceof Date ? item.toISOString() : item
  }
  return out
}

type EventEnv = ReturnType<typeof import('@/server/common/env').getEnv>
let envOverride: EventEnv | null = null

/** Test seam: use this env (for example a fake D1 and queue) instead of the Worker binding. Pass null to reset. */
export function setIssueEventEnv(env: EventEnv | null): void {
  envOverride = env
}

/** Create the durable activity event immediately after its activity insert in the same batch. */
export function issueEventStatement(db: LancityDb, mutationId: string, input: IssueEventInput, payload?: SQL) {
  return outboxStatement(db, mutationId, ISSUE_ACTIVITY_JOB, payload ?? issueEventBody(input, mutationId), sql`changes() = 1`)
}

export function issueEventBody(input: IssueEventInput, mutationId: string) {
  return { ...(input.type ? { type: input.type } : { event: input.event }), issueId: input.issueId,
    projectId: input.projectId, actorId: input.actorId, requestedData: toPlaneData(input.requestedData),
    currentInstance: toPlaneData(input.currentInstance), epoch: Math.floor(Date.now() / 1000),
    notification: true, activityRecorded: true, webhook: input.webhook ?? true, mutationId, ...input.extra }
}
export function publishIssueEvent(db: LancityDb, mutationId: string) {
  return publishOutbox(db, mutationId, envOverride ?? undefined)
}
