import { sql, type SQL } from 'drizzle-orm'
import { outboxStatement } from '@/server/common/outbox'
import type { LancityDb } from '@/types/database/schema'
import { MODEL_ACTIVITY_JOB, WEBHOOK_ACTIVITY_JOB } from '@/server/project/events'

/** Job types owned by the cycle domain. Handlers live in `jobs.ts`. */
export const CYCLE_JOB = {
  /** Fan out `notification.issue` jobs after issues moved between cycles. */
  transferNotify: 'cycle.transfer.notify',
  /** Write today's progress snapshot of every active cycle (also run by the daily cron). */
  snapshot: 'cycle.snapshot'
} as const

/** Queue a job. A failure to queue never fails the request that already wrote data. Imports stay lazy so the services load outside a Worker. */
async function emit(type: string, payload: unknown): Promise<void> {
  try {
    const [{ enqueueJob }, { getEnv }] = await Promise.all([
      import('@/server/common/jobs'),
      import('@/server/common/env')
    ])
    await enqueueJob(getEnv(), { type, payload })
  } catch (error) {
    console.error(
      JSON.stringify({ level: 'error', label: type, message: error instanceof Error ? error.message : String(error) })
    )
  }
}

export type CycleIssueActivity = {
  type: 'cycle.activity.created' | 'cycle.activity.deleted'
  requestedData: Record<string, unknown>
  currentInstance: Record<string, unknown> | null
  issueId: number | null
  actorId: number
  projectId: number
}

/** Persist an activity event in the same batch as the cycle mutation. */
export function cycleIssueActivityStatement(db: LancityDb, eventKey: string, input: CycleIssueActivity, condition: SQL = sql`1`) {
  return outboxStatement(db, eventKey, 'issue.activity', {
    ...input, epoch: Math.floor(Date.now() / 1000), notification: true
  }, condition)
}

/** Plane `model_activity.delay(model_name="cycle", ...)`: the webhook domain turns it into a delivery. */
export function emitCycleModelActivity(input: {
  cycleId: number
  actorId: number
  slug: string
  requestedData: unknown
  currentInstance: unknown
}): Promise<void> {
  return emit(MODEL_ACTIVITY_JOB, {
    model_name: 'cycle',
    model_id: input.cycleId,
    requested_data: input.requestedData,
    current_instance: input.currentInstance,
    actor_id: input.actorId,
    slug: input.slug
  })
}

/** Webhook for a hard fact that has no model-activity diff, such as a cycle deletion. */
export function emitCycleWebhook(input: {
  verb: 'deleted'
  cycleId: number
  actorId: number
  slug: string
}): Promise<void> {
  return emit(WEBHOOK_ACTIVITY_JOB, {
    event: 'cycle',
    verb: input.verb,
    field: null,
    old_value: null,
    new_value: null,
    actor_id: input.actorId,
    slug: input.slug,
    event_id: input.cycleId,
    old_identifier: null,
    new_identifier: null
  })
}
