import { and, eq, ne, sql } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { account, session, user, verification } from '@/db/schema/auth'
import { userSecurity } from '@/db/schema/ext-p1-auth'
import { profiles } from '@/db/schema/identity'
import { instanceAdmins } from '@/db/schema/instance'
import { projectMembers, workspaceMemberInvites, workspaceMembers } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import { deactivationEmail, emailUpdateCodeEmail, emailUpdateConfirmationEmail } from '@/server/identity/emails'
import { queueAuthMail } from '@/server/identity/jobs'
import { findUser, listUserActivity } from '@/server/identity/queries'
import { incrementCounter, resetCounter } from '@/server/identity/throttle'
import { getDisplayName } from '@/server/identity/model-rules'
import { z } from 'zod'
import type { Actor } from '@/types/auth/schema'

const EMAIL_UPDATE_CODES_PER_TARGET = 5
const EMAIL_UPDATE_CODES_WINDOW = 3600
const EMAIL_UPDATE_CODE_TTL = 600
const MAX_VERIFY_ATTEMPTS = 5
const EMAIL_CODES_PER_USER = 3

const codeKey = (userId: number, email: string) => `email_update:${userId}:${email}`

function randomCode(): string {
  // 6 digits like Plane `secrets.randbelow(900000) + 100000`, without modulo bias.
  const limit = Math.floor(0x100000000 / 900000) * 900000
  const buffer = new Uint32Array(1)
  do crypto.getRandomValues(buffer)
  while (buffer[0] >= limit)
  return String((buffer[0] % 900000) + 100000)
}

/** Plane `UserEndpoint._validate_new_email`. Returns the normalised address or throws a 400. */
export async function validateNewEmailUser(actor: Actor, rawEmail: string | undefined): Promise<string> {
  const email = (rawEmail ?? '').trim().toLowerCase()
  if (!email) throw new ServiceError(400, 'VALIDATION_ERROR', 'Email is required')
  if (!z.email().safeParse(email).success) throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid email format')
  const current = await findUser(actor)
  if (email === current.email) throw new ServiceError(400, 'VALIDATION_ERROR', 'New email must be different from current email')
  const [taken] = await getDb().select({ id: user.id }).from(user).where(and(eq(user.email, email), ne(user.id, actor.userId))).limit(1)
  if (taken) throw new ServiceError(400, 'VALIDATION_ERROR', 'An account with this email already exists')
  return email
}

/** Plane `generate_email_verification_code`: 3 codes/hour/user (EmailVerificationThrottle) and 5/hour per target address. */
export async function generateEmailVerificationCodeUser(actor: Actor, input: { email?: string }) {
  const email = await validateNewEmailUser(actor, input.email)
  if ((await incrementCounter(`email_verification:${actor.userId}`, 3600)) > EMAIL_CODES_PER_USER) {
    throw new ServiceError(429, 'RATE_LIMIT_EXCEEDED', 'Too many verification codes requested')
  }
  if ((await incrementCounter(`email_update_issued:${email}`, EMAIL_UPDATE_CODES_WINDOW)) > EMAIL_UPDATE_CODES_PER_TARGET) {
    throw new ServiceError(429, 'RATE_LIMIT_EXCEEDED', 'Too many verification codes requested')
  }
  const db = getDb()
  const identifier = codeKey(actor.userId, email)
  const code = randomCode()
  await db.delete(verification).where(eq(verification.identifier, identifier))
  await db.insert(verification).values({ identifier, value: code, expiresAt: new Date(Date.now() + EMAIL_UPDATE_CODE_TTL * 1000), createdAt: new Date(), updatedAt: new Date() })
  await resetCounter(`${identifier}:verify_attempts`)
  await queueAuthMail(email, emailUpdateCodeEmail(code))
  return { message: 'Verification code sent to email' }
}

/** Constant-time comparison for short secrets. */
function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  let diff = left.length ^ right.length
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  return diff === 0
}

/** Plane `update_email`: verify the user-bound code, change the email, reset verification, revoke sessions and notify both addresses. */
export async function updateEmailUser(actor: Actor, input: { email?: string; code?: string }) {
  const email = await validateNewEmailUser(actor, input.email)
  const code = (input.code ?? '').trim()
  if (!code) throw new ServiceError(400, 'VALIDATION_ERROR', 'Verification code is required')
  const db = getDb()
  const identifier = codeKey(actor.userId, email)
  // Count every attempt before reading the code so concurrent requests share one budget.
  const attempts = await incrementCounter(`${identifier}:verify_attempts`, EMAIL_UPDATE_CODE_TTL)
  const [row] = await db.select().from(verification).where(eq(verification.identifier, identifier)).limit(1)
  if (!row || row.expiresAt.getTime() <= Date.now()) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Verification code has expired or is invalid')
  }
  if (attempts > MAX_VERIFY_ATTEMPTS || !safeEqual(row.value, code)) {
    if (attempts >= MAX_VERIFY_ATTEMPTS) {
      await db.delete(verification).where(eq(verification.identifier, identifier))
      await resetCounter(`${identifier}:verify_attempts`)
    }
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid verification code')
  }
  const [taken] = await db.select({ id: user.id }).from(user).where(and(eq(user.email, email), ne(user.id, actor.userId))).limit(1)
  if (taken) throw new ServiceError(400, 'VALIDATION_ERROR', 'An account with this email already exists')
  const old = await findUser(actor)
  await db.batch([
    db.update(user).set({ email, emailVerified: false, updatedAt: new Date() }).where(eq(user.id, actor.userId)),
    db.delete(verification).where(eq(verification.identifier, identifier)),
    db.delete(session).where(eq(session.userId, actor.userId))
  ])
  await resetCounter(`${identifier}:verify_attempts`)
  await Promise.all([queueAuthMail(email, emailUpdateConfirmationEmail()), queueAuthMail(old.email, emailUpdateConfirmationEmail())])
  return { id: actor.userId, email, is_email_verified: false }
}

