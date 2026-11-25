import { and, eq, isNull, sql } from 'drizzle-orm'
import { APIError } from 'better-auth/api'
import { getDb } from '@/db/client'
import { user } from '@/db/schema/auth'
import { userSecurity } from '@/db/schema/ext-p1-auth'
import { profiles } from '@/db/schema/identity'
import { instanceAdmins, instances } from '@/db/schema/instance'
import { createAuth } from '@/lib/auth/auth'
import { ServiceError } from '@/server/common/errors'
import { isPasswordStrong } from '@/server/identity/password'
import { provisionUser, recordLogin } from '@/server/identity/onboarding'
import { clientIp } from '@/server/identity/throttle'
import { currentInstance, requireInstanceAdmin } from '@/server/instance/permissions'
import { toInstanceAdminMeResponse } from '@/server/instance/presenters'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import { instanceAdminSignInSchema, instanceAdminSignUpSchema } from '@/types/instance/p3-instance-schema'

export async function listInstanceAdmins(db: LancityDb, actor: Actor) {
  const { instance } = await requireInstanceAdmin(db, actor)
  return db
    .select({ id: instanceAdmins.id, userId: user.id, name: user.name, email: user.email })
    .from(instanceAdmins)
    .innerJoin(user, eq(user.id, instanceAdmins.userId))
    .where(and(eq(instanceAdmins.instanceId, instance.id), isNull(instanceAdmins.deletedAt)))
    .orderBy(instanceAdmins.id)
}

export async function addInstanceAdmin(db: LancityDb, actor: Actor, email: string) {
  const { instance } = await requireInstanceAdmin(db, actor)
  const [person] = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.email, email), eq(user.emailVerified, true)))
    .limit(1)
  if (!person) throw new ServiceError(404, 'VERIFIED_USER_NOT_FOUND', 'Verified user not found')
  const [admin] = await db
    .insert(instanceAdmins)
    .values({ instanceId: instance.id, userId: person.id, role: 20, isVerified: true, createdById: actor.userId })
    .onConflictDoUpdate({
      target: [instanceAdmins.instanceId, instanceAdmins.userId],
      set: { deletedAt: null, updatedById: actor.userId }
    })
    .returning({ id: instanceAdmins.id, userId: instanceAdmins.userId, role: instanceAdmins.role })
  return admin
}

export async function removeInstanceAdmin(db: LancityDb, actor: Actor, adminId: number) {
  const { instance } = await requireInstanceAdmin(db, actor)
  const [removed] = await db
    .update(instanceAdmins)
    .set({ deletedAt: new Date(), updatedById: actor.userId })
    .where(
      and(
        eq(instanceAdmins.id, adminId),
        eq(instanceAdmins.instanceId, instance.id),
        isNull(instanceAdmins.deletedAt),
        sql`exists (select 1 from instance_admins other where other.instance_id = ${instance.id} and other.id != ${adminId}
        and other.user_id is not null and other.deleted_at is null and other.role = 20)`
      )
    )
    .returning({ id: instanceAdmins.id })
  if (removed) return
  const [target] = await db
    .select({ id: instanceAdmins.id })
    .from(instanceAdmins)
    .where(
      and(eq(instanceAdmins.id, adminId), eq(instanceAdmins.instanceId, instance.id), isNull(instanceAdmins.deletedAt))
    )
  if (!target) throw new ServiceError(404, 'ADMIN_NOT_FOUND', 'Instance admin not found')
  throw new ServiceError(409, 'LAST_ADMIN', 'At least one instance admin is required')
}

export const createInstanceAdmin = addInstanceAdmin
export const getInstanceAdmin = listInstanceAdmins
export const deleteInstanceAdmin = removeInstanceAdmin

/** Plane `AUTHENTICATION_ERROR_CODES` entries used by the admin console (authentication/adapter/error.py). */
export const ADMIN_ERROR_CODES = {
  INSTANCE_NOT_CONFIGURED: 5000,
  PASSWORD_TOO_WEAK: 5021,
  ADMIN_ALREADY_EXIST: 5150,
  REQUIRED_ADMIN_EMAIL_PASSWORD_FIRST_NAME: 5155,
  INVALID_ADMIN_EMAIL: 5160,
  REQUIRED_ADMIN_EMAIL_PASSWORD: 5170,
  ADMIN_AUTHENTICATION_FAILED: 5175,
  ADMIN_USER_ALREADY_EXIST: 5180,
  ADMIN_USER_DOES_NOT_EXIST: 5185,
  ADMIN_USER_DEACTIVATED: 5190
} as const
type AdminErrorName = keyof typeof ADMIN_ERROR_CODES

