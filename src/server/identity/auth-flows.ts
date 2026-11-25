import { and, eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { account, user } from '@/db/schema/auth'
import { userSecurity } from '@/db/schema/ext-p1-auth'
import { AUTHENTICATION_ERROR_CODES, authenticationError, getErrorDict } from '@/server/identity/errors'
import { findUserByEmail } from '@/server/identity/queries'
import { getRedirectionPath } from '@/server/identity/onboarding'
import { loadAuthSettings } from '@/server/identity/settings'
import { emailCheckSchema } from '@/types/auth/schema'
import { z } from 'zod'

const emailSchema = z.email()

/** Plane `Adapter.sanitize_email`: lower-case, trim, validate. Throws INVALID_EMAIL. */
export function sanitizeEmail(raw: unknown): string {
  if (!raw) throw authenticationError('INVALID_EMAIL', 400, { email: raw })
  const email = String(raw).toLowerCase().trim()
  if (!emailSchema.safeParse(email).success) throw authenticationError('INVALID_EMAIL', 400, { email })
  return email
}

/**
 * PD-1034 / PD-1056 `EmailCheckEndpoint.post`. Tells the client which credential screen to show.
 * Status is MAGIC_CODE for password-less users (and new users) only when SMTP and magic-link login are enabled.
 */
export async function checkEmail(input: unknown, env?: Record<string, unknown>) {
  const instance = await loadAuthSettings(getDb(), env)
  if (!instance.setupDone) throw authenticationError('INSTANCE_NOT_CONFIGURED')
  const body = emailCheckSchema.safeParse(input)
  if (!body.success) throw authenticationError('EMAIL_REQUIRED')
  const email = sanitizeEmail(body.data.email)
  const magic = instance.smtpConfigured && instance.magicLinkEnabled
  const existing = await findUserByEmail(email)
  if (!existing) return { existing: false, status: magic ? 'MAGIC_CODE' : 'CREDENTIAL' }
  const [security] = await getDb().select({ autoset: userSecurity.isPasswordAutoset }).from(userSecurity).where(eq(userSecurity.userId, existing.id)).limit(1)
  const [credential] = await getDb().select({ id: account.id }).from(account).where(and(eq(account.userId, existing.id), eq(account.providerId, 'credential'))).limit(1)
  const passwordless = security?.autoset ?? !credential
  return { existing: true, status: passwordless && magic ? 'MAGIC_CODE' : 'CREDENTIAL' }
}

/** PD-1045 / PD-1067 `MagicGenerateEndpoint.post` preconditions (the code itself is issued by Better Auth email OTP). */
export async function assertMagicGenerateAllowed(rawEmail: unknown, env?: Record<string, unknown>) {
  const instance = await loadAuthSettings(getDb(), env)
  if (!instance.setupDone) throw authenticationError('INSTANCE_NOT_CONFIGURED')
  const email = sanitizeEmail(String(rawEmail ?? '').trim().toLowerCase())
  if (!instance.smtpConfigured) throw authenticationError('SMTP_NOT_CONFIGURED', 400, { email })
  if (!instance.magicLinkEnabled) throw authenticationError('MAGIC_LINK_LOGIN_DISABLED', 400, { email })
  return email
}

/** Map a Better Auth OTP failure to Plane's SIGN_IN / SIGN_UP variants (PD-0998 `_raise_for_email`). */
export async function magicErrorFor(message: string, email: string) {
  const exists = Boolean(await findUserByEmail(email))
  const variant = exists ? 'SIGN_IN' : 'SIGN_UP'
  const base = /too many|attempt/i.test(message) ? 'EMAIL_CODE_ATTEMPT_EXHAUSTED' : /expired/i.test(message) ? 'EXPIRED_MAGIC_CODE' : 'INVALID_MAGIC_CODE'
  const name = `${base}_${variant}` as keyof typeof AUTHENTICATION_ERROR_CODES
  return getErrorDict(name, { email })
}

/** Redirect target after a successful sign-in (PD-1031). `onboarding` / slug / `invitations` / `create-workspace`. */
export async function redirectionFor(email: string) {
  const person = await findUserByEmail(email)
  if (!person) return 'create-workspace'
  return getRedirectionPath(person.id)
}

export async function userIdForEmail(email: string) {
  const [row] = await getDb().select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)
  return row?.id
}
