import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { userSecurity } from '@/db/schema/ext-p1-auth'
import { profiles } from '@/db/schema/identity'
import { userNotificationPreferences } from '@/db/schema/notification'
import { workspaceMemberInvites, workspaceMembers, workspaces } from '@/db/schema/workspace'
import { user } from '@/db/schema/auth'
import { getDefaultOnboarding, getDefaultProductTour, getMobileDefaultOnboarding } from '@/server/identity/model-rules'
import { processWorkspaceProjectInvitations } from '@/server/workspace/invitations'
import type { LancityDb } from '@/types/database/schema'

/**
 * Plane `Profile.objects.create(user=user)` + `create_user_notification` post_save + `User.is_password_autoset`.
 * Idempotent: safe to run again for an existing user.
 */
export async function provisionUser(userId: number, options: { passwordAutoset: boolean }, db: LancityDb = getDb()): Promise<void> {
  await db
    .insert(profiles)
    .values({
      userId,
      onboardingStep: getDefaultOnboarding(),
      mobileOnboardingStep: getMobileDefaultOnboarding(),
      productTour: getDefaultProductTour()
    })
    .onConflictDoNothing({ target: profiles.userId })
  await db
    .insert(userSecurity)
    .values({ userId, isPasswordAutoset: options.passwordAutoset })
    .onConflictDoNothing({ target: userSecurity.userId })
  const [existing] = await db
    .select({ id: userNotificationPreferences.id })
    .from(userNotificationPreferences)
    .where(and(eq(userNotificationPreferences.userId, userId), isNull(userNotificationPreferences.projectId), isNull(userNotificationPreferences.workspaceId)))
    .limit(1)
  if (!existing) {
    await db
      .insert(userNotificationPreferences)
      .values({ userId, propertyChange: true, stateChange: true, comment: true, mention: true, issueCompleted: true })
  }
}

/** Plane `Adapter.save_user_data` + `user_login`: record the login and reactivate provisioned (never deactivated) accounts. */
export async function recordLogin(userId: number, input: { medium: string; ip?: string; userAgent?: string | null }, db: LancityDb = getDb()) {
  const now = new Date()
  await db
    .insert(userSecurity)
    .values({ userId, lastLoginMedium: input.medium, lastLoginTime: now, lastLoginIp: input.ip, lastLoginUagent: input.userAgent, lastActive: now })
    .onConflictDoUpdate({
      target: userSecurity.userId,
      set: { lastLoginMedium: input.medium, lastLoginTime: now, lastLoginIp: input.ip, lastLoginUagent: input.userAgent, lastActive: now, isActive: true }
    })
}

/** Plane `post_user_auth_workflow`: redeem accepted workspace/project invitations for the signed-in user. */
export async function postUserAuthWorkflow(userId: number, db: LancityDb = getDb()): Promise<void> {
  await processWorkspaceProjectInvitations(db, { userId })
}

/** Plane `get_redirection_path`. Returns a route name or workspace slug; the web client maps it to a linkto path. */
export async function getRedirectionPath(userId: number, db: LancityDb = getDb()): Promise<string> {
  await provisionUser(userId, { passwordAutoset: false }, db)
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1)
  if (!profile.isOnboarded) return 'onboarding'
  const memberships = await db
    .select({ id: workspaces.id, slug: workspaces.slug })
    .from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.memberId, userId), eq(workspaceMembers.isActive, true), isNull(workspaceMembers.deletedAt), isNull(workspaces.deletedAt)))
    .orderBy(workspaces.createdAt)
  const last = memberships.find(item => item.id === profile.lastWorkspaceId)
  if (last ?? memberships[0]) return (last ?? memberships[0]).slug
  const [person] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1)
  const [invite] = person
    ? await db.select({ id: workspaceMemberInvites.id }).from(workspaceMemberInvites).where(and(eq(workspaceMemberInvites.email, person.email), isNull(workspaceMemberInvites.deletedAt))).limit(1)
    : []
  return invite ? 'invitations' : 'create-workspace'
}
