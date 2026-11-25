import { and, count, eq, isNull } from 'drizzle-orm'
import { instances } from '@/db/schema/instance'
import { workspaces } from '@/db/schema/workspace'
import { getEnv } from '@/server/common/env'
import { ServiceError } from '@/server/common/errors'
import { getConfigurationMap, getConfigurationValue } from '@/server/instance/instance-value'
import { currentInstance, requireInstanceAdmin } from '@/server/instance/permissions'
import { toInstanceResponse } from '@/server/instance/presenters'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { UpdateInstanceInput } from '@/types/instance/schema'
import type { UpdateInstanceDetailsInput } from '@/types/instance/p3-instance-schema'

export async function getInstance(db: LancityDb) {
  const instance = await currentInstance(db)
  return { instanceName: instance?.instanceName ?? 'Lancity', isSetupDone: instance?.isSetupDone ?? false }
}

export async function updateInstance(db: LancityDb, actor: Actor, input: UpdateInstanceInput) {
  const { instance } = await requireInstanceAdmin(db, actor)
  await db
    .update(instances)
    .set({ ...input, updatedById: actor.userId })
    .where(and(eq(instances.id, instance.id), isNull(instances.deletedAt)))
  return getInstance(db)
}

export async function listInstanceWorkspaces(db: LancityDb, actor: Actor) {
  await requireInstanceAdmin(db, actor)
  return db
    .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, ownerId: workspaces.ownerId })
    .from(workspaces)
    .where(isNull(workspaces.deletedAt))
    .orderBy(workspaces.name)
    .limit(100)
}

export async function workspaceCreationDisabled(db: LancityDb, env: Record<string, unknown> = getEnv()) {
  const [value] = await getConfigurationValue(
    db,
    [{ key: 'DISABLE_WORKSPACE_CREATION', default: typeof env.DISABLE_WORKSPACE_CREATION === 'string' ? env.DISABLE_WORKSPACE_CREATION : '0' }],
    env
  )
  return value === '1'
}

/** PD-1551 `InstanceEndpoint.get_permissions`: PATCH needs an instance admin, every other method is public. */
export function getPermissionsInstance(method: string): 'instance-admin' | 'public' {
  return method.toUpperCase() === 'PATCH' ? 'instance-admin' : 'public'
}

const flag = (value: string | null | undefined) => value === '1'

/**
 * PD-1552 `InstanceEndpoint.get`: the Plane `{ config, instance }` payload. Flags come from instance configuration
 * first and env second (`get_configuration_value`). Secrets are only reported as booleans.
 */
export async function getInstanceInfo(db: LancityDb, env: Record<string, unknown> = getEnv()) {
  const instance = await currentInstance(db)
  if (!instance) return { is_activated: false, is_setup_done: false }
  const text = (key: string) => (typeof env[key] === 'string' ? (env[key] as string) : undefined)
  const values = await getConfigurationMap(
    db,
    {
      ENABLE_SIGNUP: text('ENABLE_SIGNUP') ?? '1',
      DISABLE_WORKSPACE_CREATION: text('DISABLE_WORKSPACE_CREATION') ?? '0',
      IS_GOOGLE_ENABLED: text('IS_GOOGLE_ENABLED') ?? '0',
      IS_GITHUB_ENABLED: text('IS_GITHUB_ENABLED') ?? '0',
      GITHUB_APP_NAME: text('GITHUB_APP_NAME') ?? '',
      IS_GITLAB_ENABLED: text('IS_GITLAB_ENABLED') ?? '0',
      IS_GITEA_ENABLED: text('IS_GITEA_ENABLED') ?? '0',
      ENABLE_SMTP: text('ENABLE_SMTP'),
      EMAIL_HOST: text('EMAIL_HOST') ?? text('GMAIL_USER') ?? '',
      ENABLE_MAGIC_LINK_LOGIN: text('ENABLE_MAGIC_LINK_LOGIN') ?? '1',
      ENABLE_EMAIL_PASSWORD: text('ENABLE_EMAIL_PASSWORD') ?? '1',
      SLACK_CLIENT_ID: text('SLACK_CLIENT_ID'),
      UNSPLASH_ACCESS_KEY: text('UNSPLASH_ACCESS_KEY') ?? '',
      LLM_API_KEY: text('LLM_API_KEY') ?? ''
    },
    env
  )
  const [{ total }] = await db.select({ total: count() }).from(workspaces).where(isNull(workspaces.deletedAt))
  const baseUrl = text('BETTER_AUTH_URL') ?? ''
  return {
    config: {
      enable_signup: flag(values.ENABLE_SIGNUP),
      is_workspace_creation_disabled: flag(values.DISABLE_WORKSPACE_CREATION),
      is_google_enabled: flag(values.IS_GOOGLE_ENABLED),
      is_github_enabled: flag(values.IS_GITHUB_ENABLED),
      is_gitlab_enabled: flag(values.IS_GITLAB_ENABLED),
      is_gitea_enabled: flag(values.IS_GITEA_ENABLED),
      is_magic_login_enabled: flag(values.ENABLE_MAGIC_LINK_LOGIN),
      is_email_password_enabled: flag(values.ENABLE_EMAIL_PASSWORD),
      github_app_name: String(values.GITHUB_APP_NAME ?? ''),
      slack_client_id: values.SLACK_CLIENT_ID ?? null,
      has_unsplash_configured: Boolean(values.UNSPLASH_ACCESS_KEY),
      has_llm_configured: Boolean(values.LLM_API_KEY),
      file_size_limit: Number(text('FILE_SIZE_LIMIT') ?? 5242880),
      // Mail goes through Gmail SMTP credentials (env) unless the admin stored EMAIL_HOST.
      is_smtp_configured: Boolean(values.EMAIL_HOST),
      admin_base_url: text('ADMIN_BASE_URL') ?? baseUrl,
      space_base_url: text('SPACE_BASE_URL') ?? baseUrl,
      app_base_url: text('APP_BASE_URL') ?? baseUrl,
      instance_changelog_url: text('INSTANCE_CHANGELOG_URL') ?? '',
      is_self_managed: true
    },
    instance: { ...toInstanceResponse(instance, total >= 1), is_activated: true }
  }
}

/** PD-1553 `InstanceEndpoint.patch`: partial update of the writable instance fields. Returns the compact view. */
export async function updateInstanceDetails(db: LancityDb, actor: Actor, input: UpdateInstanceDetailsInput) {
  const { instance } = await requireInstanceAdmin(db, actor)
  await db
    .update(instances)
    .set({ ...input, updatedById: actor.userId })
    .where(and(eq(instances.id, instance.id), isNull(instances.deletedAt)))
  return getInstance(db)
}

/** PD-1554 `SignUpScreenVisitedEndpoint.post`: public; records that the admin sign-up screen was opened. */
export async function markSignUpScreenVisited(db: LancityDb) {
  const instance = await currentInstance(db)
  if (!instance) throw new ServiceError(400, 'INSTANCE_NOT_CONFIGURED', 'Instance is not configured')
  await db.update(instances).set({ isSignupScreenVisited: true }).where(eq(instances.id, instance.id))
}
