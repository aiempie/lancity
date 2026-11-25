import { and, eq, gt, lte, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { cacheEntries } from '@/db/schema/ext-p1-platform'
import { logException } from '@/server/common/exception-logger'
import type { ApiEnv } from '@/types/api/schema'
import type { LancityDb } from '@/types/database/schema'

/**
 * Response cache on D1 (Plane `utils/cache.py` on Redis). D1 is global, so an invalidation is seen by
 * every region, which the per-colo Workers Cache API cannot guarantee.
 */

/** Plane `generate_cache_key`: path, plus the user id when the cache is per user. */
export function generateCacheKey(customPath: string, authHeader?: string | null): string {
  return authHeader ? `${customPath}:${authHeader}` : customPath
}

export type CachedResponse = { data: unknown; status: number }

export async function cacheGet(db: LancityDb, key: string, now = Date.now()): Promise<CachedResponse | null> {
  const [row] = await db
    .select({ value: cacheEntries.value })
    .from(cacheEntries)
    .where(and(eq(cacheEntries.key, key), gt(cacheEntries.expiresAt, now)))
    .limit(1)
  return row ? (JSON.parse(row.value) as CachedResponse) : null
}

export async function cacheSet(db: LancityDb, key: string, value: CachedResponse, timeoutSeconds: number, now = Date.now()): Promise<void> {
  const expiresAt = now + timeoutSeconds * 1000
  const json = JSON.stringify(value)
  await db
    .insert(cacheEntries)
    .values({ key, value: json, expiresAt })
    .onConflictDoUpdate({ target: cacheEntries.key, set: { value: json, expiresAt } })
}

export async function cacheDelete(db: LancityDb, key: string): Promise<void> {
  await db.delete(cacheEntries).where(eq(cacheEntries.key, key))
}

/** Delete every key that contains `fragment` (Plane `cache.delete_many(cache.keys('*fragment*'))`). */
export async function cacheDeleteMatching(db: LancityDb, fragment: string): Promise<void> {
  const pattern = `%${fragment.replace(/[\\%_]/g, '\\$&')}%`
  await db.delete(cacheEntries).where(sql`${cacheEntries.key} like ${pattern} escape '\\'`)
}

/** Remove expired rows. Run from a scheduled job. */
export async function purgeExpiredCache(db: LancityDb, now = Date.now()): Promise<void> {
  await db.delete(cacheEntries).where(lte(cacheEntries.expiresAt, now))
}

async function defaultDb(): Promise<LancityDb> {
  const { getDb } = await import('@/db/client')
  return getDb()
}

function fullPath(c: Context): string {
  const url = new URL(c.req.url)
  return url.pathname + url.search
}

export type CacheResponseOptions = {
  /** Seconds to keep a response. Default one hour. */
  timeout?: number
  /** Cache key path. Default is the full request path with query string. */
  path?: string
  /** Keep a separate entry per authenticated user. Default true. */
  user?: boolean
  /** Skip the cache entirely (Plane skips writes when DEBUG is on). */
  disabled?: boolean
  db?: () => Promise<LancityDb> | LancityDb
}

function userKeyPart(c: Context<ApiEnv>, perUser: boolean): string | null {
  const actor = c.get('actor')
  return actor && perUser ? String(actor.userId) : null
}

/**
 * Plane `cache_response`: serve a cached JSON body when present, otherwise run the handler and cache a 200
 * JSON response. Cache failures are logged and never fail the request.
 */
export function cacheResponse(options: CacheResponseOptions = {}) {
  const { timeout = 60 * 60, user = true } = options
  return createMiddleware<ApiEnv>(async (c, next) => {
    if (options.disabled) return next()
    const key = generateCacheKey(options.path ?? fullPath(c), userKeyPart(c, user))
    let db: LancityDb
    try {
      db = await (options.db ?? defaultDb)()
      const cached = await cacheGet(db, key)
      if (cached) return c.json(cached.data as never, cached.status as never)
    } catch (error) {
      logException(error, { warning: true, context: { label: 'cache' } })
      return next()
    }
    await next()
    if (c.res.status === 200 && (c.res.headers.get('content-type') ?? '').includes('application/json')) {
      try {
        await cacheSet(db, key, { data: await c.res.clone().json(), status: 200 }, timeout)
      } catch (error) {
        logException(error, { warning: true, context: { label: 'cache' } })
      }
    }
  })
}

export type InvalidateCacheOptions = {
  path?: string
  /** Replace `:name` in `path` with the matching route parameter. */
  urlParams?: boolean
  user?: boolean
  /** Delete every key containing the computed key instead of the exact key. */
  multiple?: boolean
  db?: () => Promise<LancityDb> | LancityDb
}

/** Plane `invalidate_cache_directly`: delete the entry (or entries) a `cacheResponse` would have stored. */
export async function invalidateCacheDirectly(c: Context<ApiEnv>, options: InvalidateCacheOptions = {}): Promise<void> {
  const { path, urlParams = false, user = true, multiple = false } = options
  let customPath: string
  if (urlParams && path) {
    customPath = path
    for (const [name, value] of Object.entries(c.req.param())) customPath = customPath.replaceAll(`:${name}`, String(value))
  } else customPath = path ?? fullPath(c)
  const key = generateCacheKey(customPath, userKeyPart(c, user))
  const db = await (options.db ?? defaultDb)()
  if (multiple) await cacheDeleteMatching(db, key)
  else await cacheDelete(db, key)
}

/** Plane `invalidate_cache`: clear the cache entry before the handler runs. */
export function invalidateCache(options: InvalidateCacheOptions = {}) {
  return createMiddleware<ApiEnv>(async (c, next) => {
    try {
      await invalidateCacheDirectly(c, options)
    } catch (error) {
      logException(error, { warning: true, context: { label: 'cache' } })
    }
    await next()
  })
}
