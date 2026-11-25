import { and, inArray, isNull } from 'drizzle-orm'
import { instanceConfigurations, instances } from '@/db/schema/instance'
import { decryptValue } from '@/server/instance/encryption'
import { getEnv } from '@/server/common/env'
import type { LancityDb } from '@/types/database/schema'

const GOOGLE_KEYS = ['IS_GOOGLE_ENABLED', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'ENABLE_GOOGLE_SYNC'] as const

/** Plane instance configuration keys that drive authentication. Env values are the defaults, as in `get_configuration_value`. */
const KEYS = [
  'ENABLE_SIGNUP', 'ENABLE_EMAIL_PASSWORD', 'ENABLE_MAGIC_LINK_LOGIN',
  'IS_GITHUB_ENABLED', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_ORGANIZATION_ID', 'ENABLE_GITHUB_SYNC',
  'IS_GITLAB_ENABLED', 'GITLAB_HOST', 'GITLAB_CLIENT_ID', 'GITLAB_CLIENT_SECRET', 'ENABLE_GITLAB_SYNC',
  'IS_GITEA_ENABLED', 'GITEA_HOST', 'GITEA_CLIENT_ID', 'GITEA_CLIENT_SECRET', 'ENABLE_GITEA_SYNC'
] as const
type Key = (typeof KEYS)[number] | (typeof GOOGLE_KEYS)[number]

export type OauthProviderSettings = { enabled: boolean; clientId?: string; clientSecret?: string; host?: string; organizationId?: string; sync: boolean }
export type AuthSettings = {
  signupEnabled: boolean
  emailPasswordEnabled: boolean
  magicLinkEnabled: boolean
  setupDone: boolean
  smtpConfigured: boolean
  google: OauthProviderSettings
  github: OauthProviderSettings
  gitlab: OauthProviderSettings
  gitea: OauthProviderSettings
}

const trim = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

/**
 * Resolve auth settings: stored values, including empty values, take precedence over environment defaults.
 */
export function resolveAuthSettings(rows: Partial<Record<Key, string | null>>, env: Record<string, unknown>, setupDone: boolean): AuthSettings {
  const get = (key: Key, fallback?: string) => Object.hasOwn(rows, key) ? (trim(rows[key]) ?? '') : (trim(env[key]) ?? fallback)
  const provider = (name: 'GOOGLE' | 'GITHUB' | 'GITLAB' | 'GITEA', fallbackHost?: string): OauthProviderSettings => {
    const clientId = get(`${name}_CLIENT_ID` as Key)
    const clientSecret = get(`${name}_CLIENT_SECRET` as Key)
    const explicit = get(`IS_${name}_ENABLED` as Key)
    // Google already worked from credentials alone; keep that when no explicit flag exists.
    const enabled = explicit === undefined ? name === 'GOOGLE' && Boolean(clientId && clientSecret) : explicit === '1'
    const host = name === 'GITLAB' || name === 'GITEA' ? get(`${name}_HOST` as Key, fallbackHost)?.replace(/\/+$/, '') : undefined
    return {
      enabled: enabled && Boolean(clientId && clientSecret) && (name !== 'GITEA' || Boolean(host)),
      clientId,
      clientSecret,
      host,
      organizationId: name === 'GITHUB' ? get('GITHUB_ORGANIZATION_ID') : undefined,
      sync: get(`ENABLE_${name}_SYNC` as Key, '0') === '1'
    }
  }
  return {
    signupEnabled: get('ENABLE_SIGNUP', '1') !== '0',
    emailPasswordEnabled: get('ENABLE_EMAIL_PASSWORD', '1') !== '0',
    magicLinkEnabled: get('ENABLE_MAGIC_LINK_LOGIN', '1') !== '0',
    setupDone,
    smtpConfigured: Boolean(trim(env.GMAIL_USER) && trim(env.GMAIL_APP_PASSWORD)),
    google: provider('GOOGLE'),
    github: provider('GITHUB'),
    gitlab: provider('GITLAB', 'https://gitlab.com'),
    gitea: provider('GITEA')
  }
}

/** Env-only settings for synchronous callers (createAuth()). A missing instance row counts as set up. */
export function envAuthSettings(env: Record<string, unknown> = getEnv()): AuthSettings {
  return resolveAuthSettings({}, env, true)
}

export function loadAuthSettings(db: LancityDb, env: Record<string, unknown> = getEnv()): Promise<AuthSettings> {
  return loadSettings(db, env, [...KEYS, ...GOOGLE_KEYS])
}

/** The sign-in and registration pages get Google configuration from the environment. */
export function loadAuthPageSettings(db: LancityDb, env: Record<string, unknown> = getEnv()): Promise<AuthSettings> {
  return loadSettings(db, env, KEYS)
}

async function loadSettings(db: LancityDb, env: Record<string, unknown>, keys: readonly Key[]): Promise<AuthSettings> {
  const [rows, [instance]] = await Promise.all([
    db
      .select({ key: instanceConfigurations.key, value: instanceConfigurations.value, isEncrypted: instanceConfigurations.isEncrypted })
      .from(instanceConfigurations)
      .where(and(inArray(instanceConfigurations.key, keys), isNull(instanceConfigurations.deletedAt))),
    db.select({ isSetupDone: instances.isSetupDone }).from(instances).where(isNull(instances.deletedAt)).limit(1)
  ])
  const resolved = await Promise.all(rows.map(async row => [row.key, row.isEncrypted ? await decryptValue(row.value, typeof env.INSTANCE_ENCRYPTION_KEY === 'string' ? env.INSTANCE_ENCRYPTION_KEY : '') : row.value] as const))
  return resolveAuthSettings(Object.fromEntries(resolved), env, instance ? instance.isSetupDone : true)
}
