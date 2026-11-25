import { sql } from 'drizzle-orm'
import {
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
import { auditTimestamps, auditUsers, timestamp } from './columns'
import { fileAssets } from './content'
import { states } from './issue'
import { estimates } from './planning'

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    name: text('name', { length: 80 }).notNull(),
    logo: text('logo'),
    slug: text('slug', { length: 48 }).notNull(),
    ownerId: integer('owner_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'restrict' }),
    organizationSize: text('organization_size', { length: 20 }),
    deletedAt: timestamp('deleted_at'),
    logoAssetId: integer('logo_asset_id').references((): AnySQLiteColumn => fileAssets.id, { onDelete: 'set null' }),
    timezone: text('timezone', { length: 255 }).notNull().default('UTC'),
    backgroundColor: text('background_color', { length: 255 }).notNull().default('#64748b')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('workspace_slug_key').on(table.slug),
    index('workspaces_created_by_id_idx').on(table.createdById),
    index('workspaces_owner_id_idx').on(table.ownerId),
    index('workspaces_updated_by_id_idx').on(table.updatedById),
    index('workspaces_logo_asset_id_idx').on(table.logoAssetId)
  ]
)

export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    role: integer('role').notNull().default(5),
    memberId: integer('member_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    companyRole: text('company_role'),
    viewProps: text('view_props', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    defaultProps: text('default_props', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    issueProps: text('issue_props', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    deletedAt: timestamp('deleted_at'),
    exploredFeatures: text('explored_features', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    gettingStartedChecklist: text('getting_started_checklist', { mode: 'json' })
      .$type<JsonValue>()
      .notNull()
      .default({}),
    tips: text('tips', { mode: 'json' }).$type<JsonValue>().notNull().default({})
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('workspace_members_role_values', sql`${table.role} in (20, 15, 5)`),
    check('workspace_members_view_props_json', sql`json_valid(${table.viewProps})`),
    check('workspace_members_default_props_json', sql`json_valid(${table.defaultProps})`),
    check('workspace_members_issue_props_json', sql`json_valid(${table.issueProps})`),
    check('workspace_members_explored_features_json', sql`json_valid(${table.exploredFeatures})`),
    check('workspace_members_getting_started_checklist_json', sql`json_valid(${table.gettingStartedChecklist})`),
    check('workspace_members_tips_json', sql`json_valid(${table.tips})`),
    check('workspace_member_role_check', sql`${table.role} >= 0`),
    uniqueIndex('workspace_members_workspace_id_member_id_deleted_at_unique').on(
      table.workspaceId,
      table.memberId,
      table.deletedAt
    ),
    index('workspace_members_created_by_id_idx').on(table.createdById),
    index('workspace_members_member_id_idx').on(table.memberId),
    uniqueIndex('workspace_member_unique_workspace_member_when_deleted_at_null')
      .on(table.workspaceId, table.memberId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('workspace_members_updated_by_id_idx').on(table.updatedById),
    index('workspace_members_workspace_id_idx').on(table.workspaceId)
  ]
)

export const workspaceMemberInvites = sqliteTable(
  'workspace_member_invites',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    email: text('email', { length: 255 }).notNull(),
    accepted: integer('accepted', { mode: 'boolean' }).notNull().default(false),
    token: text('token', { length: 255 }).notNull(),
    message: text('message'),
    respondedAt: timestamp('responded_at'),
    role: integer('role').notNull().default(5),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('workspace_member_invites_role_values', sql`${table.role} in (20, 15, 5)`),
    check('workspace_member_invite_role_check', sql`${table.role} >= 0`),
    uniqueIndex('workspace_member_invites_email_workspace_id_deleted_at_unique').on(
      table.email,
      table.workspaceId,
      table.deletedAt
    ),
    index('workspace_member_invites_created_by_id_idx').on(table.createdById),
    uniqueIndex('workspace_member_invite_unique_email_workspace_when_deleted_at_')
      .on(table.email, table.workspaceId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('workspace_member_invites_updated_by_id_idx').on(table.updatedById),
    index('workspace_member_invites_workspace_id_idx').on(table.workspaceId)
  ]
)

export const teams = sqliteTable(
  'teams',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    name: text('name', { length: 255 }).notNull(),
    description: text('description').notNull().default(''),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    logoProps: text('logo_props', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('teams_logo_props_json', sql`json_valid(${table.logoProps})`),
    uniqueIndex('teams_name_workspace_id_deleted_at_unique').on(table.name, table.workspaceId, table.deletedAt),
    index('teams_created_by_id_idx').on(table.createdById),
    uniqueIndex('team_unique_name_workspace_when_deleted_at_null')
      .on(table.name, table.workspaceId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('teams_updated_by_id_idx').on(table.updatedById),
    index('teams_workspace_id_idx').on(table.workspaceId)
  ]
)

export const workspaceThemes = sqliteTable(
  'workspace_themes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    name: text('name', { length: 300 }).notNull(),
    colors: text('colors', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    actorId: integer('actor_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('workspace_themes_colors_json', sql`json_valid(${table.colors})`),
    uniqueIndex('workspace_themes_workspace_id_name_deleted_at_unique').on(
      table.workspaceId,
      table.name,
      table.deletedAt
    ),
    uniqueIndex('workspace_theme_unique_workspace_name_when_deleted_at_null')
      .on(table.workspaceId, table.name)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('workspace_themes_actor_id_idx').on(table.actorId),
    index('workspace_themes_created_by_id_idx').on(table.createdById),
    index('workspace_themes_updated_by_id_idx').on(table.updatedById),
    index('workspace_themes_workspace_id_idx').on(table.workspaceId)
  ]
)

export const workspaceUserProperties = sqliteTable(
  'workspace_user_properties',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    filters: text('filters', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    displayFilters: text('display_filters', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    displayProperties: text('display_properties', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    userId: integer('user_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at'),
    richFilters: text('rich_filters', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    navigationControlPreference: text('navigation_control_preference', { length: 25, enum: ['ACCORDION', 'TABBED'] })
      .notNull()
      .default('ACCORDION'),
    navigationProjectLimit: integer('navigation_project_limit').notNull().default(10)
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('workspace_user_properties_filters_json', sql`json_valid(${table.filters})`),
    check('workspace_user_properties_display_filters_json', sql`json_valid(${table.displayFilters})`),
    check('workspace_user_properties_display_properties_json', sql`json_valid(${table.displayProperties})`),
    check('workspace_user_properties_rich_filters_json', sql`json_valid(${table.richFilters})`),
    check(
      'workspace_user_properties_navigation_control_preference_values',
      sql`${table.navigationControlPreference} in ('ACCORDION', 'TABBED')`
    ),
    uniqueIndex('workspace_user_properties_workspace_id_user_id_deleted_at_unique').on(
      table.workspaceId,
      table.userId,
      table.deletedAt
    ),
    index('workspace_user_properties_created_by_id_idx').on(table.createdById),
    uniqueIndex('workspace_user_properties_unique_workspace_user_when_deleted_at')
      .on(table.workspaceId, table.userId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('workspace_user_properties_updated_by_id_idx').on(table.updatedById),
    index('workspace_user_properties_user_id_idx').on(table.userId),
    index('workspace_user_properties_workspace_id_idx').on(table.workspaceId)
  ]
)

export const workspaceUserLinks = sqliteTable(
  'workspace_user_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    deletedAt: timestamp('deleted_at'),
    title: text('title', { length: 255 }),
    url: text('url').notNull(),
    metadata: text('metadata', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    ownerId: integer('owner_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' })
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('workspace_user_links_metadata_json', sql`json_valid(${table.metadata})`),
    foreignKey({
      name: 'workspace_user_links_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('workspace_user_links_created_by_id_idx').on(table.createdById),
    index('workspace_user_links_owner_id_idx').on(table.ownerId),
    index('workspace_user_links_project_id_idx').on(table.projectId),
    index('workspace_user_links_updated_by_id_idx').on(table.updatedById),
    index('workspace_user_links_workspace_id_idx').on(table.workspaceId)
  ]
)

export const workspaceHomePreferences = sqliteTable(
  'workspace_home_preferences',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    deletedAt: timestamp('deleted_at'),
    key: text('key', { length: 255 }).notNull(),
    isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
    config: text('config', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    userId: integer('user_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    sortOrder: real('sort_order').notNull().default(65535)
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('workspace_home_preferences_config_json', sql`json_valid(${table.config})`),
    uniqueIndex('workspace_home_preferences_workspace_id_user_id_key_deleted_at_unique').on(
      table.workspaceId,
      table.userId,
      table.key,
      table.deletedAt
    ),
    index('workspace_home_preferences_created_by_id_idx').on(table.createdById),
    index('workspace_home_preferences_updated_by_id_idx').on(table.updatedById),
    index('workspace_home_preferences_user_id_idx').on(table.userId),
    index('workspace_home_preferences_workspace_id_idx').on(table.workspaceId),
    uniqueIndex('workspace_user_home_preferences_unique_workspace_user_key_when_')
      .on(table.workspaceId, table.userId, table.key)
      .where(sql`(${table.deletedAt} IS NULL)`)
  ]
)

export const workspaceUserPreferences = sqliteTable(
  'workspace_user_preferences',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    deletedAt: timestamp('deleted_at'),
    key: text('key', { length: 255 }).notNull(),
    isPinned: integer('is_pinned', { mode: 'boolean' }).notNull().default(false),
    sortOrder: real('sort_order').notNull().default(65535),
    userId: integer('user_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' })
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('workspace_user_preferences_workspace_id_user_id_key_deleted_at_unique').on(
      table.workspaceId,
      table.userId,
      table.key,
      table.deletedAt
    ),
    index('workspace_user_preferences_created_by_id_idx').on(table.createdById),
    uniqueIndex('workspace_user_preferences_unique_workspace_user_key_when_delet')
      .on(table.workspaceId, table.userId, table.key)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('workspace_user_preferences_updated_by_id_idx').on(table.updatedById),
    index('workspace_user_preferences_user_id_idx').on(table.userId),
    index('workspace_user_preferences_workspace_id_idx').on(table.workspaceId)
  ]
)

export const projects = sqliteTable(
  'projects',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    name: text('name', { length: 255 }).notNull(),
    description: text('description').notNull().default(''),
    descriptionHtml: text('description_html', { mode: 'json' }).$type<JsonValue>(),
    network: integer('network').notNull().default(2),
    identifier: text('identifier', { length: 12 }).notNull(),
    defaultAssigneeId: integer('default_assignee_id').references((): AnySQLiteColumn => user.id, {
      onDelete: 'set null'
    }),
    projectLeadId: integer('project_lead_id').references((): AnySQLiteColumn => user.id, { onDelete: 'set null' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    descriptionText: text('description_text', { mode: 'json' }).$type<JsonValue>(),
    cycleView: integer('cycle_view', { mode: 'boolean' }).notNull().default(false),
    moduleView: integer('module_view', { mode: 'boolean' }).notNull().default(false),
    coverImage: text('cover_image'),
    issueViewsView: integer('issue_views_view', { mode: 'boolean' }).notNull().default(false),
    pageView: integer('page_view', { mode: 'boolean' }).notNull().default(true),
    estimateId: integer('estimate_id').references((): AnySQLiteColumn => estimates.id, { onDelete: 'set null' }),
    emoji: text('emoji', { length: 255 }),
    iconProp: text('icon_prop', { mode: 'json' }).$type<JsonValue>(),
    archiveIn: integer('archive_in').notNull().default(0),
    closeIn: integer('close_in').notNull().default(0),
    defaultStateId: integer('default_state_id').references((): AnySQLiteColumn => states.id, { onDelete: 'set null' }),
    logoProps: text('logo_props', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    archivedAt: timestamp('archived_at'),
    isTimeTrackingEnabled: integer('is_time_tracking_enabled', { mode: 'boolean' }).notNull().default(false),
    isIssueTypeEnabled: integer('is_issue_type_enabled', { mode: 'boolean' }).notNull().default(false),
    deletedAt: timestamp('deleted_at'),
    guestViewAllFeatures: integer('guest_view_all_features', { mode: 'boolean' }).notNull().default(false),
    timezone: text('timezone', { length: 255 }).notNull().default('UTC'),
    coverImageAssetId: integer('cover_image_asset_id').references((): AnySQLiteColumn => fileAssets.id, {
      onDelete: 'set null'
    }),
    intakeView: integer('intake_view', { mode: 'boolean' }).notNull().default(false),
    externalId: text('external_id', { length: 255 }),
    externalSource: text('external_source', { length: 255 })
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check(
      'projects_description_html_json',
      sql`json_valid(${table.descriptionHtml}) or ${table.descriptionHtml} is null`
    ),
    check('projects_network_values', sql`${table.network} in (0, 2)`),
    check(
      'projects_description_text_json',
      sql`json_valid(${table.descriptionText}) or ${table.descriptionText} is null`
    ),
    check('projects_icon_prop_json', sql`json_valid(${table.iconProp}) or ${table.iconProp} is null`),
    check('projects_logo_props_json', sql`json_valid(${table.logoProps})`),
    check('project_network_check', sql`${table.network} >= 0`),
    uniqueIndex('projects_identifier_workspace_id_deleted_at_unique').on(
      table.identifier,
      table.workspaceId,
      table.deletedAt
    ),
    uniqueIndex('projects_name_workspace_id_deleted_at_unique').on(table.name, table.workspaceId, table.deletedAt),
    uniqueIndex('projects_id_workspace_id_unique').on(table.id, table.workspaceId),
    foreignKey({
      name: 'projects_estimate_id_id_fk',
      columns: [table.estimateId, table.id],
      foreignColumns: [estimates.id, estimates.projectId]
    }),
    foreignKey({
      name: 'projects_default_state_id_id_fk',
      columns: [table.defaultStateId, table.id],
      foreignColumns: [states.id, states.projectId]
    }),
    index('projects_created_by_id_idx').on(table.createdById),
    index('projects_default_assignee_id_idx').on(table.defaultAssigneeId),
    index('projects_project_lead_id_idx').on(table.projectLeadId),
    uniqueIndex('project_unique_identifier_workspace_when_deleted_at_null')
      .on(table.identifier, table.workspaceId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    uniqueIndex('project_unique_name_workspace_when_deleted_at_null')
      .on(table.name, table.workspaceId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('projects_updated_by_id_idx').on(table.updatedById),
    index('projects_workspace_id_idx').on(table.workspaceId),
    index('projects_cover_image_asset_id_idx').on(table.coverImageAssetId),
    index('projects_default_state_id_idx').on(table.defaultStateId),
    index('projects_estimate_id_idx').on(table.estimateId),
    index('projects_identifier_idx').on(table.identifier)
  ]
)

export const projectIdentifiers = sqliteTable(
  'project_identifiers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    name: text('name', { length: 12 }).notNull(),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id').references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('project_identifier_project_id_key').on(table.projectId),
    uniqueIndex('project_identifiers_name_workspace_id_deleted_at_unique').on(
      table.name,
      table.workspaceId,
      table.deletedAt
    ),
    foreignKey({
      name: 'project_identifiers_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('project_identifiers_created_by_id_idx').on(table.createdById),
    index('project_identifiers_updated_by_id_idx').on(table.updatedById),
    index('project_identifiers_workspace_id_idx').on(table.workspaceId),
    index('project_identifiers_name_idx').on(table.name),
    uniqueIndex('unique_name_workspace_when_deleted_at_null')
      .on(table.name, table.workspaceId)
      .where(sql`(${table.deletedAt} IS NULL)`)
  ]
)

export const projectMembers = sqliteTable(
  'project_members',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    comment: text('comment'),
    role: integer('role').notNull().default(5),
    memberId: integer('member_id').references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    viewProps: text('view_props', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    defaultProps: text('default_props', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    sortOrder: real('sort_order').notNull().default(65535),
    preferences: text('preferences', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('project_members_role_values', sql`${table.role} in (20, 15, 5)`),
    check('project_members_view_props_json', sql`json_valid(${table.viewProps})`),
    check('project_members_default_props_json', sql`json_valid(${table.defaultProps})`),
    check('project_members_preferences_json', sql`json_valid(${table.preferences})`),
    check('project_member_role_check', sql`${table.role} >= 0`),
    uniqueIndex('project_members_project_id_member_id_deleted_at_unique').on(
      table.projectId,
      table.memberId,
      table.deletedAt
    ),
    foreignKey({
      name: 'project_members_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('project_members_created_by_id_idx').on(table.createdById),
    index('project_members_member_id_idx').on(table.memberId),
    index('project_members_project_id_idx').on(table.projectId),
    uniqueIndex('project_member_unique_project_member_when_deleted_at_null')
      .on(table.projectId, table.memberId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('project_members_updated_by_id_idx').on(table.updatedById),
    index('project_members_workspace_id_idx').on(table.workspaceId)
  ]
)

export const projectMemberInvites = sqliteTable(
  'project_member_invites',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    email: text('email', { length: 255 }).notNull(),
    accepted: integer('accepted', { mode: 'boolean' }).notNull().default(false),
    token: text('token', { length: 255 }).notNull(),
    message: text('message'),
    respondedAt: timestamp('responded_at'),
    role: integer('role').notNull().default(5),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('project_member_invites_role_values', sql`${table.role} in (20, 15, 5)`),
    check('project_member_invite_role_check', sql`${table.role} >= 0`),
    foreignKey({
      name: 'project_member_invites_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('project_member_invites_created_by_id_idx').on(table.createdById),
    index('project_member_invites_project_id_idx').on(table.projectId),
    index('project_member_invites_updated_by_id_idx').on(table.updatedById),
    index('project_member_invites_workspace_id_idx').on(table.workspaceId)
  ]
)

export const projectUserProperties = sqliteTable(
  'project_user_properties',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    displayProperties: text('display_properties', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    displayFilters: text('display_filters', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    filters: text('filters', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    deletedAt: timestamp('deleted_at'),
    richFilters: text('rich_filters', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    preferences: text('preferences', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    sortOrder: real('sort_order').notNull().default(65535)
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('project_user_properties_display_properties_json', sql`json_valid(${table.displayProperties})`),
    check('project_user_properties_display_filters_json', sql`json_valid(${table.displayFilters})`),
    check('project_user_properties_filters_json', sql`json_valid(${table.filters})`),
    check('project_user_properties_rich_filters_json', sql`json_valid(${table.richFilters})`),
    check('project_user_properties_preferences_json', sql`json_valid(${table.preferences})`),
    uniqueIndex('project_user_properties_user_id_project_id_deleted_at_unique').on(
      table.userId,
      table.projectId,
      table.deletedAt
    ),
    foreignKey({
      name: 'project_user_properties_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('project_user_properties_created_by_id_idx').on(table.createdById),
    index('project_user_properties_project_id_idx').on(table.projectId),
    index('project_user_properties_updated_by_id_idx').on(table.updatedById),
    index('project_user_properties_user_id_idx').on(table.userId),
    index('project_user_properties_workspace_id_idx').on(table.workspaceId),
    uniqueIndex('project_user_property_unique_user_project_when_deleted_at_null')
      .on(table.userId, table.projectId)
      .where(sql`(${table.deletedAt} IS NULL)`)
  ]
)
