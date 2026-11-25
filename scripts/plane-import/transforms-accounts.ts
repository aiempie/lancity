// Pure transforms for Plane data migrations about users, profiles, workspaces and projects.
// Each function takes values read from the old Postgres data and returns the value (or D1 row) to write.

export type Row = Record<string, unknown>

/** Postgres CSV exports write booleans as `t` / `f`. */
export const isTrue = (value: unknown) => value === true || value === 't' || value === 'true'

export function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** PD-1290 `update_company_organization_size` (0035): the old integer `company_size` becomes the string `organization_size`. */
export function updateCompanyOrganizationSize(workspace: Row): string | null {
  const size = workspace.company_size ?? workspace.organization_size
  return size === undefined || size === null ? null : String(size)
}

export const ONBOARDING_DEFAULT_STEPS = {
  workspace_join: true,
  profile_complete: true,
  workspace_create: true,
  workspace_invite: true
}

/** PD-1291 `onboarding_default_steps` (0037): onboarded users get every step and a completed tour. Returns null when unchanged. */
export function onboardingDefaultSteps(user: Row): { onboarding_step: typeof ONBOARDING_DEFAULT_STEPS; is_tour_completed: true } | null {
  return isTrue(user.is_onboarded) ? { onboarding_step: { ...ONBOARDING_DEFAULT_STEPS }, is_tour_completed: true } : null
}

/** PD-1292 `restructure_theming` (0038): nested accent/bgBase theme into the flat palette. Empty themes stay unchanged (null). */
export function restructureTheming(theme: unknown): Row | null {
  if (!isRecord(theme) || !Object.keys(theme).length) return null
  const get = (key: string) => (typeof theme[key] === 'string' ? (theme[key] as string) : '')
  return {
    primary: get('accent'),
    background: get('bgBase'),
    sidebarBackground: get('sidebar'),
    text: get('textBase'),
    sidebarText: get('textBase'),
    palette: `${get('bgBase')},${get('textBase')},${get('accent')},${get('sidebar')},${get('textBase')}`,
    darkPalette: theme.darkPalette ?? ''
  }
}

/** PD-1296 `generate_display_name` (0041): the part of the email before `@`. An existing display name is kept. */
export function generateDisplayName(user: Row): string {
  const existing = typeof user.display_name === 'string' ? user.display_name.trim() : ''
  if (existing) return existing
  return String(user.email ?? '').split('@')[0]
}

/** PD-1304 `update_user_timezones` (0042): the source forced UTC; keep a valid existing zone, else UTC. */
export function updateUserTimezone(timezone: unknown): string {
  if (typeof timezone !== 'string' || !timezone) return 'UTC'
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone })
    return timezone
  } catch {
    return 'UTC'
  }
}

/**
 * PD-1318 `user_password_autoset` (0050). Django hashes (`pbkdf2_sha256$...`) are not Better Auth credentials, so no hash is
 * copied. The account is created without a password and the user sets one through the password-reset flow.
 */
export function userPasswordAutoset(user: Row): { password: null; isPasswordAutoset: true; requiresPasswordReset: boolean } {
  return { password: null, isPasswordAutoset: true, requiresPasswordReset: Boolean(user.password) && !user.is_password_autoset }
}

/** PD-1325 `create_notification_preferences` (0057): one default preference row per non-bot user (DB defaults fill the flags). */
export function createNotificationPreferences(users: Row[]): Row[] {
  const seen = new Set<unknown>()
  const rows: Row[] = []
  for (const user of users) {
    if (isTrue(user.is_bot) || seen.has(user.id)) continue
    seen.add(user.id)
    rows.push({ user_id: user.id, created_by_id: user.id, workspace_id: null, project_id: null })
  }
  return rows
}

/** PD-1327 `update_project_logo_props` (0061): record the logo in use plus emoji and icon values. */
export function updateProjectLogoProps(project: Row): Row {
  const current = isRecord(project.logo_props) ? project.logo_props : {}
  const icon = isRecord(project.icon_prop) ? project.icon_prop : null
  return {
    ...current,
    in_use: project.emoji ? 'emoji' : 'icon',
    emoji: { value: project.emoji ? String(project.emoji) : '', url: '' },
    icon: { name: icon && typeof icon.name === 'string' ? icon.name : '', color: icon && typeof icon.color === 'string' ? icon.color : '' }
  }
}

