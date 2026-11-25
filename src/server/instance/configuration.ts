import { and, inArray, isNull } from 'drizzle-orm'
import { instanceConfigurations } from '@/db/schema/instance'
import { getEnv } from '@/server/common/env'
import { ServiceError } from '@/server/common/errors'
import { logException } from '@/server/common/exception-logger'
import { sendMail } from '@/server/common/mail'
import { encryptData } from '@/server/instance/encryption'
import { getEmailConfiguration } from '@/server/instance/instance-value'
import { requireInstanceAdmin } from '@/server/instance/permissions'
import { toInstanceConfigurationResponse } from '@/server/instance/presenters'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { UpdateInstanceConfigurationValues } from '@/types/instance/p3-instance-schema'

/**
 * Configuration keys Plane seeds with `configure_instance` (utils/instance_config_variables) and the category and
 * encryption flag each one has there. Admin updates create a row for these keys when none exists yet.
 */
const CONFIGURATION_CATALOG: Record<string, { category: string; encrypted?: boolean }> = {
  ENABLE_SIGNUP: { category: 'AUTHENTICATION' },
  ENABLE_EMAIL_PASSWORD: { category: 'AUTHENTICATION' },
  ENABLE_MAGIC_LINK_LOGIN: { category: 'AUTHENTICATION' },
  DISABLE_WORKSPACE_CREATION: { category: 'WORKSPACE_MANAGEMENT' },
  IS_GOOGLE_ENABLED: { category: 'GOOGLE' },
  GOOGLE_CLIENT_ID: { category: 'GOOGLE' },
  GOOGLE_CLIENT_SECRET: { category: 'GOOGLE', encrypted: true },
  ENABLE_GOOGLE_SYNC: { category: 'GOOGLE' },
  IS_GITHUB_ENABLED: { category: 'GITHUB' },
  GITHUB_CLIENT_ID: { category: 'GITHUB' },
  GITHUB_CLIENT_SECRET: { category: 'GITHUB', encrypted: true },
  GITHUB_ORGANIZATION_ID: { category: 'GITHUB' },
  ENABLE_GITHUB_SYNC: { category: 'GITHUB' },
  IS_GITLAB_ENABLED: { category: 'GITLAB' },
  GITLAB_HOST: { category: 'GITLAB' },
  GITLAB_CLIENT_ID: { category: 'GITLAB' },
  GITLAB_CLIENT_SECRET: { category: 'GITLAB', encrypted: true },
  ENABLE_GITLAB_SYNC: { category: 'GITLAB' },
  IS_GITEA_ENABLED: { category: 'GITEA' },
  GITEA_HOST: { category: 'GITEA' },
  GITEA_CLIENT_ID: { category: 'GITEA' },
  GITEA_CLIENT_SECRET: { category: 'GITEA', encrypted: true },
  ENABLE_GITEA_SYNC: { category: 'GITEA' },
  ENABLE_SMTP: { category: 'SMTP' },
  EMAIL_HOST: { category: 'SMTP' },
  EMAIL_HOST_USER: { category: 'SMTP' },
  EMAIL_HOST_PASSWORD: { category: 'SMTP', encrypted: true },
  EMAIL_PORT: { category: 'SMTP' },
  EMAIL_FROM: { category: 'SMTP' },
  EMAIL_USE_TLS: { category: 'SMTP' },
  EMAIL_USE_SSL: { category: 'SMTP' },
  LLM_API_KEY: { category: 'AI', encrypted: true },
  LLM_PROVIDER: { category: 'AI' },
  LLM_MODEL: { category: 'AI' },
  GPT_ENGINE: { category: 'AI' },
  UNSPLASH_ACCESS_KEY: { category: 'UNSPLASH', encrypted: true }
}
const EMAIL_KEYS = ['EMAIL_HOST', 'EMAIL_HOST_USER', 'EMAIL_HOST_PASSWORD', 'ENABLE_SMTP', 'EMAIL_PORT', 'EMAIL_FROM']

export async function listInstanceConfigurations(db: LancityDb, actor: Actor) {
  await requireInstanceAdmin(db, actor)
  const configurations = await db
    .select()
    .from(instanceConfigurations)
    .where(isNull(instanceConfigurations.deletedAt))
    .orderBy(instanceConfigurations.key)
  return configurations.map(toInstanceConfigurationResponse)
}

export async function setWorkspaceCreationPolicy(db: LancityDb, actor: Actor, value: '0' | '1') {
  await requireInstanceAdmin(db, actor)
  await db
    .insert(instanceConfigurations)
    .values({
      key: 'DISABLE_WORKSPACE_CREATION',
      category: 'workspace',
      value,
      isEncrypted: false,
      createdById: actor.userId
    })
    .onConflictDoUpdate({
      target: instanceConfigurations.key,
      set: { value, isEncrypted: false, deletedAt: null, updatedById: actor.userId }
    })
  return { DISABLE_WORKSPACE_CREATION: value }
}

