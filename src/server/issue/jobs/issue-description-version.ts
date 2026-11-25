import { desc, eq, isNull, and } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@/db/schema'
import { issueDescriptionVersions, issues } from '@/db/schema/issue'
import type { InfraEnv } from '@/server/common/env'
import { checkJobClaim, isClaimConflict, jobClaimStatement } from '@/server/common/job-claims'
import { logIssueJob, parseJsonObject } from '@/server/issue/activity/index'
import { logIssueDescriptionVersion } from '@/server/issue/version/snapshot'
import type { LancityDb } from '@/types/database/schema'
import { issueDescriptionVersionJobSchema } from '@/types/issue/p1-issue-background-schema'

type Version = Pick<typeof issueDescriptionVersions.$inferSelect, 'ownedById' | 'lastSavedAt'>

/** PD-1185: reuse the latest version when the same user saved it within `maxTimeDifference` seconds. */
export function shouldUpdateExistingVersion(
  version: Version | null | undefined,
  userId: number,
  maxTimeDifference = 600
): boolean {
  if (!version) return false
  const seconds = (Date.now() - version.lastSavedAt.getTime()) / 1000
  return version.ownedById === userId && seconds <= maxTimeDifference
}

/** PD-1186 */
export async function updateExistingVersion(
  db: LancityDb,
  versionId: number,
  issue: Pick<
    typeof issues.$inferSelect,
    'descriptionJson' | 'descriptionHtml' | 'descriptionBinary' | 'descriptionStripped'
  >
): Promise<void> {
  await db
    .update(issueDescriptionVersions)
    .set({
      descriptionJson: issue.descriptionJson,
      descriptionHtml: issue.descriptionHtml,
      descriptionBinary: issue.descriptionBinary,
      descriptionStripped: issue.descriptionStripped,
      lastSavedAt: new Date()
    })
    .where(eq(issueDescriptionVersions.id, versionId))
}

/** PD-1187 (Plane `issue_description_version_task`). */
export async function issueDescriptionVersionTask(env: InfraEnv, raw: unknown, jobId?: string): Promise<void> {
  const parsed = issueDescriptionVersionJobSchema.safeParse(raw)
  if (!parsed.success) return logIssueJob('error', 'issue.description_version', { message: 'Invalid payload' })
  const { updatedIssue, issueId, userId, isCreating, snapshot } = parsed.data
  let current: Record<string, unknown> | null
  try {
    current = parseJsonObject(updatedIssue)
  } catch (error) {
    return logIssueJob('error', 'issue.description_version', { message: `Invalid JSON for updated_issue: ${error}` })
  }
  const db = drizzle(env.DB, { schema }) as unknown as LancityDb
  const [issue] = await db
    .select()
    .from(issues)
    .where(snapshot ? eq(issues.id, issueId) : and(eq(issues.id, issueId), isNull(issues.deletedAt)))
    .limit(1)
  // The issue no longer exists: nothing to record.
  if (!issue) return
  // The description did not change.
  if ((current?.description_html ?? null) === (snapshot?.descriptionHtml ?? issue.descriptionHtml) && !isCreating) return
  const [latest] = await db
    .select()
    .from(issueDescriptionVersions)
    .where(and(eq(issueDescriptionVersions.issueId, issueId), isNull(issueDescriptionVersions.deletedAt)))
    .orderBy(desc(issueDescriptionVersions.lastSavedAt), desc(issueDescriptionVersions.id))
    .limit(1)
  if (snapshot) {
    const binary = snapshot.descriptionBinaryHex ? Buffer.from(snapshot.descriptionBinaryHex, 'hex') : null
    const fields = { descriptionHtml: snapshot.descriptionHtml, descriptionStripped: snapshot.descriptionStripped,
      descriptionJson: snapshot.descriptionJson as typeof issue.descriptionJson, descriptionBinary: binary }
    const claimKey = jobId ? `issue.description_version.update:${jobId}` : null
    const claim = claimKey ? await checkJobClaim(db, claimKey) : { done: false, available: false }
    if (claim.done) return
    const write = latest && shouldUpdateExistingVersion(latest, userId)
      ? db.update(issueDescriptionVersions).set({ ...fields, lastSavedAt: new Date() }).where(eq(issueDescriptionVersions.id, latest.id))
      : db.insert(issueDescriptionVersions).values({ ...fields, issueId, projectId: issue.projectId,
          workspaceId: issue.workspaceId, ownedById: userId, createdById: userId, updatedById: userId, lastSavedAt: new Date() })
    if (!claimKey || !claim.available) await write
    else {
      try { await db.batch([write, jobClaimStatement(db, claimKey, jobId)]) }
      catch (error) { if (!isClaimConflict(error)) throw error }
    }
  } else if (latest && shouldUpdateExistingVersion(latest, userId)) await updateExistingVersion(db, latest.id, issue)
  else await logIssueDescriptionVersion(db, issueId, userId)
}
