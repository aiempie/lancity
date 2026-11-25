import { sql } from 'drizzle-orm'
import {
  blob,
  check,
  foreignKey,
  index,
  integer,
  real,
  sqliteTable,
  text,
  type AnySQLiteColumn,
  type SQLiteTableExtraConfigValue,
  uniqueIndex
} from 'drizzle-orm/sqlite-core'
import type { JsonValue } from '@/types/database/schema'
import { user } from './auth'
import { auditTimestamps, auditUsers, now, timestamp } from './columns'
import { projects, workspaces } from './workspace'

export const issueViews = sqliteTable(
  'issue_views',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    name: text('name', { length: 255 }).notNull(),
    description: text('description').notNull().default(''),
    query: text('query', { mode: 'json' }).$type<JsonValue>().notNull(),
    access: integer('access').notNull().default(1),
    projectId: integer('project_id').references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    filters: text('filters', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    displayFilters: text('display_filters', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    displayProperties: text('display_properties', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    sortOrder: real('sort_order').notNull().default(65535),
    logoProps: text('logo_props', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    isLocked: integer('is_locked', { mode: 'boolean' }).notNull().default(false),
    ownedById: integer('owned_by_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at'),
    richFilters: text('rich_filters', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    archivedAt: timestamp('archived_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('issue_views_query_json', sql`json_valid(${table.query})`),
    check('issue_views_access_values', sql`${table.access} in (0, 1)`),
    check('issue_views_filters_json', sql`json_valid(${table.filters})`),
    check('issue_views_display_filters_json', sql`json_valid(${table.displayFilters})`),
    check('issue_views_display_properties_json', sql`json_valid(${table.displayProperties})`),
    check('issue_views_logo_props_json', sql`json_valid(${table.logoProps})`),
    check('issue_views_rich_filters_json', sql`json_valid(${table.richFilters})`),
    check('issue_views_access_check', sql`${table.access} >= 0`),
    foreignKey({
      name: 'issue_views_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('issue_views_created_by_id_idx').on(table.createdById),
    index('issue_views_owned_by_id_idx').on(table.ownedById),
    index('issue_views_project_id_idx').on(table.projectId),
    index('issue_views_updated_by_id_idx').on(table.updatedById),
    index('issue_views_workspace_id_idx').on(table.workspaceId)
  ]
)

export const analyticViews = sqliteTable(
  'analytic_views',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    name: text('name', { length: 255 }).notNull(),
    description: text('description').notNull().default(''),
    query: text('query', { mode: 'json' }).$type<JsonValue>().notNull(),
    queryDict: text('query_dict', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('analytic_views_query_json', sql`json_valid(${table.query})`),
    check('analytic_views_query_dict_json', sql`json_valid(${table.queryDict})`),
    index('analytic_views_created_by_id_idx').on(table.createdById),
    index('analytic_views_updated_by_id_idx').on(table.updatedById),
    index('analytic_views_workspace_id_idx').on(table.workspaceId)
  ]
)

export const userFavorites = sqliteTable(
  'user_favorites',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    entityType: text('entity_type', { length: 100 }).notNull(),
    entityIdentifier: integer('entity_identifier'),
    name: text('name', { length: 255 }),
    isFolder: integer('is_folder', { mode: 'boolean' }).notNull().default(false),
    sequence: real('sequence').notNull().default(65535),
    parentId: integer('parent_id').references((): AnySQLiteColumn => userFavorites.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('user_favorites_entity_type_user_id_entity_identifier_deleted_at_unique').on(
      table.entityType,
      table.userId,
      table.entityIdentifier,
      table.deletedAt
    ),
    uniqueIndex('user_favorites_id_workspace_id_unique').on(table.id, table.workspaceId),
    foreignKey({
      name: 'user_favorites_parent_id_workspace_id_fk',
      columns: [table.parentId, table.workspaceId],
      foreignColumns: [userFavorites.id, userFavorites.workspaceId]
    }),
    foreignKey({
      name: 'user_favorites_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('fav_entity_identifier_idx').on(table.entityIdentifier),
    index('fav_entity_idx').on(table.entityType, table.entityIdentifier),
    index('fav_entity_type_idx').on(table.entityType),
    uniqueIndex('user_favorite_unique_entity_type_entity_identifier_user_when_de')
      .on(table.entityType, table.entityIdentifier, table.userId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('user_favorites_created_by_id_idx').on(table.createdById),
    index('user_favorites_parent_id_idx').on(table.parentId),
    index('user_favorites_project_id_idx').on(table.projectId),
    index('user_favorites_updated_by_id_idx').on(table.updatedById),
    index('user_favorites_user_id_idx').on(table.userId),
    index('user_favorites_workspace_id_idx').on(table.workspaceId)
  ]
)

export const userRecentVisits = sqliteTable(
  'user_recent_visits',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    entityIdentifier: integer('entity_identifier'),
    entityName: text('entity_name', { length: 30 }).notNull(),
    visitedAt: now('visited_at').notNull(),
    projectId: integer('project_id').references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    foreignKey({
      name: 'user_recent_visits_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('user_recent_visits_created_by_id_idx').on(table.createdById),
    index('user_recent_visits_project_id_idx').on(table.projectId),
    index('user_recent_visits_updated_by_id_idx').on(table.updatedById),
    index('user_recent_visits_user_id_idx').on(table.userId),
    index('user_recent_visits_workspace_id_idx').on(table.workspaceId)
  ]
)

export const stickies = sqliteTable(
  'stickies',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    deletedAt: timestamp('deleted_at'),
    name: text('name'),
    description: text('description', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    descriptionHtml: text('description_html').notNull().default('<p></p>'),
    descriptionStripped: text('description_stripped'),
    descriptionBinary: blob('description_binary', { mode: 'buffer' }),
    logoProps: text('logo_props', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    color: text('color', { length: 255 }),
    backgroundColor: text('background_color', { length: 255 }),
    ownerId: integer('owner_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    sortOrder: real('sort_order').notNull().default(65535)
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('stickies_description_json', sql`json_valid(${table.description})`),
    check('stickies_logo_props_json', sql`json_valid(${table.logoProps})`),
    index('stickies_created_by_id_idx').on(table.createdById),
    index('stickies_owner_id_idx').on(table.ownerId),
    index('stickies_updated_by_id_idx').on(table.updatedById),
    index('stickies_workspace_id_idx').on(table.workspaceId)
  ]
)

export const notifications = sqliteTable(
  'notifications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    data: text('data', { mode: 'json' }).$type<JsonValue>(),
    entityIdentifier: integer('entity_identifier'),
    entityName: text('entity_name', { length: 255 }).notNull(),
    title: text('title').notNull(),
    message: text('message', { mode: 'json' }).$type<JsonValue>(),
    messageHtml: text('message_html').notNull().default('<p></p>'),
    messageStripped: text('message_stripped'),
    sender: text('sender', { length: 255 }).notNull(),
    readAt: timestamp('read_at'),
    snoozedTill: timestamp('snoozed_till'),
    archivedAt: timestamp('archived_at'),
    projectId: integer('project_id').references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    receiverId: integer('receiver_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    triggeredById: integer('triggered_by_id').references((): AnySQLiteColumn => user.id, { onDelete: 'set null' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('notifications_data_json', sql`json_valid(${table.data}) or ${table.data} is null`),
    check('notifications_message_json', sql`json_valid(${table.message}) or ${table.message} is null`),
    foreignKey({
      name: 'notifications_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('notif_entity_identifier_idx').on(table.entityIdentifier),
    index('notif_entity_idx').on(table.receiverId, table.readAt),
    index('notif_entity_lookup_idx').on(table.workspaceId, table.entityIdentifier, table.entityName),
    index('notif_entity_name_idx').on(table.entityName),
    index('notif_read_at_idx').on(table.readAt),
    index('notif_receiver_entity_idx').on(table.receiverId, table.workspaceId, table.entityName, table.readAt),
    index('notif_receiver_sender_idx').on(table.receiverId, table.workspaceId, table.sender),
    index('notif_receiver_state_idx').on(table.receiverId, table.workspaceId, table.snoozedTill, table.archivedAt),
    index('notif_receiver_status_idx').on(table.receiverId, table.workspaceId, table.readAt, table.createdAt),
    index('notifications_created_by_id_idx').on(table.createdById),
    index('notifications_project_id_idx').on(table.projectId),
    index('notifications_receiver_id_idx').on(table.receiverId),
    index('notifications_triggered_by_id_idx').on(table.triggeredById),
    index('notifications_updated_by_id_idx').on(table.updatedById),
    index('notifications_workspace_id_idx').on(table.workspaceId)
  ]
)

export const userNotificationPreferences = sqliteTable(
  'user_notification_preferences',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    propertyChange: integer('property_change', { mode: 'boolean' }).notNull().default(true),
    stateChange: integer('state_change', { mode: 'boolean' }).notNull().default(true),
    comment: integer('comment', { mode: 'boolean' }).notNull().default(true),
    mention: integer('mention', { mode: 'boolean' }).notNull().default(true),
    issueCompleted: integer('issue_completed', { mode: 'boolean' }).notNull().default(true),
    projectId: integer('project_id').references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id').references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    foreignKey({
      name: 'user_notification_preferences_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('user_notification_preferences_created_by_id_idx').on(table.createdById),
    index('user_notification_preferences_project_id_idx').on(table.projectId),
    index('user_notification_preferences_updated_by_id_idx').on(table.updatedById),
    index('user_notification_preferences_user_id_idx').on(table.userId),
    index('user_notification_preferences_workspace_id_idx').on(table.workspaceId)
  ]
)

export const emailNotificationLogs = sqliteTable(
  'email_notification_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    entityIdentifier: integer('entity_identifier'),
    entityName: text('entity_name', { length: 255 }).notNull(),
    data: text('data', { mode: 'json' }).$type<JsonValue>(),
    processedAt: timestamp('processed_at'),
    sentAt: timestamp('sent_at'),
    entity: text('entity', { length: 200 }).notNull(),
    oldValue: text('old_value', { length: 300 }),
    newValue: text('new_value', { length: 300 }),
    receiverId: integer('receiver_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    triggeredById: integer('triggered_by_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('email_notification_logs_data_json', sql`json_valid(${table.data}) or ${table.data} is null`),
    index('email_notification_logs_created_by_id_idx').on(table.createdById),
    index('email_notification_logs_receiver_id_idx').on(table.receiverId),
    index('email_notification_logs_triggered_by_id_idx').on(table.triggeredById),
    index('email_notification_logs_updated_by_id_idx').on(table.updatedById)
  ]
)
