import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { account, user } from '@/db/schema/auth'
import { userSecurity } from '@/db/schema/ext-p1-auth'
import { issueActivities, issues } from '@/db/schema/issue'
import { profiles } from '@/db/schema/identity'
import { projectMembers } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import type { Actor } from '@/types/auth/schema'

/** Plane `UserEndpoint.get_object`: the authenticated user's row plus security flags. */
export async function findUser(actor: Actor) {
  const [row] = await getDb()
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      username: user.username,
      createdAt: user.createdAt,
      isPasswordAutoset: userSecurity.isPasswordAutoset,
      isActive: userSecurity.isActive,
      isBot: userSecurity.isBot
    })
    .from(user)
    .leftJoin(userSecurity, eq(userSecurity.userId, user.id))
    .where(eq(user.id, actor.userId))
    .limit(1)
  if (!row) throw new ServiceError(404, 'NOT_FOUND', 'User not found')
  return row
}

export async function findUserByEmail(email: string) {
  const [row] = await getDb()
    .select({ id: user.id, email: user.email, emailVerified: user.emailVerified, isActive: userSecurity.isActive, isBot: userSecurity.isBot, lastLogoutTime: userSecurity.lastLogoutTime })
    .from(user)
    .leftJoin(userSecurity, eq(userSecurity.userId, user.id))
    .where(eq(user.email, email.toLowerCase().trim()))
    .limit(1)
  return row
}

export async function findProfile(userId: number) {
  const [row] = await getDb().select().from(profiles).where(eq(profiles.userId, userId)).limit(1)
  return row
}

export async function findOwnAccount(userId: number, accountId: number) {
  const [row] = await getDb()
    .select()
    .from(account)
    .where(and(eq(account.id, accountId), eq(account.userId, userId)))
    .limit(1)
  return row
}

/** Activity of the user restricted to issues in projects where they are an active member (Plane `_visible_issues_q`). */
export async function listUserActivity(userId: number, options: { limit: number; offset: number; order: 'asc' | 'desc' }) {
  const rows = await getDb()
    .select({
      id: issueActivities.id,
      verb: issueActivities.verb,
      field: issueActivities.field,
      old_value: issueActivities.oldValue,
      new_value: issueActivities.newValue,
      comment: issueActivities.comment,
      issue: issueActivities.issueId,
      project: issueActivities.projectId,
      workspace: issueActivities.workspaceId,
      actor: issueActivities.actorId,
      created_at: issueActivities.createdAt
    })
    .from(issueActivities)
    .innerJoin(issues, and(eq(issues.id, issueActivities.issueId), isNull(issues.deletedAt), eq(issues.isDraft, false)))
    .where(
      and(
        eq(issueActivities.actorId, userId),
        isNull(issueActivities.deletedAt),
        sql`exists (select 1 from ${projectMembers} pm where pm.project_id = ${issueActivities.projectId} and pm.member_id = ${userId} and pm.is_active = 1 and pm.deleted_at is null)`
      )
    )
    .orderBy(options.order === 'asc' ? issueActivities.createdAt : desc(issueActivities.createdAt))
    .limit(options.limit + 1)
    .offset(options.offset)
  return { results: rows.slice(0, options.limit), hasNext: rows.length > options.limit }
}
