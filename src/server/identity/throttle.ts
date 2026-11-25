import { lt, sql } from 'drizzle-orm'
import { authCounters } from '@/db/schema/ext-p1-auth'
import { getDb } from '@/db/client'
import { authenticationError } from '@/server/identity/errors'
import { checkRateLimit } from '@/server/common/rate-limit'
import type { LancityDb } from '@/types/database/schema'

/** Plane AuthenticationThrottle default "10/minute"; AUTHENTICATION_RATE_LIMIT is "<n>/<second|minute|hour|day>". */
export function parseRate(raw: string | undefined, fallback = '10/minute'): { limit: number; windowSeconds: number } {
  const match = /^(\d+)\/(second|minute|hour|day)$/.exec((raw ?? '').trim())
  const [, n, unit] = match ?? /^(\d+)\/(second|minute|hour|day)$/.exec(fallback)!
  return { limit: Number(n), windowSeconds: { second: 1, minute: 60, hour: 3600, day: 86400 }[unit as 'second'] }
}

/**
 * Atomic fixed-window increment (Redis INCR + first-time EXPIRE). The window starts at the first hit and is not
 * extended by later hits. Returns the new count.
 */
export async function incrementCounter(key: string, windowSeconds: number, db: LancityDb = getDb()): Promise<number> {
  const nowMs = Date.now()
  const expiresAt = nowMs + windowSeconds * 1000
  const [row] = await db
    .insert(authCounters)
    .values({ key, count: 1, expiresAt: new Date(expiresAt) })
    .onConflictDoUpdate({
      target: authCounters.key,
      set: {
        count: sql`case when ${authCounters.expiresAt} <= ${nowMs} then 1 else ${authCounters.count} + 1 end`,
        expiresAt: sql`case when ${authCounters.expiresAt} <= ${nowMs} then ${expiresAt} else ${authCounters.expiresAt} end`
      }
    })
    .returning({ count: authCounters.count })
  if (Math.random() < 0.02) await db.delete(authCounters).where(lt(authCounters.expiresAt, new Date(nowMs)))
  return row.count
}

export async function resetCounter(key: string, db: LancityDb = getDb()): Promise<void> {
  await db.delete(authCounters).where(sql`${authCounters.key} = ${key}`)
}

/**
 * True when the hit is within `limit` for the window (Plane `authentication_throttle_allows`). Uses the sliding
 * window of `checkRateLimit`, so a burst split across a window boundary cannot get twice the limit through.
 * A rejected hit is not recorded.
 */
export async function throttleAllows(
  scope: string,
  ident: string,
  rate: { limit: number; windowSeconds: number },
  db: LancityDb = getDb()
): Promise<boolean> {
  return (await checkRateLimit(db, `throttle:${scope}:${ident}`, rate)).allowed
}

/** Client IP the way Plane `user_ip` / `get_client_ip` resolves it, trusting only Cloudflare's header. */
export function clientIp(headers: Headers): string {
  return headers.get('cf-connecting-ip') ?? headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

/** PD-1018 `throttle_auth_redirect` / PD-1015 `AuthenticationThrottle` for the JSON auth endpoints. */
export async function enforceAuthThrottle(headers: Headers, env: Record<string, unknown>, db?: LancityDb): Promise<void> {
  if (!headers.get('cf-connecting-ip')) return
  if (!(await throttleAllows('authentication', clientIp(headers), parseRate(env.AUTHENTICATION_RATE_LIMIT as string | undefined), db))) {
    throw authenticationError('RATE_LIMIT_EXCEEDED', 429)
  }
}

/**
 * Throttle for password checks made through direct `auth.api.*` calls, which bypass the Better Auth hook.
 * Counts per user (always) and per client IP (when Cloudflare supplies one), using the Plane authentication rate.
 */
export async function enforcePasswordCheckThrottle(userId: number, headers: Headers, env: Record<string, unknown>, db?: LancityDb): Promise<void> {
  const rate = parseRate(env.AUTHENTICATION_RATE_LIMIT as string | undefined)
  if (!(await throttleAllows('authentication:user', String(userId), rate, db))) throw authenticationError('RATE_LIMIT_EXCEEDED', 429)
  await enforceAuthThrottle(headers, env, db)
}
