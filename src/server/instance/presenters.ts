import type { instanceConfigurations, instances } from '@/db/schema/instance'
import { presentCurrentUser } from '@/server/identity/presenters'

type ConfigurationRow = typeof instanceConfigurations.$inferSelect
type InstanceRow = typeof instances.$inferSelect

/**
 * PD-1530 `InstanceConfigurationSerializer.to_representation`. Plane returns decrypted secrets to the admin; Lancity
 * never sends a stored secret back to a client, so an encrypted value is reported only as `is_set`.
 */
export function toInstanceConfigurationResponse(row: Pick<ConfigurationRow, 'key' | 'category' | 'value' | 'isEncrypted'>) {
  return {
    key: row.key,
    category: row.category,
    value: row.isEncrypted ? null : row.value,
    isEncrypted: row.isEncrypted,
    isSet: Boolean(row.value)
  }
}

/** `InstanceSerializer` in Plane's snake_case wire format. Not included: `whitelist_emails` and audit columns. */
export function toInstanceResponse(instance: InstanceRow, workspacesExist: boolean) {
  return {
    id: instance.id,
    instance_name: instance.instanceName,
    instance_id: instance.instanceId,
    current_version: instance.currentVersion,
    latest_version: instance.latestVersion,
    edition: instance.edition,
    namespace: instance.namespace,
    domain: instance.domain,
    last_checked_at: instance.lastCheckedAt,
    is_telemetry_enabled: instance.isTelemetryEnabled,
    is_support_required: instance.isSupportRequired,
    is_setup_done: instance.isSetupDone,
    is_signup_screen_visited: instance.isSignupScreenVisited,
    is_verified: instance.isVerified,
    is_test: instance.isTest,
    is_current_version_deprecated: instance.isCurrentVersionDeprecated,
    created_at: instance.createdAt,
    updated_at: instance.updatedAt,
    workspaces_exist: workspacesExist
  }
}

/** `InstanceAdminMeSerializer` field set. */
export function toInstanceAdminMeResponse(...args: Parameters<typeof presentCurrentUser>) {
  const me = presentCurrentUser(...args)
  return {
    id: me.id,
    avatar: me.avatar,
    avatar_url: me.avatar_url,
    cover_image: me.cover_image,
    date_joined: me.date_joined,
    display_name: me.display_name,
    email: me.email,
    first_name: me.first_name,
    last_name: me.last_name,
    is_active: me.is_active,
    is_bot: me.is_bot,
    is_email_verified: me.is_email_verified,
    user_timezone: me.user_timezone,
    username: me.username,
    is_password_autoset: me.is_password_autoset
  }
}

/** `WorkspaceSerializer` (instance admin) row: owner details plus project and member totals. */
export function toInstanceWorkspaceResponse(row: {
  id: number
  name: string
  slug: string
  logo: string | null
  logoAssetId: number | null
  ownerId: number
  ownerEmail: string | null
  ownerName: string | null
  organizationSize: string | null
  timezone: string
  backgroundColor: string
  createdAt: Date
  updatedAt: Date
  totalProjects: number
  totalMembers: number
}) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logo: row.logo,
    logo_url: row.logoAssetId ? `/api/v1/workspaces/${row.slug}/assets/${row.logoAssetId}` : row.logo || null,
    owner: { id: row.ownerId, email: row.ownerEmail, display_name: row.ownerName },
    organization_size: row.organizationSize,
    timezone: row.timezone,
    background_color: row.backgroundColor,
    total_projects: row.totalProjects,
    total_members: row.totalMembers,
    created_at: row.createdAt,
    updated_at: row.updatedAt
  }
}