const configurationText = (raw: string | number | boolean | null | undefined) =>
  raw === null || raw === undefined ? '' : typeof raw === 'boolean' ? (raw ? '1' : '0') : String(raw).trim()

/**
 * PD-1548 `InstanceConfigurationEndpoint.patch`: store each submitted value (trimmed, null as ""). Encrypted keys are
 * encrypted with `INSTANCE_ENCRYPTION_KEY`. Keys that are neither seeded by Plane nor already stored are ignored.
 * Omit a key to keep its value; sending "" clears it. Returns the updated rows (secrets masked).
 */
export async function updateInstanceConfiguration(db: LancityDb, actor: Actor, values: UpdateInstanceConfigurationValues) {
  await requireInstanceAdmin(db, actor)
  const keys = Object.keys(values)
  const existing = await db
    .select({ key: instanceConfigurations.key, isEncrypted: instanceConfigurations.isEncrypted })
    .from(instanceConfigurations)
    .where(and(inArray(instanceConfigurations.key, keys), isNull(instanceConfigurations.deletedAt)))
  const stored = new Map(existing.map(row => [row.key, row.isEncrypted]))
  const rows = await Promise.all(
    keys
      .filter(key => stored.has(key) || key in CONFIGURATION_CATALOG)
      .map(async key => {
        const isEncrypted = stored.get(key) ?? CONFIGURATION_CATALOG[key].encrypted ?? false
        const text = configurationText(values[key])
        return {
          key,
          category: CONFIGURATION_CATALOG[key]?.category ?? 'CUSTOM',
          isEncrypted,
          value: isEncrypted ? await encryptData(text) : text
        }
      })
  )
  if (!rows.length) return []
  for (const row of rows) {
    await db
      .insert(instanceConfigurations)
      .values({ ...row, createdById: actor.userId, updatedById: actor.userId })
      .onConflictDoUpdate({
        target: instanceConfigurations.key,
        set: { value: row.value, isEncrypted: row.isEncrypted, deletedAt: null, updatedById: actor.userId }
      })
  }
  return rows.map(row => toInstanceConfigurationResponse(row))
}

/** PD-1549 `DisableEmailFeatureEndpoint.delete`: clear the stored email settings and switch `ENABLE_SMTP` off. */
export async function deleteDisableEmailFeature(db: LancityDb, actor: Actor) {
  await requireInstanceAdmin(db, actor)
  await db
    .update(instanceConfigurations)
    .set({ value: '', updatedById: actor.userId })
    .where(inArray(instanceConfigurations.key, EMAIL_KEYS))
  await db
    .update(instanceConfigurations)
    .set({ value: '0', updatedById: actor.userId })
    .where(inArray(instanceConfigurations.key, ['ENABLE_SMTP']))
}

const SMTP_ERRORS: Record<string, string> = {
  EAUTH: 'Invalid credentials provided',
  ECONNECTION: 'Could not connect with the SMTP server.',
  ESOCKET: 'Could not connect with the SMTP server.',
  ETIMEDOUT: 'Timeout error while trying to connect to the SMTP server.',
  ECONNRESET: 'SMTP server disconnected unexpectedly.',
  EENVELOPE: 'All recipient addresses were refused.',
  EMESSAGE: 'Invalid email header.'
}

/**
 * PD-1550 `EmailCredentialCheckEndpoint.post`: send a sample message with the stored email settings. Lancity sends
 * through Gmail SMTP, so the stored user and password are used as the Gmail account and app password.
 */
export async function createEmailCredentialCheck(db: LancityDb, actor: Actor, receiverEmail: string) {
  await requireInstanceAdmin(db, actor)
  const env = getEnv()
  const config = await getEmailConfiguration(db, env)
  if (!config.user || !config.password) throw new ServiceError(400, 'SMTP_NOT_CONFIGURED', 'Could not send email. Please check your configuration')
  try {
    const result = await sendMail(
      {
        to: receiverEmail,
        subject: 'Email Notification from Lancity',
        text: 'This is a sample email notification sent from the Lancity application.'
      },
      { GMAIL_USER: config.user, GMAIL_APP_PASSWORD: config.password, MAIL_FROM: config.from ?? undefined }
    )
    if (!result.sent) throw new Error('Email was not sent')
  } catch (error) {
    const code = (error as { code?: string }).code
    logException(error, { warning: true })
    throw new ServiceError(400, 'EMAIL_CHECK_FAILED', (code && SMTP_ERRORS[code]) || 'Could not send email. Please check your configuration')
  }
  return { message: 'Email successfully sent.' }
}
