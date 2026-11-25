import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, type AnySQLiteColumn, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { JsonValue } from '@/types/database/schema'
import { user } from './auth'
import { auditTimestamps, auditUsers, timestamp } from './columns'

export const instances = sqliteTable(
  'instances',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    instanceName: text('instance_name', { length: 255 }).notNull(),
    whitelistEmails: text('whitelist_emails'),
    instanceId: text('instance_id', { length: 255 }).notNull(),
    lastCheckedAt: timestamp('last_checked_at').notNull(),
    namespace: text('namespace', { length: 255 }),
    isTelemetryEnabled: integer('is_telemetry_enabled', { mode: 'boolean' }).notNull().default(true),
    isSupportRequired: integer('is_support_required', { mode: 'boolean' }).notNull().default(true),
    isSetupDone: integer('is_setup_done', { mode: 'boolean' }).notNull().default(false),
    isSignupScreenVisited: integer('is_signup_screen_visited', { mode: 'boolean' }).notNull().default(false),
    isVerified: integer('is_verified', { mode: 'boolean' }).notNull().default(false),
    currentVersion: text('current_version', { length: 255 }).notNull(),
    domain: text('domain').notNull().default(''),
    latestVersion: text('latest_version', { length: 255 }),
    deletedAt: timestamp('deleted_at'),
    edition: text('edition', { length: 255 }).notNull().default('PLANE_COMMUNITY'),
    isTest: integer('is_test', { mode: 'boolean' }).notNull().default(false),
    isCurrentVersionDeprecated: integer('is_current_version_deprecated', { mode: 'boolean' }).notNull().default(false)
  },
  table => [
    uniqueIndex('instances_instance_id_key').on(table.instanceId),
    index('instances_created_by_id_idx').on(table.createdById),
    index('instances_updated_by_id_idx').on(table.updatedById)
  ]
)

export const instanceAdmins = sqliteTable(
  'instance_admins',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    role: integer('role').notNull().default(20),
    isVerified: integer('is_verified', { mode: 'boolean' }).notNull().default(false),
    instanceId: integer('instance_id')
      .notNull()
      .references((): AnySQLiteColumn => instances.id, { onDelete: 'cascade' }),
    userId: integer('user_id').references((): AnySQLiteColumn => user.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at')
  },
  table => [
    check('instance_admins_role_values', sql`${table.role} in (20)`),
    check('instance_admins_role_check', sql`${table.role} >= 0`),
    uniqueIndex('instance_admins_instance_id_user_id_unique').on(table.instanceId, table.userId),
    index('instance_admins_created_by_id_idx').on(table.createdById),
    index('instance_admins_instance_id_idx').on(table.instanceId),
    index('instance_admins_updated_by_id_idx').on(table.updatedById),
    index('instance_admins_user_id_idx').on(table.userId)
  ]
)

export const instanceConfigurations = sqliteTable(
  'instance_configurations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    key: text('key', { length: 100 }).notNull(),
    value: text('value'),
    category: text('category').notNull(),
    isEncrypted: integer('is_encrypted', { mode: 'boolean' }).notNull().default(false),
    deletedAt: timestamp('deleted_at')
  },
  table => [
    uniqueIndex('instance_configurations_key_key').on(table.key),
    index('instance_configurations_created_by_id_idx').on(table.createdById),
    index('instance_configurations_updated_by_id_idx').on(table.updatedById)
  ]
)

export const changelogs = sqliteTable(
  'changelogs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    title: text('title', { length: 255 }).notNull(),
    description: text('description').notNull().default(''),
    version: text('version', { length: 255 }).notNull(),
    tags: text('tags', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    releaseDate: timestamp('release_date'),
    isReleaseCandidate: integer('is_release_candidate', { mode: 'boolean' }).notNull().default(false),
    deletedAt: timestamp('deleted_at')
  },
  table => [
    check('changelogs_tags_json', sql`json_valid(${table.tags})`),
    index('changelogs_created_by_id_idx').on(table.createdById),
    index('changelogs_updated_by_id_idx').on(table.updatedById)
  ]
)