/** A failed admin sign-in or sign-up: Plane redirected with `error_code` and `error_message` in the query string. */
function adminError(name: AdminErrorName, status = 400, payload?: Record<string, unknown>): never {
  throw new ServiceError(status, name, name, { error_code: ADMIN_ERROR_CODES[name], error_message: name, ...payload })
}

export type AdminSessionResult = { body: Record<string, unknown>; cookies: string[] }

/** Raw email check like Django `validate_email` after `strip().lower()`. */
const normalizeEmail = (raw: unknown) => (typeof raw === 'string' ? raw.trim().toLowerCase() : '')
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 255

/**
 * PD-1536 `InstanceAdminSignUpEndpoint.post`: first-run setup. Creates the first user through Better Auth and makes
 * them the only instance admin. Plane locks the instance row; D1 has no row locks, so the admin row is claimed with a
 * single `insert ... where not exists` and the new user is removed when another request won the race
 * (GHSA-p548-28jp-wr4p).
 */
export async function createInstanceAdminSignUp(db: LancityDb, raw: unknown, headers: Headers): Promise<AdminSessionResult> {
  const instance = await currentInstance(db)
  if (!instance) adminError('INSTANCE_NOT_CONFIGURED')
  const [anyAdmin] = await db.select({ id: instanceAdmins.id }).from(instanceAdmins).limit(1)
  if (instance.isSetupDone || anyAdmin) adminError('ADMIN_ALREADY_EXIST', 409)

  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const email = normalizeEmail(body.email)
  const payload = {
    email,
    first_name: body.first_name,
    last_name: body.last_name ?? '',
    company_name: body.company_name ?? '',
    is_telemetry_enabled: body.is_telemetry_enabled ?? true
  }
  if (!email || !body.password || !body.first_name) adminError('REQUIRED_ADMIN_EMAIL_PASSWORD_FIRST_NAME', 400, { payload })
  if (!isEmail(email)) adminError('INVALID_ADMIN_EMAIL', 400, { payload })
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)
  if (existing) adminError('ADMIN_USER_ALREADY_EXIST', 409, { payload })
  if (typeof body.password !== 'string' || !isPasswordStrong(body.password)) adminError('PASSWORD_TOO_WEAK', 400, { payload })
  const input = instanceAdminSignUpSchema.safeParse({ ...body, email })
  if (!input.success) throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid request input', input.error.issues)
  const { password, first_name: firstName, last_name: lastName, company_name: companyName, is_telemetry_enabled: telemetry } = input.data

  const signUp = await createAuth().api.signUpEmail({
    body: { name: `${firstName} ${lastName}`.trim(), email, password },
    headers,
    returnHeaders: true
  })
  const userId = Number(signUp.response.user.id)
  const claimed = await db.run(sql`insert into instance_admins (instance_id, user_id, role, is_verified, created_by_id, updated_by_id)
    select ${instance.id}, ${userId}, 20, 1, ${userId}, ${userId}
    where not exists (select 1 from instance_admins)`)
  if (!claimed.meta.changes) {
    await db.delete(user).where(eq(user.id, userId))
    adminError('ADMIN_ALREADY_EXIST', 409)
  }
  await provisionUser(userId, { passwordAutoset: false }, db)
  await db.update(profiles).set({ firstName, lastName, companyName }).where(eq(profiles.userId, userId))
  await db
    .update(instances)
    .set({ isSetupDone: true, instanceName: companyName || instance.instanceName, isTelemetryEnabled: telemetry, updatedById: userId })
    .where(eq(instances.id, instance.id))
  await recordLogin(userId, { medium: 'email', ip: clientIp(headers), userAgent: headers.get('user-agent') }, db)
  return { body: { success: true, redirect_path: '/general/' }, cookies: signUp.headers.getSetCookie() }
}

/**
 * PD-1537 `InstanceAdminSignInEndpoint.post`. Differs from Plane in one step: instance-admin membership is checked
 * before the password, so no session is ever created for a non-admin. Both failures return `ADMIN_AUTHENTICATION_FAILED`.
 */
