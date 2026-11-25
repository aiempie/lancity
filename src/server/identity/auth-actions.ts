import { APIError } from 'better-auth/api'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { account } from '@/db/schema/auth'
import { userSecurity } from '@/db/schema/ext-p1-auth'
import { createAuth } from '@/lib/auth/auth'
import { getEnv } from '@/server/common/env'
import { ServiceError } from '@/server/common/errors'
import { validateNextPath } from '@/server/common/path-validator'
import {
  assertMagicGenerateAllowed,
  checkEmail,
  magicErrorFor,
  redirectionFor,
  sanitizeEmail,
  userIdForEmail
} from '@/server/identity/auth-flows'
import { AUTHENTICATION_ERROR_CODES, authenticationError, type AuthenticationErrorName } from '@/server/identity/errors'
import { isPasswordStrong } from '@/server/identity/password'
import { findUserByEmail } from '@/server/identity/queries'
import { loadAuthSettings } from '@/server/identity/settings'
import { enforceAuthThrottle, enforcePasswordCheckThrottle } from '@/server/identity/throttle'
import type { Actor, ChangePasswordInput } from '@/types/auth/schema'

/** Convert a Better Auth APIError into the Plane error shape used by the API adapter. */
function rethrow(error: unknown): never {
  if (error instanceof APIError) {
    const body = (error.body ?? {}) as { code?: string; message?: string; error_code?: number }
    const name = (body.code && body.code in AUTHENTICATION_ERROR_CODES ? body.code : 'AUTHENTICATION_FAILED') as AuthenticationErrorName
    throw authenticationError(name, Number(error.statusCode) || 400, { error_message: body.message ?? name })
  }
  throw error
}

export { enforceAuthThrottle, enforcePasswordCheckThrottle }

async function isPasswordAutoset(userId: number): Promise<boolean> {
  const db = getDb()
  const [credential] = await db.select({ id: account.id }).from(account).where(and(eq(account.userId, userId), eq(account.providerId, 'credential'))).limit(1)
  if (!credential) return true
  const [security] = await db.select({ autoset: userSecurity.isPasswordAutoset }).from(userSecurity).where(eq(userSecurity.userId, userId)).limit(1)
  return security?.autoset ?? false
}

async function clearAutoset(userId: number): Promise<void> {
  await getDb().insert(userSecurity).values({ userId, isPasswordAutoset: false }).onConflictDoUpdate({ target: userSecurity.userId, set: { isPasswordAutoset: false } })
}

export { checkEmail }

/** PD-1045 `MagicGenerateEndpoint.post`. Returns the Plane `key`; the code is emailed through the queue. */
export async function magicGenerate(rawEmail: unknown, headers: Headers, env: Record<string, unknown>) {
  const email = await assertMagicGenerateAllowed(rawEmail, env)
  try {
    await createAuth().api.sendVerificationOTP({ body: { email, type: 'sign-in' }, headers })
  } catch (error) {
    rethrow(error)
  }
  return { key: `magic_${email}` }
}

/**
 * PD-1046 / PD-1047 magic sign-in and sign-up. Better Auth verifies the code (5 attempts, 10 minutes) and sets the
 * session cookie; the Set-Cookie headers are returned so the Hono adapter can forward them.
 */
export async function magicSignIn(input: { email: string; code: string; next_path?: string }, mode: 'sign-in' | 'sign-up', headers: Headers) {
  const email = sanitizeEmail(input.email)
  const existing = await findUserByEmail(email)
  if (mode === 'sign-in' && !existing) throw authenticationError('USER_DOES_NOT_EXIST')
  if (mode === 'sign-up' && existing) throw authenticationError('USER_ALREADY_EXIST', 400, { email })
  let response: Response
  try {
    response = await createAuth().api.signInEmailOTP({ body: { email, otp: input.code }, headers, asResponse: true })
  } catch (error) {
    if (error instanceof APIError) {
      const body = (error.body ?? {}) as { code?: string; message?: string }
      if (body.code && body.code in AUTHENTICATION_ERROR_CODES) rethrow(error)
      throw new ServiceError(400, 'MAGIC_CODE_INVALID', 'Invalid magic code', await magicErrorFor(`${body.code ?? ''} ${body.message ?? ''}`, email))
    }
    throw error
  }
  const userId = await userIdForEmail(email)
  const profilePath = userId ? await redirectionFor(email) : 'create-workspace'
  // Plane: a password-less, already onboarded user returns to "/"; others follow next_path or the computed path.
  // Plane `validate_next_path`: only a safe same-origin relative path is honoured, otherwise use the computed path.
  const path = validateNextPath(input.next_path) || profilePath
  return { cookies: response.headers.getSetCookie(), body: { redirect_path: path, is_signup: mode === 'sign-up' } }
}

