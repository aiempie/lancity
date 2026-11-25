import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { user } from './auth'
import { auditTimestamps, timestamp } from './columns'

/** Plane `User` columns that Better Auth's `user` table does not carry (is_active, is_password_autoset, login audit). */
export const userSecurity = sqliteTable(
  'user_security',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    userId: integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    isBot: integer('is_bot', { mode: 'boolean' }).notNull().default(false),
    isPasswordAutoset: integer('is_password_autoset', { mode: 'boolean' }).notNull().default(false),
    lastLoginMedium: text('last_login_medium', { length: 20 }),
    lastLoginTime: timestamp('last_login_time'),
    lastLoginIp: text('last_login_ip'),
    lastLoginUagent: text('last_login_uagent'),
    lastLogoutTime: timestamp('last_logout_time'),
    lastLogoutIp: text('last_logout_ip'),
    lastActive: timestamp('last_active')
  },
  table => [uniqueIndex('user_security_user_id_key').on(table.userId)]
)

/** Fixed-window counters replacing Plane's Redis INCR/EXPIRE keys (issued codes, throttles, email-change budget). */
export const authCounters = sqliteTable(
  'auth_counters',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    key: text('key', { length: 255 }).notNull(),
    count: integer('count').notNull().default(0),
    expiresAt: timestamp('expires_at').notNull()
  },
  table => [uniqueIndex('auth_counters_key_key').on(table.key), index('auth_counters_expires_at_idx').on(table.expiresAt)]
)