export async function createInstanceAdminSignIn(db: LancityDb, raw: unknown, headers: Headers): Promise<AdminSessionResult> {
  const instance = await currentInstance(db)
  if (!instance) adminError('INSTANCE_NOT_CONFIGURED')
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const email = normalizeEmail(body.email)
  if (!email || !body.password) adminError('REQUIRED_ADMIN_EMAIL_PASSWORD', 400, { payload: { email: body.email ?? false } })
  if (!isEmail(email)) adminError('INVALID_ADMIN_EMAIL', 400, { payload: { email } })
  const input = instanceAdminSignInSchema.safeParse({ email, password: body.password })
  if (!input.success) adminError('ADMIN_AUTHENTICATION_FAILED', 400, { payload: { email } })

  const [person] = await db
    .select({ id: user.id, isActive: userSecurity.isActive, isBot: userSecurity.isBot })
    .from(user)
    .leftJoin(userSecurity, eq(userSecurity.userId, user.id))
    .where(eq(user.email, email))
    .limit(1)
  if (!person) adminError('ADMIN_USER_DOES_NOT_EXIST', 404, { payload: { email } })
  if (person.isBot) adminError('ADMIN_AUTHENTICATION_FAILED', 401, { payload: { email } })
  if (person.isActive === false) adminError('ADMIN_USER_DEACTIVATED', 403)
  const [admin] = await db
    .select({ id: instanceAdmins.id })
    .from(instanceAdmins)
    .where(and(eq(instanceAdmins.instanceId, instance.id), eq(instanceAdmins.userId, person.id), isNull(instanceAdmins.deletedAt)))
    .limit(1)
  if (!admin) adminError('ADMIN_AUTHENTICATION_FAILED', 401, { payload: { email } })

  let result
  try {
    result = await createAuth().api.signInEmail({ body: { email, password: input.data.password }, headers, returnHeaders: true })
  } catch (error) {
    if (error instanceof APIError) adminError('ADMIN_AUTHENTICATION_FAILED', 401, { payload: { email } })
    throw error
  }
  await recordLogin(person.id, { medium: 'email', ip: clientIp(headers), userAgent: headers.get('user-agent') }, db)
  return { body: { success: true, redirect_path: '/general/' }, cookies: result.headers.getSetCookie() }
}

async function loadAdminMe(db: LancityDb, userId: number) {
  const [row] = await db
    .select({ person: user, profile: profiles, security: userSecurity })
    .from(user)
    .innerJoin(profiles, eq(profiles.userId, user.id))
    .leftJoin(userSecurity, eq(userSecurity.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1)
  if (!row) throw new ServiceError(404, 'NOT_FOUND', 'The required object does not exist.')
  return toInstanceAdminMeResponse(row.person, row.profile, row.security ?? undefined)
}

/** PD-1538 `InstanceAdminUserMeEndpoint.get`. */
export async function getInstanceAdminUserMe(db: LancityDb, actor: Actor) {
  await requireInstanceAdmin(db, actor)
  return loadAdminMe(db, actor.userId)
}

/** PD-1539 `InstanceAdminUserSessionEndpoint.get`: public; `is_authenticated` is true only for instance admins. */
export async function getInstanceAdminUserSession(db: LancityDb, actor: Actor | null) {
  if (!actor) return { is_authenticated: false }
  const instance = await currentInstance(db)
  const [admin] = instance
    ? await db
        .select({ id: instanceAdmins.id })
        .from(instanceAdmins)
        .where(and(eq(instanceAdmins.userId, actor.userId), isNull(instanceAdmins.deletedAt)))
        .limit(1)
    : []
  return admin ? { is_authenticated: true, user: await loadAdminMe(db, actor.userId) } : { is_authenticated: false }
}

/**
 * PD-1540 `InstanceAdminSignOutEndpoint.post`: record the logout and end the session. Like Plane it never fails;
 * a missing or expired session just yields the redirect.
 */
export async function createInstanceAdminSignOut(actor: Actor | null, headers: Headers): Promise<AdminSessionResult> {
  const db = getDb()
  let cookies: string[] = []
  if (actor) {
    await db
      .update(userSecurity)
      .set({ lastLogoutTime: new Date(), lastLogoutIp: clientIp(headers) })
      .where(eq(userSecurity.userId, actor.userId))
  }
  try {
    cookies = (await createAuth().api.signOut({ headers, returnHeaders: true })).headers.getSetCookie()
  } catch {
    // The session is already gone.
  }
  return { body: { success: true, redirect_path: '/' }, cookies }
}
