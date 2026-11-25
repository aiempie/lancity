import { and, eq, gt, lte, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { rateLimitHits } from '@/db/schema/ext-p1-platform'
import { logException } from '@/server/common/exception-logger'
import { getClientIp } from '@/server/common/ip-address'
import type { RateLimitResult, RateSpec } from '@/types/api/platform'
import type { ApiEnv } from '@/types/api/schema'
import type { LancityDb } from '@/types/database/schema'

const PERIODS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

/** DRF `SimpleRateThrottle.parse_rate`: `60/minute` means 60 requests per 60 seconds (only the first letter of the period counts). */
export function parseRate(rate: string): RateSpec {
  const [count, period] = rate.split('/')
  const windowSeconds = PERIODS[period?.[0]]
  const limit = Number(count)
  if (!windowSeconds || !Number.isInteger(limit) || limit < 0) throw new Error(`Invalid rate "${rate}"`)
  return { limit, windowSeconds }
}

/** SHA-256 hex digest (keys are hashed so raw API keys are never stored). */
export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Sliding window limiter on D1 (DRF `SimpleRateThrottle`): a request is recorded only when fewer than
 * `limit` requests happened in the last `windowSeconds`. The conditional insert is one atomic statement,
 * so concurrent requests cannot exceed the limit.
 */
export async function checkRateLimit(
  db: LancityDb,
  key: string,
  spec: RateSpec,
  now = Date.now()
): Promise<RateLimitResult> {
  const since = now - spec.windowSeconds * 1000
  await db.delete(rateLimitHits).where(and(eq(rateLimitHits.key, key), lte(rateLimitHits.hitAt, since)))
  const inserted = await db.run(
    sql`insert into ${rateLimitHits} (${sql.identifier('key')}, ${sql.identifier('hit_at')})
      select ${key}, ${now}
      where (select count(*) from ${rateLimitHits} where ${rateLimitHits.key} = ${key} and ${rateLimitHits.hitAt} > ${since}) < ${spec.limit}`
  )
  const allowed = ((inserted as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0
  const [stats] = await db
    .select({ count: sql<number>`count(*)`, oldest: sql<number | null>`min(${rateLimitHits.hitAt})` })
    .from(rateLimitHits)
    .where(and(eq(rateLimitHits.key, key), gt(rateLimitHits.hitAt, since)))
  const count = Number(stats?.count ?? 0)
  const resetAt = Math.floor(now / 1000 + spec.windowSeconds)
  if (allowed) return { allowed, remaining: Math.max(0, spec.limit - count), resetAt, retryAfter: null }
  // DRF `wait()`: time left for the oldest request divided by the requests still available.
  const available = spec.limit - count + 1
  const remainingDuration = spec.windowSeconds - (now - (stats?.oldest ?? now)) / 1000
  return {
    allowed,
    remaining: 0,
    resetAt,
    retryAfter: available > 0 ? Math.max(1, Math.ceil(remainingDuration / available)) : null
  }
}

/** DRF `finalize_response` for throttled views: expose the remaining budget to the client. */
export function setRateLimitHeaders(c: Context, result: RateLimitResult): void {
  c.header('X-RateLimit-Remaining', String(result.remaining))
  c.header('X-RateLimit-Reset', String(result.resetAt))
}

export type RateLimitOptions = {
  /** Throttle key, or null to skip the request (DRF `get_cache_key` returning None). */
  key: (c: Context<ApiEnv>) => string | null | Promise<string | null>
  /** `60/minute` style rate, or a function so it can read the environment at request time. */
  rate: string | ((c: Context<ApiEnv>) => string | Promise<string>)
  /** Send `X-RateLimit-Remaining` and `X-RateLimit-Reset` on allowed requests. */
  headers?: boolean
  db?: () => Promise<LancityDb> | LancityDb
}

async function defaultDb(): Promise<LancityDb> {
  const { getDb } = await import('@/db/client')
  return getDb()
}

/** Generic throttle middleware. Rejects with 429 and `Retry-After`. A limiter failure never blocks the request. */
export function rateLimit(options: RateLimitOptions) {
  return createMiddleware<ApiEnv>(async (c, next) => {
    const key = await options.key(c)
    if (!key) return next()
    let result: RateLimitResult
    try {
      const rate = typeof options.rate === 'function' ? await options.rate(c) : options.rate
      result = await checkRateLimit(await (options.db ?? defaultDb)(), key, parseRate(rate))
    } catch (error) {
      logException(error, { warning: true, context: { label: 'rate-limit' } })
      return next()
    }
    if (!result.allowed) {
      const wait = result.retryAfter
      return c.json(
        {
          error: {
            code: 'THROTTLED',
            message: wait
              ? `Request was throttled. Expected available in ${wait} second${wait === 1 ? '' : 's'}.`
              : 'Request was throttled.'
          }
        },
        429,
        wait ? { 'Retry-After': String(wait) } : undefined
      )
    }
    if (options.headers) setRateLimitHeaders(c, result)
    await next()
  })
}

/** Plane `ApiKeyRateThrottle`: per `X-Api-Key`, rate from `API_KEY_RATE_LIMIT` (default `60/minute`). No key, no throttle. */
export function apiKeyRateLimit(rate?: string, db?: RateLimitOptions['db']) {
  return rateLimit({
    db,
    headers: true,
    rate:
      rate ??
      (async () => {
        const { getEnv } = await import('@/server/common/env')
        return (getEnv().API_KEY_RATE_LIMIT as string | undefined) || '60/minute'
      }),
    key: async c => {
      const apiKey = c.req.header('x-api-key')
      return apiKey ? `api_key:${await sha256Hex(apiKey)}` : null
    }
  })
}

/** Plane's default `AnonRateThrottle` (30/minute per IP). Authenticated requests are never throttled by it. */
export function anonRateLimit(rate = '30/minute') {
  return rateLimit({
    rate,
    key: c => (c.get('actor') ? null : `anon:${getClientIp(c.req.raw) ?? 'unknown'}`)
  })
}

/** Plane `AssetRateThrottle` (5/minute): one shared bucket per asset id taken from the route parameter. */
export function assetRateLimit(paramName = 'assetId', rate = '5/minute') {
  return rateLimit({
    rate,
    key: c => {
      const assetId = c.req.param(paramName)
      return assetId ? `throttle_asset_${assetId}` : null
    }
  })
}
