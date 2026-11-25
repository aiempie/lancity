export function getDefaultOnboarding() {
  return { profile_complete: false, workspace_create: false, workspace_invite: false, workspace_join: false }
}

export function getMobileDefaultOnboarding() {
  return { profile_complete: false, workspace_create: false, workspace_join: false }
}

export function getDefaultProductTour() {
  return { work_items: false, cycles: false, modules: false, intake: false, pages: false }
}

/** Plane `User.get_display_name`: the email local part, or six random letters for a malformed address. */
export function getDisplayName(email: string | null | undefined): string {
  const parts = (email ?? '').split('@')
  if (parts.length === 2 && parts[0]) return parts[0]
  const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => letters[byte % letters.length]).join('')
}

/** Plane `User.full_name`. */
export function fullName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  return `${firstName ?? ''} ${lastName ?? ''}`.trim()
}

/** Plane `User.save` normalisation: emails are stored trimmed and lower-case; a blank display name falls back to the email. */
export function normalizeUserForSave<T extends { email: string; name?: string | null }>(input: T): T {
  const email = input.email.toLowerCase().trim()
  return { ...input, email, name: input.name?.trim() || getDisplayName(email) }
}

/** Plane `User.avatar_url` / `cover_image_url`: the stored URL (assets resolve to a signed URL in the asset service). */
export function avatarUrl(image: string | null | undefined, avatarAssetUrl?: string | null): string | null {
  return avatarAssetUrl || image || null
}

export function coverImageUrl(coverImage: string | null | undefined, coverAssetUrl?: string | null): string | null {
  return coverAssetUrl || coverImage || null
}
