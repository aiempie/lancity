import { registerJobHandler, registerScheduled } from '@/server/common/jobs'

export const PURGE_PLATFORM_TABLES = 'platform.purge_tables'

/** Hourly cleanup of expired cache entries and stale rate limit hits. Both tables only grow otherwise. */
export function register(): void {
  const purge = async () => {
    const { getDb } = await import('@/db/client')
    const { lte } = await import('drizzle-orm')
    const { cacheEntries, rateLimitHits } = await import('@/db/schema/ext-p1-platform')
    const db = getDb()
    const now = Date.now()
    await db.delete(cacheEntries).where(lte(cacheEntries.expiresAt, now))
    // The longest window in use is one day (rates such as `1000/day`).
    await db.delete(rateLimitHits).where(lte(rateLimitHits.hitAt, now - 86_400_000))
  }
  registerJobHandler(PURGE_PLATFORM_TABLES, purge)
  registerScheduled('15 * * * *', purge, PURGE_PLATFORM_TABLES)
}
