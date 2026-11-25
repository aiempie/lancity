import { and, inArray, isNull } from 'drizzle-orm'
import { instanceConfigurations } from '@/db/schema/instance'
import { getEnv } from '@/server/common/env'
import { decryptData } from '@/server/instance/encryption'
import type { LancityDb } from '@/types/database/schema'

export type ConfigurationKey = { key: string; default?: string | null }

/**
 * Plane `get_configuration_value` (with `SKIP_ENV_VAR` on, Plane's default): a stored instance configuration wins,
 * encrypted values are decrypted, and the key's default (usually an env value) applies when no row exists.
 * An existing row with an empty value returns "" like Plane. Returns one value per requested key, in order.
 */
export async function getConfigurationValue(
  db: LancityDb,
  keys: ConfigurationKey[],
  env: Record<string, unknown> = getEnv()
): Promise<(string | null | undefined)[]> {
  const rows = keys.length
    ? await db
        .select({ key: instanceConfigurations.key, value: instanceConfigurations.value, isEncrypted: instanceConfigurations.isEncrypted })
        .from(instanceConfigurations)
        .where(and(inArray(instanceConfigurations.key, keys.map(item => item.key)), isNull(instanceConfigurations.deletedAt)))
    : []
  const byKey = new Map(rows.map(row => [row.key, row]))
  return Promise.all(
    keys.map(async item => {
      const row = byKey.get(item.key)
      if (!row) return item.default
      return row.isEncrypted ? decryptData(row.value, env.INSTANCE_ENCRYPTION_KEY as string | undefined) : row.value
    })
  )
}

/** Read keys whose default is the same-named env var, as a record. */
export async function getConfigurationMap(
  db: LancityDb,
  defaults: Record<string, string | undefined>,
  env: Record<string, unknown> = getEnv()
): Promise<Record<string, string | null | undefined>> {
  const keys = Object.keys(defaults)
  const values = await getConfigurationValue(db, keys.map(key => ({ key, default: defaults[key] })), env)
  return Object.fromEntries(keys.map((key, index) => [key, values[index]]))
}

export type EmailConfiguration = {
  host?: string | null
  user?: string | null
  password?: string | null
  port: number
  useTls: boolean
  useSsl: boolean
  from?: string | null
}

const str = (value: unknown) => (typeof value === 'string' ? value : undefined)

/**
 * Plane `get_email_configuration`: EMAIL_* values from the instance configuration, defaulting to env.
 * Lancity sends through Gmail SMTP (see `sendMail`), so `user`/`password` act as the Gmail account and app password
 * and `host`/`port`/`useTls`/`useSsl` are reported for the admin screen only.
 */
export async function getEmailConfiguration(db: LancityDb, env: Record<string, unknown> = getEnv()): Promise<EmailConfiguration> {
  const [host, user, password, port, useTls, useSsl, from] = await getConfigurationValue(
    db,
    [
      { key: 'EMAIL_HOST', default: str(env.EMAIL_HOST) },
      { key: 'EMAIL_HOST_USER', default: str(env.EMAIL_HOST_USER) ?? str(env.GMAIL_USER) },
      { key: 'EMAIL_HOST_PASSWORD', default: str(env.EMAIL_HOST_PASSWORD) ?? str(env.GMAIL_APP_PASSWORD) },
      { key: 'EMAIL_PORT', default: str(env.EMAIL_PORT) ?? '587' },
      { key: 'EMAIL_USE_TLS', default: str(env.EMAIL_USE_TLS) ?? '1' },
      { key: 'EMAIL_USE_SSL', default: str(env.EMAIL_USE_SSL) ?? '0' },
      { key: 'EMAIL_FROM', default: str(env.EMAIL_FROM) ?? str(env.MAIL_FROM) ?? 'Team Plane <team@mailer.plane.so>' }
    ],
    env
  )
  return { host, user, password, port: Number(port) || 587, useTls: useTls === '1', useSsl: useSsl === '1', from }
}