/** PD-1329 `migrate_user_profile` (0065): the profile row for a Plane user that predates the `profiles` table. */
export function migrateUserProfile(user: Row): Row {
  return {
    user_id: user.id,
    theme: user.theme ?? {},
    is_tour_completed: user.is_tour_completed ?? false,
    use_case: user.use_case ?? null,
    is_onboarded: user.is_onboarded ?? false,
    last_workspace_id: user.last_workspace_id ?? null,
    billing_address_country: user.billing_address_country ?? null,
    billing_address: user.billing_address ?? null,
    has_billing_address: user.has_billing_address ?? false,
    first_name: user.first_name ?? '',
    last_name: user.last_name ?? '',
    mobile_number: user.mobile_number ?? null,
    user_timezone: updateUserTimezone(user.user_timezone),
    cover_image: user.cover_image ?? null
  }
}

const TOUR_KEYS = ['work_items', 'cycles', 'modules', 'intake', 'pages'] as const

/** PD-1346 `set_default_product_tour_to_false` (0113): the default for new users. */
export function setDefaultProductTourToFalse(): Record<(typeof TOUR_KEYS)[number], boolean> {
  return Object.fromEntries(TOUR_KEYS.map(key => [key, false])) as Record<(typeof TOUR_KEYS)[number], boolean>
}

/** PD-1347 `get_default_product_tour` (0113): the value for accounts that existed before the tour. */
export function getDefaultProductTour(): Record<(typeof TOUR_KEYS)[number], boolean> {
  return Object.fromEntries(TOUR_KEYS.map(key => [key, true])) as Record<(typeof TOUR_KEYS)[number], boolean>
}

/**
 * PD-1348 `populate_product_tour` (0113). The profile's own `product_tour` wins (it is the newer source, PD-1355);
 * an empty or missing value on an old row becomes the completed tour.
 */
export function populateProductTour(existing: unknown): Record<string, unknown> {
  return isRecord(existing) && Object.keys(existing).length ? existing : getDefaultProductTour()
}

/** PD-1351 `set_getting_started_checklist` (0118). */
export function setGettingStartedChecklist() {
  return {
    project_created: true,
    project_joined: true,
    work_item_created: true,
    team_members_invited: true,
    page_created: true,
    ai_chat_tried: true,
    integration_linked: true,
    view_created: true,
    sticky_created: true
  }
}

/** PD-1352 `set_default_tips` (0118). */
export function setDefaultTips() {
  return { mobile_app_download: true }
}

/** PD-1353 `set_default_explored_features` (0118). */
export function setDefaultExploredFeatures() {
  return { github_integrated: true, slack_integrated: true, ai_chat_tried: true }
}

/** PD-1354 `set_default_product_tour` (0118). */
export function setDefaultProductTour() {
  return getDefaultProductTour()
}

/** PD-1355 `migrate_all_the_product_tour_to_true` (0118): row-level form. Returns the values for the profile and the membership. */
export function migrateAllTheProductTourToTrue(profile: Row, member: Row): { profile: Row; member: Row } {
  return {
    profile: { ...profile, is_navigation_tour_completed: true, product_tour: setDefaultProductTour() },
    member: {
      ...member,
      getting_started_checklist: setGettingStartedChecklist(),
      tips: setDefaultTips(),
      explored_features: setDefaultExploredFeatures()
    }
  }
}

/**
 * PD-1350 `migrate_existing_api_tokens` (0115): non-service tokens of non-bot users lose their workspace scope.
 * Lancity has no adapter for such tokens, so the row is imported inactive; users must create a new token.
 */
export function migrateExistingApiTokens(token: Row, owner: Row | undefined): Row {
  if (isTrue(token.is_service) || isTrue(owner?.is_bot)) return { ...token }
  return { ...token, workspace_id: null, is_active: false }
}