/**
 * Plane `deactivate`. Blocks instance admins and admins who are the last admin of a workspace/project that still has
 * other members (the Plane annotation never fired, so its intent is implemented). Revokes sessions and removes the password.
 */
export async function deactivateUser(actor: Actor, context: { ip?: string } = {}) {
  const db = getDb()
  const person = await findUser(actor)
  const [admin] = await db.select({ id: instanceAdmins.id }).from(instanceAdmins).where(eq(instanceAdmins.userId, actor.userId)).limit(1)
  if (admin) throw new ServiceError(400, 'INSTANCE_ADMIN', 'You cannot deactivate your account since you are an instance admin')

  const blocking = async (table: typeof projectMembers | typeof workspaceMembers, scope: 'project' | 'workspace') => {
    const column = scope === 'project' ? 'project_id' : 'workspace_id'
    const tableName = scope === 'project' ? 'project_members' : 'workspace_members'
    const result = await db.all<{ n: number }>(sql`
      select count(*) as n from ${table} mine
      where mine.member_id = ${actor.userId} and mine.is_active = 1 and mine.deleted_at is null and mine.role = 20
        and exists (select 1 from ${sql.raw(tableName)} o where o.${sql.raw(column)} = mine.${sql.raw(column)} and o.member_id != ${actor.userId} and o.is_active = 1 and o.deleted_at is null)
        and not exists (select 1 from ${sql.raw(tableName)} a where a.${sql.raw(column)} = mine.${sql.raw(column)} and a.member_id != ${actor.userId} and a.is_active = 1 and a.deleted_at is null and a.role = 20)`)
    return Number(result[0]?.n ?? 0) > 0
  }
  if (await blocking(projectMembers, 'project')) {
    throw new ServiceError(400, 'SOLE_ADMIN', 'You cannot deactivate account as you are the only admin in some projects.')
  }
  if (await blocking(workspaceMembers, 'workspace')) {
    throw new ServiceError(400, 'SOLE_ADMIN', 'You cannot deactivate account as you are the only admin in some workspaces.')
  }
  const now = new Date()
  await db.batch([
    db.update(projectMembers).set({ isActive: false }).where(and(eq(projectMembers.memberId, actor.userId), eq(projectMembers.isActive, true))),
    db.update(workspaceMembers).set({ isActive: false }).where(and(eq(workspaceMembers.memberId, actor.userId), eq(workspaceMembers.isActive, true))),
    db.delete(workspaceMemberInvites).where(eq(workspaceMemberInvites.email, person.email)),
    db.delete(session).where(eq(session.userId, actor.userId)),
    db.delete(account).where(and(eq(account.userId, actor.userId), eq(account.providerId, 'credential'))),
    db
      .update(profiles)
      .set({
        lastWorkspaceId: null,
        isTourCompleted: false,
        isOnboarded: false,
        onboardingStep: { workspace_join: false, profile_complete: false, workspace_create: false, workspace_invite: false }
      })
      .where(eq(profiles.userId, actor.userId)),
    db
      .insert(userSecurity)
      .values({ userId: actor.userId, isActive: false, isPasswordAutoset: true, lastLogoutTime: now, lastLogoutIp: context.ip })
      .onConflictDoUpdate({
        target: userSecurity.userId,
        set: { isActive: false, isPasswordAutoset: true, lastLogoutTime: now, lastLogoutIp: context.ip }
      })
  ])
  await queueAuthMail(person.email, deactivationEmail(person.name || getDisplayName(person.email)))
}

/** Plane `AccountEndpoint.delete`: unlink one provider account; the last sign-in method cannot be removed. */
export async function deleteAccount(actor: Actor, accountId: number) {
  const db = getDb()
  const rows = await db.select({ id: account.id, providerId: account.providerId }).from(account).where(eq(account.userId, actor.userId))
  const target = rows.find(row => row.id === accountId)
  if (!target) throw new ServiceError(404, 'NOT_FOUND', 'Account not found')
  if (rows.length === 1) throw new ServiceError(400, 'LAST_ACCOUNT', 'You cannot remove your only sign-in method')
  await db.delete(account).where(and(eq(account.id, accountId), eq(account.userId, actor.userId)))
}

/** Plane `UserActivityEndpoint.get`; cursor format is "<per_page>:<page>:0" like Plane. */
export async function getUserActivity(actor: Actor, query: { per_page?: string; cursor?: string; order_by?: string }) {
  const [cursorSize, cursorPage] = (query.cursor ?? '').split(':').map(Number)
  const perPage = Math.min(Math.max(Number(query.per_page) || cursorSize || 20, 1), 100)
  const page = Math.max(Number.isInteger(cursorPage) ? cursorPage : 0, 0)
  const order = query.order_by === 'created_at' ? 'asc' : 'desc' // allow-list: created_at / -created_at only
  const { results, hasNext } = await listUserActivity(actor.userId, { limit: perPage, offset: page * perPage, order })
  return {
    next_cursor: `${perPage}:${page + 1}:0`,
    prev_cursor: `${perPage}:${Math.max(page - 1, 0)}:1`,
    next_page_results: hasNext,
    prev_page_results: page > 0,
    count: results.length,
    results
  }
}

