import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@/db/schema'
import { issues } from '@/db/schema/issue'
import type { InfraEnv } from '@/server/common/env'
import { logIssueJob } from '@/server/issue/activity/index'
import { bulkCreateSubscribers } from '@/server/issue/jobs/issue-activities'
import type { LancityDb } from '@/types/database/schema'
import { bulkSubscribersJobSchema } from '@/types/issue/p1-issue-background-schema'

/** Subscribe many users to one issue. Existing subscriptions are ignored, so the job is safe to repeat. */
export async function bulkSubscribeIssue(env: InfraEnv, raw: unknown): Promise<void> {
  const parsed = bulkSubscribersJobSchema.safeParse(raw)
  if (!parsed.success) return logIssueJob('error', 'issue.subscribers.bulk', { message: 'Invalid payload' })
  const { issueId, projectId, subscriberIds } = parsed.data
  const db = drizzle(env.DB, { schema }) as unknown as LancityDb
  const [issue] = await db
    .select({ workspaceId: issues.workspaceId, projectId: issues.projectId })
    .from(issues)
    .where(eq(issues.id, issueId))
    .limit(1)
  if (!issue || issue.projectId !== projectId) return
  await bulkCreateSubscribers(db, issueId, projectId, issue.workspaceId, subscriberIds)
}
