import { and, asc, count, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { account, user } from '@/db/schema/auth'
import { fileAssets } from '@/db/schema/content'
import { userSecurity } from '@/db/schema/ext-p1-auth'
import { profiles } from '@/db/schema/identity'
import { instanceAdmins } from '@/db/schema/instance'
import { workspaceMemberInvites, workspaceMembers, workspaces } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import { getDefaultOnboarding, getDefaultProductTour, getMobileDefaultOnboarding } from '@/server/identity/model-rules'
import { isOwnAsset, presentCurrentUser, presentWorkspaceSettings } from '@/server/identity/presenters'
import type { Actor } from '@/types/auth/schema'
import type { UpdateCurrentUser, UpdateProfile } from '@/types/identity/schema'

async function ensureProfile(actor: Actor) {
  const db = getDb()
  await db
    .insert(profiles)
    .values({
      userId: actor.userId,
      onboardingStep: getDefaultOnboarding(),
      mobileOnboardingStep: getMobileDefaultOnboarding(),
      productTour: getDefaultProductTour()
    })
    .onConflictDoNothing({ target: profiles.userId })
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, actor.userId)).limit(1)
  if (!profile) throw new ServiceError(404, 'NOT_FOUND', 'Profile not found')
  return profile
}

async function requireOwnAsset(actor: Actor, assetId: number | null, entityType: 'USER_AVATAR' | 'USER_COVER') {
  if (assetId === null) return null
  const [asset] = await getDb()
    .select({ userId: fileAssets.userId, entityType: fileAssets.entityType })
    .from(fileAssets)
    .where(and(eq(fileAssets.id, assetId), eq(fileAssets.isDeleted, false), isNull(fileAssets.deletedAt)))
    .limit(1)
  // Plane user-owned FK scope: the asset must belong to the user and carry the matching entity type.
  if (!isOwnAsset(asset, actor.userId) || asset?.entityType !== entityType) throw new ServiceError(400, 'VALIDATION_ERROR', 'Asset does not belong to the user')
  return assetId
}

export async function getCurrentUser(actor: Actor) {
  const db = getDb()
  const [person] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      username: user.username,
      createdAt: user.createdAt
    })
    .from(user)
    .where(eq(user.id, actor.userId))
    .limit(1)
  if (!person) throw new ServiceError(404, 'NOT_FOUND', 'User not found')
  const profile = await ensureProfile(actor)
  const [security] = await db.select().from(userSecurity).where(eq(userSecurity.userId, actor.userId)).limit(1)
  return presentCurrentUser(person, profile, security)
}

export async function retrieveInstanceAdminUser(actor: Actor) {
  const [admin] = await getDb()
    .select({ id: instanceAdmins.id })
    .from(instanceAdmins)
    .where(and(eq(instanceAdmins.userId, actor.userId), isNull(instanceAdmins.deletedAt)))
    .limit(1)
  return { is_instance_admin: Boolean(admin) }
}

export async function retrieveUserSettings(actor: Actor) {
  const db = getDb()
  const person = await getCurrentUser(actor)
  const profile = await ensureProfile(actor)
  const available = await db
    .select({ id: workspaces.id, slug: workspaces.slug, name: workspaces.name })
    .from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMembers.memberId, actor.userId),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt),
        isNull(workspaces.deletedAt)
      )
    )
    .orderBy(asc(workspaces.createdAt))
  const last = available.find(item => item.id === profile.lastWorkspaceId)
  const fallback = last ?? available[0]
  const [invites] = await db
    .select({ value: count() })
    .from(workspaceMemberInvites)
    .where(and(eq(workspaceMemberInvites.email, person.email), isNull(workspaceMemberInvites.deletedAt)))
  return { id: person.id, email: person.email, workspace: presentWorkspaceSettings(last, fallback, invites.value) }
}

export async function getProfile(actor: Actor) {
  const profile = await ensureProfile(actor)
  const result = Object.fromEntries(
    Object.entries(profile).map(([key, value]) => [key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`), value])
  )
  result.user = result.user_id
  delete result.user_id
  return result
}

export async function updateUser(actor: Actor, input: UpdateCurrentUser) {
  await ensureProfile(actor)
  const set: Partial<typeof profiles.$inferInsert> = {}
  if (input.first_name !== undefined) set.firstName = input.first_name
  if (input.last_name !== undefined) set.lastName = input.last_name
  if (input.user_timezone !== undefined) set.userTimezone = input.user_timezone
  // PD-0364 `_validate_own_asset`: a linked asset must belong to the caller.
  if (input.avatar_asset !== undefined) set.avatarAssetId = await requireOwnAsset(actor, input.avatar_asset, 'USER_AVATAR')
  if (input.cover_image_asset !== undefined) set.coverImageAssetId = await requireOwnAsset(actor, input.cover_image_asset, 'USER_COVER')
  if (Object.keys(set).length) await getDb().update(profiles).set(set).where(eq(profiles.userId, actor.userId))
  return getCurrentUser(actor)
}

export async function updateProfile(actor: Actor, input: UpdateProfile) {
  await ensureProfile(actor)
  const updates = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), value])
  )
  await getDb().update(profiles).set(updates).where(eq(profiles.userId, actor.userId))
  return getProfile(actor)
}

export async function updateUserOnBoarded(actor: Actor, value: boolean) {
  await ensureProfile(actor)
  await getDb().update(profiles).set({ isOnboarded: value }).where(eq(profiles.userId, actor.userId))
  return { message: 'Updated successfully' }
}

export async function updateUserTourCompleted(actor: Actor, value: boolean) {
  await ensureProfile(actor)
  await getDb().update(profiles).set({ isTourCompleted: value }).where(eq(profiles.userId, actor.userId))
  return { message: 'Updated successfully' }
}

export async function getUserSession(actor: Actor | null) {
  return actor ? { is_authenticated: true, user: await getCurrentUser(actor) } : { is_authenticated: false }
}

export async function getAccount(actor: Actor, accountId: number) {
  const [row] = await getDb()
    .select({ id: account.id, provider_id: account.providerId, account_id: account.accountId, created_at: account.createdAt, updated_at: account.updatedAt })
    .from(account)
    .where(and(eq(account.id, accountId), eq(account.userId, actor.userId)))
    .limit(1)
  if (!row) throw new ServiceError(404, 'NOT_FOUND', 'Account not found')
  return row
}

export async function getAccounts(actor: Actor) {
  return getDb()
    .select({
      id: account.id,
      provider_id: account.providerId,
      account_id: account.accountId,
      created_at: account.createdAt,
      updated_at: account.updatedAt
    })
    .from(account)
    .where(eq(account.userId, actor.userId))
}
