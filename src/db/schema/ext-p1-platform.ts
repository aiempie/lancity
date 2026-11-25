import { index, integer, sqliteTable, text, uniqueIndex, type SQLiteTableExtraConfigValue } from 'drizzle-orm/sqlite-core'
import { now } from './columns'

/** One row per accepted request, used by the sliding-window rate limiter (replaces DRF throttle cache history). */
export const rateLimitHits = sqliteTable(
  'rate_limit_hits',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    key: text('key', { length: 255 }).notNull(),
    hitAt: integer('hit_at').notNull()
  },
  (table): SQLiteTableExtraConfigValue[] => [index('rate_limit_hits_key_hit_at_idx').on(table.key, table.hitAt)]
)

/** Key/value response cache with expiry (replaces Plane's Redis-backed Django cache). */
export const cacheEntries = sqliteTable(
  'cache_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    key: text('key').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at').notNull(),
    createdAt: now('created_at').notNull()
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('cache_entries_key_unique').on(table.key),
    index('cache_entries_expires_at_idx').on(table.expiresAt)
  ]
)
