import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, type AnySQLiteColumn, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { JsonValue } from '@/types/database/schema'
import { session, user } from './auth'
import { auditTimestamps, auditUsers, now, timestamp } from './columns'
import { fileAssets } from './content'
import { workspaces } from './workspace'

export const profiles = sqliteTable(
  'profiles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    theme: text('theme', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    isTourCompleted: integer('is_tour_completed', { mode: 'boolean' }).notNull().default(false),
    onboardingStep: text('onboarding_step', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    useCase: text('use_case'),
    role: text('role', { length: 300 }),
    isOnboarded: integer('is_onboarded', { mode: 'boolean' }).notNull().default(false),
    lastWorkspaceId: integer('last_workspace_id').references((): AnySQLiteColumn => workspaces.id, {
      onDelete: 'set null'
    }),
    billingAddressCountry: text('billing_address_country', { length: 255 }).notNull().default('INDIA'),
    billingAddress: text('billing_address', { mode: 'json' }).$type<JsonValue>(),
    hasBillingAddress: integer('has_billing_address', { mode: 'boolean' }).notNull().default(false),
    companyName: text('company_name', { length: 255 }).notNull().default(''),
    userId: integer('user_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    isMobileOnboarded: integer('is_mobile_onboarded', { mode: 'boolean' }).notNull().default(false),
    mobileOnboardingStep: text('mobile_onboarding_step', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    mobileTimezoneAutoSet: integer('mobile_timezone_auto_set', { mode: 'boolean' }).notNull().default(false),
    language: text('language', { length: 255 }).notNull().default('en'),
    isSmoothCursorEnabled: integer('is_smooth_cursor_enabled', { mode: 'boolean' }).notNull().default(false),
    startOfTheWeek: integer('start_of_the_week').notNull().default(0),
    isAppRailDocked: integer('is_app_rail_docked', { mode: 'boolean' }).notNull().default(true),
    backgroundColor: text('background_color', { length: 255 }).notNull().default('#64748b'),
    goals: text('goals', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    hasMarketingEmailConsent: integer('has_marketing_email_consent', { mode: 'boolean' }).notNull().default(false),
    isNavigationTourCompleted: integer('is_navigation_tour_completed', { mode: 'boolean' }).notNull().default(false),
    isSubscribedToChangelog: integer('is_subscribed_to_changelog', { mode: 'boolean' }).notNull().default(false),
    notificationViewMode: text('notification_view_mode', { length: 255, enum: ['full', 'compact'] })
      .notNull()
      .default('full'),
    productTour: text('product_tour', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    firstName: text('first_name', { length: 255 }),
    lastName: text('last_name', { length: 255 }),
    mobileNumber: text('mobile_number', { length: 255 }),
    userTimezone: text('user_timezone', { length: 255 }),
    coverImage: text('cover_image', { length: 800 }),
    avatarAssetId: integer('avatar_asset_id').references((): AnySQLiteColumn => fileAssets.id, {
      onDelete: 'set null'
    }),
    coverImageAssetId: integer('cover_image_asset_id').references((): AnySQLiteColumn => fileAssets.id, {
      onDelete: 'set null'
    })
  },
  table => [
    check('profiles_theme_json', sql`json_valid(${table.theme})`),
    check('profiles_onboarding_step_json', sql`json_valid(${table.onboardingStep})`),
    check('profiles_billing_address_json', sql`json_valid(${table.billingAddress}) or ${table.billingAddress} is null`),
    check('profiles_mobile_onboarding_step_json', sql`json_valid(${table.mobileOnboardingStep})`),
    check('profiles_start_of_the_week_values', sql`${table.startOfTheWeek} in (0, 1, 2, 3, 4, 5, 6)`),
    check('profiles_goals_json', sql`json_valid(${table.goals})`),
    check('profiles_notification_view_mode_values', sql`${table.notificationViewMode} in ('full', 'compact')`),
    check('profiles_product_tour_json', sql`json_valid(${table.productTour})`),
    check('profiles_start_of_the_week_check', sql`${table.startOfTheWeek} >= 0`),
    uniqueIndex('profiles_user_id_key').on(table.userId),
    index('profiles_avatar_asset_id_idx').on(table.avatarAssetId),
    index('profiles_cover_image_asset_id_idx').on(table.coverImageAssetId),
    index('profiles_last_workspace_id_idx').on(table.lastWorkspaceId)
  ]
)

export const devices = sqliteTable(
  'devices',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    deletedAt: timestamp('deleted_at'),
    deviceId: text('device_id', { length: 255 }),
    deviceType: text('device_type', { length: 255, enum: ['ANDROID', 'IOS', 'WEB', 'DESKTOP'] }).notNull(),
    pushToken: text('push_token', { length: 255 }),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    userId: integer('user_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' })
  },
  table => [
    check('devices_device_type_values', sql`${table.deviceType} in ('ANDROID', 'IOS', 'WEB', 'DESKTOP')`),
    index('devices_created_by_id_idx').on(table.createdById),
    index('devices_updated_by_id_idx').on(table.updatedById),
    index('devices_user_id_idx').on(table.userId)
  ]
)

export const deviceSessions = sqliteTable(
  'device_sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    deletedAt: timestamp('deleted_at'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    userAgent: text('user_agent', { length: 255 }),
    ipAddress: text('ip_address'),
    startTime: now('start_time').notNull(),
    endTime: timestamp('end_time'),
    deviceId: integer('device_id')
      .notNull()
      .references((): AnySQLiteColumn => devices.id, { onDelete: 'cascade' }),
    sessionId: integer('session_id')
      .notNull()
      .references((): AnySQLiteColumn => session.id, { onDelete: 'cascade' })
  },
  table => [
    index('device_sessions_created_by_id_idx').on(table.createdById),
    index('device_sessions_device_id_idx').on(table.deviceId),
    index('device_sessions_session_id_idx').on(table.sessionId),
    index('device_sessions_updated_by_id_idx').on(table.updatedById)
  ]
)

export const socialLoginConnections = sqliteTable(
  'social_login_connections',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    medium: text('medium', { length: 20, enum: ['Google', 'Github', 'GitLab', 'Jira'] }).notNull(),
    lastLoginAt: now('last_login_at'),
    lastReceivedAt: now('last_received_at'),
    tokenData: text('token_data', { mode: 'json' }).$type<JsonValue>(),
    extraData: text('extra_data', { mode: 'json' }).$type<JsonValue>(),
    userId: integer('user_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  table => [
    check('social_login_connections_medium_values', sql`${table.medium} in ('Google', 'Github', 'GitLab', 'Jira')`),
    check(
      'social_login_connections_token_data_json',
      sql`json_valid(${table.tokenData}) or ${table.tokenData} is null`
    ),
    check(
      'social_login_connections_extra_data_json',
      sql`json_valid(${table.extraData}) or ${table.extraData} is null`
    ),
    index('social_login_connections_created_by_id_idx').on(table.createdById),
    index('social_login_connections_updated_by_id_idx').on(table.updatedById),
    index('social_login_connections_user_id_idx').on(table.userId)
  ]
)
