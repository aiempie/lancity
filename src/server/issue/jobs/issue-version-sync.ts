import { and, desc, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@/db/schema'
import { issueVersions, issues } from '@/db/schema/issue'
import type { InfraEnv } from '@/server/common/env'
import { enqueueJob } from '@/server/common/jobs'
import { ISSUE_JOB, logIssueJob, parseJsonObject } from '@/server/issue/activity/index'
import { backfillIssueVersions, countLiveIssues, getOwnerId, logIssueVersion } from '@/server/issue/version/snapshot'
import type { LancityDb } from '@/types/database/schema'
import { issueVersionJobSchema, versionSyncJobSchema } from '@/types/issue/p1-issue-background-schema'

/** PD-1189 */
export { getOwnerId }

/** Request key (Plane field name) to [issue column, issue version column]. Relation lists are not diffed here. */
const VERSION_FIELDS = {
  name: ['name', 'name'],
  priority: ['priority', 'priority'],
  start_date: ['startDate', 'startDate'],
  target_date: ['targetDate', 'targetDate'],
  sequence_id: ['sequenceId', 'sequenceId'],
  sort_order: ['sortOrder', 'sortOrder'],
  archived_at: ['archivedAt', 'archivedAt'],
  is_draft: ['isDraft', 'isDraft'],
  external_source: ['externalSource', 'externalSource'],
  external_id: ['externalId', 'externalId'],
  parent_id: ['parentId', 'parent'],
  parent: ['parentId', 'parent'],
  state_id: ['stateId', 'state'],
  state: ['stateId', 'state'],
  estimate_point_id: ['estimatePointId', 'estimatePoint'],
  estimate_point: ['estimatePointId', 'estimatePoint'],
  type_id: ['typeId', 'type'],
  type: ['typeId', 'type']
} as const satisfies Record<
  string,
  readonly [keyof typeof issues.$inferSelect, keyof typeof issueVersions.$inferSelect]
>

/**
 * PD-1188 (Plane `issue_task`). Records an issue version after an update: the latest version is edited when the same
 * user saved it within 10 minutes, otherwise a full snapshot is stored.
 * As in Plane the stored values are the ones in `updatedIssue` that differ from the issue now.
 */
export async function issueTask(env: InfraEnv, raw: unknown): Promise<void> {
  const parsed = issueVersionJobSchema.safeParse(raw)
  if (!parsed.success) return logIssueJob('error', 'issue.version', { message: 'Invalid payload' })
  const { updatedIssue, issueId, userId } = parsed.data
  const current = parseJsonObject(updatedIssue) ?? {}
  const db = drizzle(env.DB, { schema }) as unknown as LancityDb
  const [issue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.id, issueId), isNull(issues.deletedAt)))
    .limit(1)
  if (!issue) return
  const changes: Partial<typeof issueVersions.$inferInsert> = {}
  for (const [key, value] of Object.entries(current)) {
    const mapping = VERSION_FIELDS[key as keyof typeof VERSION_FIELDS]
    if (mapping && (issue[mapping[0]] ?? null) !== (value ?? null))
      (changes as Record<string, unknown>)[mapping[1]] = value ?? null
  }
  if (!Object.keys(changes).length) return
  const [latest] = await db
    .select({ id: issueVersions.id, ownedById: issueVersions.ownedById, lastSavedAt: issueVersions.lastSavedAt })
    .from(issueVersions)
    .where(and(eq(issueVersions.issueId, issueId), isNull(issueVersions.deletedAt)))
    .orderBy(desc(issueVersions.lastSavedAt), desc(issueVersions.id))
    .limit(1)
  if (latest && latest.ownedById === userId && (Date.now() - latest.lastSavedAt.getTime()) / 1000 <= 600)
    await db
      .update(issueVersions)
      .set({ ...changes, lastSavedAt: new Date() })
      .where(eq(issueVersions.id, latest.id))
  else await logIssueVersion(db, issueId, userId)
}

/**
 * PD-1190 to PD-1195 (`get_related_data`, its four group-by callbacks and `create_issue_version`) are replaced by one
 * SQL `insert ... select` in `version/snapshot.ts` (`json_group_array` per relation, latest activity, owner fallback).
 *
 * PD-1196. Creates `issue_versions` for issues that have none, one window per job, and schedules the next window
 * after `countdown` seconds. Issues that already have a version are skipped, so reruns are safe.
 */
export async function syncIssueVersion(env: InfraEnv, raw: unknown, jobId?: string): Promise<void> {
  const parsed = versionSyncJobSchema.safeParse(raw ?? {})
  if (!parsed.success) return logIssueJob('error', 'issue.version.sync', { message: 'Invalid payload' })
  const { batchSize, offset, countdown } = parsed.data
  const db = drizzle(env.DB, { schema }) as unknown as LancityDb
  const total = await countLiveIssues(db)
  if (total === 0) return
  const endOffset = Math.min(offset + batchSize, total)
  const created = await backfillIssueVersions(db, batchSize, offset)
  logIssueJob('info', 'issue.version.sync', { offset, endOffset, total, created })
  if (endOffset < total)
    await enqueueJob(env, {
      type: ISSUE_JOB.versionSync,
      payload: { batchSize, offset: endOffset, countdown },
      id: jobId ? `${jobId}:next` : undefined,
      delaySeconds: countdown
    })
}

/** PD-1197 */
export async function scheduleIssueVersion(env: InfraEnv, raw: unknown, jobId?: string): Promise<void> {
  const parsed = versionSyncJobSchema.safeParse(raw ?? {})
  if (!parsed.success) return logIssueJob('error', 'issue.version.schedule', { message: 'Invalid payload' })
  await enqueueJob(env, {
    type: ISSUE_JOB.versionSync,
    payload: { batchSize: parsed.data.batchSize, offset: 0, countdown: parsed.data.countdown },
    id: jobId ? `${jobId}:sync` : undefined
  })
}
