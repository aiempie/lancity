import { avatarUrl, coverImageUrl, fullName } from '@/server/identity/model-rules'

type UserRow = { id: number; name: string; email: string; emailVerified: boolean; image: string | null; username: string | null; createdAt: Date }
type ProfileRow = {
  firstName: string | null
  lastName: string | null
  userTimezone: string | null
  coverImage: string | null
  isOnboarded: boolean
  isTourCompleted: boolean
  onboardingStep: unknown
  lastWorkspaceId: number | null
}
type SecurityRow = { isPasswordAutoset: boolean; isActive: boolean; isBot: boolean } | undefined

/** Plane `UserMeSerializer` field set. `is_onboarded` comes from the profile (UserSerializer.get_is_onboarded). */
export function presentCurrentUser(person: UserRow, profile: ProfileRow, security: SecurityRow) {
  return {
    id: person.id,
    display_name: person.name,
    email: person.email,
    username: person.username,
    avatar: person.image,
    avatar_url: avatarUrl(person.image),
    cover_image: profile.coverImage,
    cover_image_url: coverImageUrl(profile.coverImage),
    first_name: profile.firstName ?? '',
    last_name: profile.lastName ?? '',
    full_name: fullName(profile.firstName, profile.lastName),
    user_timezone: profile.userTimezone,
    is_email_verified: person.emailVerified,
    is_password_autoset: security?.isPasswordAutoset ?? false,
    is_active: security?.isActive ?? true,
    is_bot: security?.isBot ?? false,
    is_onboarded: profile.isOnboarded,
    is_tour_completed: profile.isTourCompleted,
    last_workspace_id: profile.lastWorkspaceId,
    date_joined: person.createdAt
  }
}

/** Plane `UserSerializer.get_is_onboarded`. */
export function getIsOnboarded(profile: { isOnboarded: boolean } | undefined): boolean {
  return profile?.isOnboarded ?? false
}

/** Plane `UserMeSettingsSerializer.get_workspace`. */
export function presentWorkspaceSettings(
  last: { id: number; slug: string; name: string } | undefined,
  fallback: { id: number; slug: string } | undefined,
  invites: number
) {
  return {
    last_workspace_id: last?.id ?? null,
    last_workspace_slug: last?.slug ?? null,
    ...(last ? { last_workspace_name: last.name, last_workspace_logo: '' } : {}),
    fallback_workspace_id: fallback?.id ?? null,
    fallback_workspace_slug: fallback?.slug ?? null,
    invites
  }
}

/** Plane `User.__str__`. */
export function formatUser(person: { email: string }): string {
  return person.email
}

/** Plane `SocialLoginConnection.__str__`. */
export function formatSocialLoginConnection(connection: { medium: string; userId: number }): string {
  return `${connection.userId} - ${connection.medium}`
}

/** Own-asset check from `UserSerializer._validate_own_asset`: an asset may only be linked by the user that owns it. */
export function isOwnAsset(asset: { userId: number | null } | undefined, userId: number): boolean {
  return Boolean(asset) && asset?.userId === userId
}
