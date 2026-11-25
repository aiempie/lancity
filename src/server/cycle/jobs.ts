import { and, asc, eq, gte, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@/db/schema'
import { issueActivities } from '@/db/schema/issue'
import type { InfraEnv } from '@/server/common/env'
import { enqueueJob, registerJobHandler, registerScheduled } from '@/server/common/jobs'
import { CYCLE_JOB } from '@/server/cycle/events'
import { snapshotActiveCycles } from '@/server/cycle/snapshot'
import { NOTIFICATION_ISSUE_JOB } from '@/server/issue/activity'
import type { LancityDb } from '@/types/database/schema'

export type TransferNotifyPayload = {
  projectId: number
  workspaceId: number
  actorId: number
  fromCycleId: number
  toCycleId: number
  since: number
  mutationId?: string
  offset?: number
}

const CHUNK = 200
/** The activity rows are written with the database clock, the Worker clock may run slightly behind. */
const CLOCK_SKEW_MS = 60_000

/**
 * Plane `issue_activity.delay(type="cycle.activity.created", notification=True)` of `transfer_cycle_issues`. The
 * transfer batch already wrote one activity per moved issue, so this job re-reads them and queues one
 * `notification.issue` job per issue (the same payload `issue.activity` sends). Large transfers continue in chunks.
 */
export async function notifyTransferredIssues(env: InfraEnv, payload: TransferNotifyPayload): Promise<void> {
  const db = drizzle(env.DB, { schema }) as unknown as LancityDb
  const offset = payload.offset ?? 0
  const eventKey = payload.mutationId ??
    `legacy:${payload.projectId}:${payload.actorId}:${payload.fromCycleId}:${payload.toCycleId}:${payload.since}`
  const rows = await db
    .select()
    .from(issueActivities)
    .where(
      and(
        eq(issueActivities.projectId, payload.projectId),
        eq(issueActivities.workspaceId, payload.workspaceId),
        eq(issueActivities.actorId, payload.actorId),
        eq(issueActivities.field, 'cycles'),
        eq(issueActivities.verb, 'updated'),
        eq(issueActivities.oldIdentifier, payload.fromCycleId),
        eq(issueActivities.newIdentifier, payload.toCycleId),
        payload.mutationId
          ? eq(issueActivities.mutationId, payload.mutationId)
          : and(isNull(issueActivities.mutationId), gte(issueActivities.createdAt, new Date(payload.since - CLOCK_SKEW_MS)))
      )
    )
    .orderBy(asc(issueActivities.id))
    .limit(CHUNK + 1)
    .offset(offset)
  for (const row of rows.slice(0, CHUNK)) {
    await enqueueJob(env, {
      id: `cycle-transfer:${eventKey}:notification:${row.id}`,
      type: NOTIFICATION_ISSUE_JOB,
      payload: {
        type: 'cycle.activity.created',
        issueId: row.issueId,
        actorId: payload.actorId,
        projectId: payload.projectId,
        subscriber: true,
        issueActivitiesCreated: [
          {
            ...row,
            createdAt: row.createdAt?.toISOString(),
            updatedAt: row.updatedAt?.toISOString(),
            deletedAt: null
          }
        ],
        truncated: false,
        requestedData: { cycles_list: [] },
        currentInstance: {
          updated_cycle_issues: [
            { old_cycle_id: payload.fromCycleId, new_cycle_id: payload.toCycleId, issue_id: row.issueId }
          ],
          created_cycle_issues: []
        }
      }
    })
  }
  if (rows.length > CHUNK) {
    const next = offset + CHUNK
    await enqueueJob(env, {
      id: `cycle-transfer:${eventKey}:page:${next}`,
      type: CYCLE_JOB.transferNotify,
      payload: { ...payload, offset: next }
    })
  }
}

/** Called once by `job-registry.ts`. Both jobs are idempotent because Queues deliver at least once. */
export function register(): void {
  registerJobHandler<TransferNotifyPayload>(CYCLE_JOB.transferNotify, (payload, env) =>
    notifyTransferredIssues(env, payload)
  )
  registerJobHandler(CYCLE_JOB.snapshot, (_payload, env) => snapshotActiveCycles(env))
  // Daily, just before UTC midnight, so the row is the end-of-day state of the cycle.
  registerScheduled('55 23 * * *', env => snapshotActiveCycles(env), 'cycle.snapshot')
}
