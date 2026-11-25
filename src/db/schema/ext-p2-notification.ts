import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type SQLiteTableExtraConfigValue
} from 'drizzle-orm/sqlite-core'
import { now } from './columns'

/**
 * Expiring lock of one email send (replaces Plane's Redis `SET NX EX` in `acquire_lock`). The key holds the
 * issue, receiver and log ids, so a redelivered `notification.email.send` job cannot send the same email twice.
 */
export const notificationEmailLocks = sqliteTable(
  'notification_email_locks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    key: text('key', { length: 255 }).notNull(),
    expiresAt: integer('expires_at').notNull(),
    createdAt: now('created_at').notNull()
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('notification_email_locks_key_unique').on(table.key),
    index('notification_email_locks_expires_at_idx').on(table.expiresAt)
  ]
)