/**
 * PD-1049 `ForgotPasswordEndpoint.post`. Unlike Plane the response is identical for unknown addresses, so the
 * endpoint cannot be used to enumerate accounts (USER_DOES_NOT_EXIST is intentionally not returned).
 */
export async function forgotPassword(rawEmail: unknown, redirectTo: string, env: Record<string, unknown>, headers?: Headers) {
  const instance = await loadAuthSettings(getDb(), env)
  if (!instance.setupDone) throw authenticationError('INSTANCE_NOT_CONFIGURED')
  if (!instance.smtpConfigured) throw authenticationError('SMTP_NOT_CONFIGURED')
  const email = sanitizeEmail(rawEmail)
  try {
    await createAuth().api.requestPasswordReset({ body: { email, redirectTo }, headers })
  } catch (error) {
    rethrow(error)
  }
  return { message: 'Check your email to reset your password' }
}

/** PD-1050 `ResetPasswordEndpoint.post` with a Better Auth reset token (1 hour, single use). */
export async function resetPassword(input: { token: string; password: string }) {
  if (!isPasswordStrong(input.password)) throw authenticationError('PASSWORD_TOO_WEAK')
  try {
    await createAuth().api.resetPassword({ body: { token: input.token, newPassword: input.password } })
  } catch (error) {
    if (error instanceof APIError) throw authenticationError('INVALID_PASSWORD_TOKEN', 400)
    throw error
  }
  return { message: 'Password updated successfully' }
}

/** PD-1055 `SetUserPasswordEndpoint.post`: only for password-less (auto-set) accounts. */
export async function setUserPassword(actor: Actor, password: string, headers: Headers) {
  if (!(await isPasswordAutoset(actor.userId))) {
    throw authenticationError('PASSWORD_ALREADY_SET', 400, { error: 'Your password is already set please change your password from profile' })
  }
  if (!password || !isPasswordStrong(password)) throw authenticationError('INVALID_PASSWORD')
  try {
    await createAuth().api.setPassword({ body: { newPassword: password }, headers })
  } catch (error) {
    rethrow(error)
  }
  await clearAutoset(actor.userId)
  return { message: 'Password updated successfully' }
}

/** PD-1054 `ChangePasswordEndpoint.post` (+ PD-0369 validation). Old password is skipped for auto-set accounts. */
export async function changePassword(actor: Actor, input: ChangePasswordInput, headers: Headers) {
  const autoset = await isPasswordAutoset(actor.userId)
  if (!autoset && !input.old_password) throw authenticationError('MISSING_PASSWORD', 400, { error: 'Old password is missing' })
  // Plane checks the old password before the strength of the new one.
  if (!autoset) {
    await enforcePasswordCheckThrottle(actor.userId, headers, getEnv() as Record<string, unknown>)
    try {
      await createAuth().api.verifyPassword({ body: { password: input.old_password! }, headers })
    } catch (error) {
      if (error instanceof APIError) throw authenticationError('INCORRECT_OLD_PASSWORD', 400, { error: 'Old password is not correct' })
      throw error
    }
  }
  if (!isPasswordStrong(input.new_password)) throw authenticationError('PASSWORD_TOO_WEAK')
  let cookies: string[] = []
  try {
    if (autoset) {
      await createAuth().api.setPassword({ body: { newPassword: input.new_password }, headers })
    } else {
      const result = await createAuth().api.changePassword({
        returnHeaders: true,
        body: { currentPassword: input.old_password!, newPassword: input.new_password, revokeOtherSessions: true },
        headers
      })
      cookies = result.headers.getSetCookie()
    }
  } catch (error) {
    if (error instanceof APIError && !autoset) throw authenticationError('INCORRECT_OLD_PASSWORD', 400, { error: 'Old password is not correct' })
    rethrow(error)
  }
  await clearAutoset(actor.userId)
  return { body: { message: 'Password updated successfully' }, cookies }
}

/** Public auth capabilities for the sign-in screen and mobile clients (PD-1043 initiate checks). */
export async function getAuthConfig(env: Record<string, unknown>) {
  const s = await loadAuthSettings(getDb(), env)
  return {
    is_instance_setup_done: s.setupDone,
    enable_signup: s.signupEnabled,
    is_email_password_enabled: s.emailPasswordEnabled,
    is_magic_login_enabled: s.magicLinkEnabled && s.smtpConfigured,
    is_google_enabled: s.google.enabled,
    is_github_enabled: s.github.enabled,
    is_gitlab_enabled: s.gitlab.enabled,
    is_gitea_enabled: s.gitea.enabled,
    is_smtp_configured: s.smtpConfigured
  }
}

