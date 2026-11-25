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
import { auditTimestamps, auditUsers, timestamp } from './columns'
import { issues, labels, states } from './issue'
import { projects, workspaces } from './workspace'

export const cycles = sqliteTable(
  'cycles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    name: text('name', { length: 255 }).notNull(),
    description: text('description').notNull().default(''),
    startDate: timestamp('start_date'),
    endDate: timestamp('end_date'),
    ownedById: integer('owned_by_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    viewProps: text('view_props', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    sortOrder: real('sort_order').notNull().default(65535),
    externalId: text('external_id', { length: 255 }),
    externalSource: text('external_source', { length: 255 }),
    progressSnapshot: text('progress_snapshot', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    archivedAt: timestamp('archived_at'),
    logoProps: text('logo_props', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    deletedAt: timestamp('deleted_at'),
    timezone: text('timezone', { length: 255 }).notNull().default('UTC'),
    version: integer('version').notNull().default(1)
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('cycles_view_props_json', sql`json_valid(${table.viewProps})`),
    check('cycles_progress_snapshot_json', sql`json_valid(${table.progressSnapshot})`),
    check('cycles_logo_props_json', sql`json_valid(${table.logoProps})`),
    uniqueIndex('cycles_id_project_id_unique').on(table.id, table.projectId),
    foreignKey({
      name: 'cycles_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('cycles_created_by_id_idx').on(table.createdById),
    index('cycles_owned_by_id_idx').on(table.ownedById),
    index('cycles_project_id_idx').on(table.projectId),
    index('cycles_updated_by_id_idx').on(table.updatedById),
    index('cycles_workspace_id_idx').on(table.workspaceId)
  ]
)

export const cycleIssues = sqliteTable(
  'cycle_issues',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    cycleId: integer('cycle_id')
      .notNull()
      .references((): AnySQLiteColumn => cycles.id, { onDelete: 'cascade' }),
    issueId: integer('issue_id')
      .notNull()
      .references((): AnySQLiteColumn => issues.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('cycle_issues_issue_id_cycle_id_deleted_at_unique').on(table.issueId, table.cycleId, table.deletedAt),
    foreignKey({
      name: 'cycle_issues_cycle_id_project_id_fk',
      columns: [table.cycleId, table.projectId],
      foreignColumns: [cycles.id, cycles.projectId]
    }),
    foreignKey({
      name: 'cycle_issues_issue_id_project_id_fk',
      columns: [table.issueId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'cycle_issues_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('cycle_issues_created_by_id_idx').on(table.createdById),
    index('cycle_issues_cycle_id_idx').on(table.cycleId),
    index('cycle_issues_project_id_idx').on(table.projectId),
    index('cycle_issues_updated_by_id_idx').on(table.updatedById),
    uniqueIndex('cycle_issue_when_deleted_at_null')
      .on(table.cycleId, table.issueId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('cycle_issues_workspace_id_idx').on(table.workspaceId),
    index('cycle_issues_issue_id_idx').on(table.issueId)
  ]
)

export const cycleUserProperties = sqliteTable(
  'cycle_user_properties',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    filters: text('filters', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    displayFilters: text('display_filters', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    displayProperties: text('display_properties', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    cycleId: integer('cycle_id')
      .notNull()
      .references((): AnySQLiteColumn => cycles.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at'),
    richFilters: text('rich_filters', { mode: 'json' }).$type<JsonValue>().notNull().default({})
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('cycle_user_properties_filters_json', sql`json_valid(${table.filters})`),
    check('cycle_user_properties_display_filters_json', sql`json_valid(${table.displayFilters})`),
    check('cycle_user_properties_display_properties_json', sql`json_valid(${table.displayProperties})`),
    check('cycle_user_properties_rich_filters_json', sql`json_valid(${table.richFilters})`),
    uniqueIndex('cycle_user_properties_cycle_id_user_id_deleted_at_unique').on(
      table.cycleId,
      table.userId,
      table.deletedAt
    ),
    foreignKey({
      name: 'cycle_user_properties_cycle_id_project_id_fk',
      columns: [table.cycleId, table.projectId],
      foreignColumns: [cycles.id, cycles.projectId]
    }),
    foreignKey({
      name: 'cycle_user_properties_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('cycle_user_properties_created_by_id_idx').on(table.createdById),
    index('cycle_user_properties_cycle_id_idx').on(table.cycleId),
    index('cycle_user_properties_project_id_idx').on(table.projectId),
    uniqueIndex('cycle_user_properties_unique_cycle_user_when_deleted_at_null')
      .on(table.cycleId, table.userId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('cycle_user_properties_updated_by_id_idx').on(table.updatedById),
    index('cycle_user_properties_user_id_idx').on(table.userId),
    index('cycle_user_properties_workspace_id_idx').on(table.workspaceId)
  ]
)

export const modules = sqliteTable(
  'modules',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    name: text('name', { length: 255 }).notNull(),
    description: text('description').notNull().default(''),
    descriptionText: text('description_text', { mode: 'json' }).$type<JsonValue>(),
    descriptionHtml: text('description_html', { mode: 'json' }).$type<JsonValue>(),
    startDate: text('start_date'),
    targetDate: text('target_date'),
    status: text('status', {
      length: 20,
      enum: ['backlog', 'planned', 'in-progress', 'paused', 'completed', 'cancelled']
    })
      .notNull()
      .default('planned'),
    leadId: integer('lead_id').references((): AnySQLiteColumn => user.id, { onDelete: 'set null' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    viewProps: text('view_props', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    sortOrder: real('sort_order').notNull().default(65535),
    externalId: text('external_id', { length: 255 }),
    externalSource: text('external_source', { length: 255 }),
    archivedAt: timestamp('archived_at'),
    logoProps: text('logo_props', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check(
      'modules_description_text_json',
      sql`json_valid(${table.descriptionText}) or ${table.descriptionText} is null`
    ),
    check(
      'modules_description_html_json',
      sql`json_valid(${table.descriptionHtml}) or ${table.descriptionHtml} is null`
    ),
    check(
      'modules_status_values',
      sql`${table.status} in ('backlog', 'planned', 'in-progress', 'paused', 'completed', 'cancelled')`
    ),
    check('modules_view_props_json', sql`json_valid(${table.viewProps})`),
    check('modules_logo_props_json', sql`json_valid(${table.logoProps})`),
    uniqueIndex('modules_name_project_id_deleted_at_unique').on(table.name, table.projectId, table.deletedAt),
    uniqueIndex('modules_id_project_id_unique').on(table.id, table.projectId),
    foreignKey({
      name: 'modules_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('modules_created_by_id_idx').on(table.createdById),
    index('modules_lead_id_idx').on(table.leadId),
    index('modules_project_id_idx').on(table.projectId),
    uniqueIndex('module_unique_name_project_when_deleted_at_null')
      .on(table.name, table.projectId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('modules_updated_by_id_idx').on(table.updatedById),
    index('modules_workspace_id_idx').on(table.workspaceId)
  ]
)

export const moduleMembers = sqliteTable(
  'module_members',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    memberId: integer('member_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    moduleId: integer('module_id')
      .notNull()
      .references((): AnySQLiteColumn => modules.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('module_members_module_id_member_id_deleted_at_unique').on(
      table.moduleId,
      table.memberId,
      table.deletedAt
    ),
    foreignKey({
      name: 'module_members_module_id_project_id_fk',
      columns: [table.moduleId, table.projectId],
      foreignColumns: [modules.id, modules.projectId]
    }),
    foreignKey({
      name: 'module_members_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('module_members_created_by_id_idx').on(table.createdById),
    index('module_members_member_id_idx').on(table.memberId),
    index('module_members_module_id_idx').on(table.moduleId),
    index('module_members_project_id_idx').on(table.projectId),
    uniqueIndex('module_member_unique_module_member_when_deleted_at_null')
      .on(table.moduleId, table.memberId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('module_members_updated_by_id_idx').on(table.updatedById),
    index('module_members_workspace_id_idx').on(table.workspaceId)
  ]
)

export const moduleIssues = sqliteTable(
  'module_issues',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    issueId: integer('issue_id')
      .notNull()
      .references((): AnySQLiteColumn => issues.id, { onDelete: 'cascade' }),
    moduleId: integer('module_id')
      .notNull()
      .references((): AnySQLiteColumn => modules.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('module_issues_issue_id_module_id_deleted_at_unique').on(
      table.issueId,
      table.moduleId,
      table.deletedAt
    ),
    foreignKey({
      name: 'module_issues_issue_id_project_id_fk',
      columns: [table.issueId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'module_issues_module_id_project_id_fk',
      columns: [table.moduleId, table.projectId],
      foreignColumns: [modules.id, modules.projectId]
    }),
    foreignKey({
      name: 'module_issues_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    uniqueIndex('module_issue_unique_issue_module_when_deleted_at_null')
      .on(table.issueId, table.moduleId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('module_issues_created_by_id_idx').on(table.createdById),
    index('module_issues_issue_id_idx').on(table.issueId),
    index('module_issues_module_id_idx').on(table.moduleId),
    index('module_issues_project_id_idx').on(table.projectId),
    index('module_issues_updated_by_id_idx').on(table.updatedById),
    index('module_issues_workspace_id_idx').on(table.workspaceId)
  ]
)

export const moduleLinks = sqliteTable(
  'module_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    title: text('title', { length: 255 }),
    url: text('url', { length: 200 }).notNull(),
    moduleId: integer('module_id')
      .notNull()
      .references((): AnySQLiteColumn => modules.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    metadata: text('metadata', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('module_links_metadata_json', sql`json_valid(${table.metadata})`),
    foreignKey({
      name: 'module_links_module_id_project_id_fk',
      columns: [table.moduleId, table.projectId],
      foreignColumns: [modules.id, modules.projectId]
    }),
    foreignKey({
      name: 'module_links_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('module_links_created_by_id_idx').on(table.createdById),
    index('module_links_module_id_idx').on(table.moduleId),
    index('module_links_project_id_idx').on(table.projectId),
    index('module_links_updated_by_id_idx').on(table.updatedById),
    index('module_links_workspace_id_idx').on(table.workspaceId)
  ]
)

export const moduleUserProperties = sqliteTable(
  'module_user_properties',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    filters: text('filters', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    displayFilters: text('display_filters', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    displayProperties: text('display_properties', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    moduleId: integer('module_id')
      .notNull()
      .references((): AnySQLiteColumn => modules.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at'),
    richFilters: text('rich_filters', { mode: 'json' }).$type<JsonValue>().notNull().default({})
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('module_user_properties_filters_json', sql`json_valid(${table.filters})`),
    check('module_user_properties_display_filters_json', sql`json_valid(${table.displayFilters})`),
    check('module_user_properties_display_properties_json', sql`json_valid(${table.displayProperties})`),
    check('module_user_properties_rich_filters_json', sql`json_valid(${table.richFilters})`),
    uniqueIndex('module_user_properties_module_id_user_id_deleted_at_unique').on(
      table.moduleId,
      table.userId,
      table.deletedAt
    ),
    foreignKey({
      name: 'module_user_properties_module_id_project_id_fk',
      columns: [table.moduleId, table.projectId],
      foreignColumns: [modules.id, modules.projectId]
    }),
    foreignKey({
      name: 'module_user_properties_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('module_user_properties_created_by_id_idx').on(table.createdById),
    index('module_user_properties_module_id_idx').on(table.moduleId),
    index('module_user_properties_project_id_idx').on(table.projectId),
    uniqueIndex('module_user_properties_unique_module_user_when_deleted_at_null')
      .on(table.moduleId, table.userId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('module_user_properties_updated_by_id_idx').on(table.updatedById),
    index('module_user_properties_user_id_idx').on(table.userId),
    index('module_user_properties_workspace_id_idx').on(table.workspaceId)
  ]
)

export const estimates = sqliteTable(
  'estimates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    name: text('name', { length: 255 }).notNull(),
    description: text('description').notNull().default(''),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    type: text('type', { length: 255, enum: ['categories', 'points'] })
      .notNull()
      .default('categories'),
    lastUsed: integer('last_used', { mode: 'boolean' }).notNull().default(false),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('estimates_type_values', sql`${table.type} in ('categories', 'points')`),
    uniqueIndex('estimates_name_project_id_deleted_at_unique').on(table.name, table.projectId, table.deletedAt),
    uniqueIndex('estimates_id_project_id_unique').on(table.id, table.projectId),
    foreignKey({
      name: 'estimates_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    uniqueIndex('estimate_unique_name_project_when_deleted_at_null')
      .on(table.name, table.projectId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('estimates_created_by_id_idx').on(table.createdById),
    index('estimates_project_id_idx').on(table.projectId),
    index('estimates_updated_by_id_idx').on(table.updatedById),
    index('estimates_workspace_id_idx').on(table.workspaceId)
  ]
)

export const estimatePoints = sqliteTable(
  'estimate_points',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    key: integer('key').notNull().default(0),
    description: text('description').notNull().default(''),
    value: text('value', { length: 255 }).notNull(),
    estimateId: integer('estimate_id')
      .notNull()
      .references((): AnySQLiteColumn => estimates.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('estimate_points_id_project_id_unique').on(table.id, table.projectId),
    foreignKey({
      name: 'estimate_points_estimate_id_project_id_fk',
      columns: [table.estimateId, table.projectId],
      foreignColumns: [estimates.id, estimates.projectId]
    }),
    foreignKey({
      name: 'estimate_points_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('estimate_points_created_by_id_idx').on(table.createdById),
    index('estimate_points_estimate_id_idx').on(table.estimateId),
    index('estimate_points_project_id_idx').on(table.projectId),
    index('estimate_points_updated_by_id_idx').on(table.updatedById),
    index('estimate_points_workspace_id_idx').on(table.workspaceId)
  ]
)

export const issueTypes = sqliteTable(
  'issue_types',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    name: text('name', { length: 255 }).notNull(),
    description: text('description').notNull().default(''),
    logoProps: text('logo_props', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    deletedAt: timestamp('deleted_at'),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    level: real('level').notNull().default(0),
    externalId: text('external_id', { length: 255 }),
    externalSource: text('external_source', { length: 255 }),
    isEpic: integer('is_epic', { mode: 'boolean' }).notNull().default(false)
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('issue_types_logo_props_json', sql`json_valid(${table.logoProps})`),
    uniqueIndex('issue_types_id_workspace_id_unique').on(table.id, table.workspaceId),
    index('issue_types_created_by_id_idx').on(table.createdById),
    index('issue_types_updated_by_id_idx').on(table.updatedById),
    index('issue_types_workspace_id_idx').on(table.workspaceId)
  ]
)

export const projectIssueTypes = sqliteTable(
  'project_issue_types',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    deletedAt: timestamp('deleted_at'),
    level: integer('level').notNull().default(0),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    issueTypeId: integer('issue_type_id')
      .notNull()
      .references((): AnySQLiteColumn => issueTypes.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' })
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('project_issue_types_level_check', sql`${table.level} >= 0`),
    uniqueIndex('project_issue_types_project_id_issue_type_id_deleted_at_unique').on(
      table.projectId,
      table.issueTypeId,
      table.deletedAt
    ),
    foreignKey({
      name: 'project_issue_types_issue_type_id_workspace_id_fk',
      columns: [table.issueTypeId, table.workspaceId],
      foreignColumns: [issueTypes.id, issueTypes.workspaceId]
    }),
    foreignKey({
      name: 'project_issue_types_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    uniqueIndex('project_issue_type_unique_project_issue_type_when_deleted_at_nu')
      .on(table.projectId, table.issueTypeId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('project_issue_types_created_by_id_idx').on(table.createdById),
    index('project_issue_types_issue_type_id_idx').on(table.issueTypeId),
    index('project_issue_types_project_id_idx').on(table.projectId),
    index('project_issue_types_updated_by_id_idx').on(table.updatedById),
    index('project_issue_types_workspace_id_idx').on(table.workspaceId)
  ]
)

export const intakes = sqliteTable(
  'intakes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    name: text('name', { length: 255 }).notNull(),
    description: text('description').notNull().default(''),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    viewProps: text('view_props', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    logoProps: text('logo_props', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('intakes_view_props_json', sql`json_valid(${table.viewProps})`),
    check('intakes_logo_props_json', sql`json_valid(${table.logoProps})`),
    uniqueIndex('intakes_name_project_id_deleted_at_unique').on(table.name, table.projectId, table.deletedAt),
    uniqueIndex('intakes_id_project_id_unique').on(table.id, table.projectId),
    foreignKey({
      name: 'intakes_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('intakes_created_by_id_idx').on(table.createdById),
    index('intakes_project_id_idx').on(table.projectId),
    index('intakes_updated_by_id_idx').on(table.updatedById),
    index('intakes_workspace_id_idx').on(table.workspaceId),
    uniqueIndex('intake_unique_name_project_when_deleted_at_null')
      .on(table.name, table.projectId)
      .where(sql`(${table.deletedAt} IS NULL)`)
  ]
)

export const intakeIssues = sqliteTable(
  'intake_issues',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    status: integer('status').notNull().default(-2),
    snoozedTill: timestamp('snoozed_till'),
    source: text('source', { length: 255 }).default('IN_APP'),
    duplicateToId: integer('duplicate_to_id').references((): AnySQLiteColumn => issues.id, { onDelete: 'set null' }),
    issueId: integer('issue_id')
      .notNull()
      .references((): AnySQLiteColumn => issues.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    externalId: text('external_id', { length: 255 }),
    externalSource: text('external_source', { length: 255 }),
    deletedAt: timestamp('deleted_at'),
    extra: text('extra', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    sourceEmail: text('source_email'),
    intakeId: integer('intake_id')
      .notNull()
      .references((): AnySQLiteColumn => intakes.id, { onDelete: 'cascade' })
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('intake_issues_status_values', sql`${table.status} in (-2, -1, 0, 1, 2)`),
    check('intake_issues_extra_json', sql`json_valid(${table.extra})`),
    foreignKey({
      name: 'intake_issues_duplicate_to_id_project_id_fk',
      columns: [table.duplicateToId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'intake_issues_issue_id_project_id_fk',
      columns: [table.issueId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'intake_issues_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    foreignKey({
      name: 'intake_issues_intake_id_project_id_fk',
      columns: [table.intakeId, table.projectId],
      foreignColumns: [intakes.id, intakes.projectId]
    }),
    index('intake_issues_created_by_id_idx').on(table.createdById),
    index('intake_issues_duplicate_to_id_idx').on(table.duplicateToId),
    index('intake_issues_intake_id_idx').on(table.intakeId),
    index('intake_issues_issue_id_idx').on(table.issueId),
    index('intake_issues_project_id_idx').on(table.projectId),
    index('intake_issues_updated_by_id_idx').on(table.updatedById),
    index('intake_issues_workspace_id_idx').on(table.workspaceId),
    index('intake_issue_snoozed_till_idx')
      .on(table.snoozedTill)
      .where(sql`(${table.status} = 0)`)
  ]
)

export const draftIssues = sqliteTable(
  'draft_issues',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    deletedAt: timestamp('deleted_at'),
    name: text('name', { length: 255 }),
    descriptionHtml: text('description_html').notNull().default('<p></p>'),
    descriptionStripped: text('description_stripped'),
    descriptionBinary: blob('description_binary', { mode: 'buffer' }),
    priority: text('priority', { length: 30, enum: ['urgent', 'high', 'medium', 'low', 'none'] })
      .notNull()
      .default('none'),
    startDate: text('start_date'),
    targetDate: text('target_date'),
    sortOrder: real('sort_order').notNull().default(65535),
    completedAt: timestamp('completed_at'),
    externalSource: text('external_source', { length: 255 }),
    externalId: text('external_id', { length: 255 }),
    estimatePointId: integer('estimate_point_id').references((): AnySQLiteColumn => estimatePoints.id, {
      onDelete: 'set null'
    }),
    parentId: integer('parent_id').references((): AnySQLiteColumn => issues.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    stateId: integer('state_id').references((): AnySQLiteColumn => states.id, { onDelete: 'cascade' }),
    typeId: integer('type_id').references((): AnySQLiteColumn => issueTypes.id, { onDelete: 'set null' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    descriptionJson: text('description_json', { mode: 'json' }).$type<JsonValue>().notNull().default({})
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('draft_issues_priority_values', sql`${table.priority} in ('urgent', 'high', 'medium', 'low', 'none')`),
    check('draft_issues_description_json_json', sql`json_valid(${table.descriptionJson})`),
    uniqueIndex('draft_issues_id_workspace_id_unique').on(table.id, table.workspaceId),
    foreignKey({
      name: 'draft_issues_estimate_point_id_project_id_fk',
      columns: [table.estimatePointId, table.projectId],
      foreignColumns: [estimatePoints.id, estimatePoints.projectId]
    }),
    foreignKey({
      name: 'draft_issues_parent_id_project_id_fk',
      columns: [table.parentId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'draft_issues_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    foreignKey({
      name: 'draft_issues_state_id_project_id_fk',
      columns: [table.stateId, table.projectId],
      foreignColumns: [states.id, states.projectId]
    }),
    foreignKey({
      name: 'draft_issues_type_id_workspace_id_fk',
      columns: [table.typeId, table.workspaceId],
      foreignColumns: [issueTypes.id, issueTypes.workspaceId]
    }),
    index('draft_issues_created_by_id_idx').on(table.createdById),
    index('draft_issues_estimate_point_id_idx').on(table.estimatePointId),
    index('draft_issues_parent_id_idx').on(table.parentId),
    index('draft_issues_project_id_idx').on(table.projectId),
    index('draft_issues_state_id_idx').on(table.stateId),
    index('draft_issues_type_id_idx').on(table.typeId),
    index('draft_issues_updated_by_id_idx').on(table.updatedById),
    index('draft_issues_workspace_id_idx').on(table.workspaceId)
  ]
)

export const draftIssueAssignees = sqliteTable(
  'draft_issue_assignees',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    deletedAt: timestamp('deleted_at'),
    assigneeId: integer('assignee_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    draftIssueId: integer('draft_issue_id')
      .notNull()
      .references((): AnySQLiteColumn => draftIssues.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' })
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('draft_issue_assignees_draft_issue_id_assignee_id_deleted_at_unique').on(
      table.draftIssueId,
      table.assigneeId,
      table.deletedAt
    ),
    foreignKey({
      name: 'draft_issue_assignees_draft_issue_id_workspace_id_fk',
      columns: [table.draftIssueId, table.workspaceId],
      foreignColumns: [draftIssues.id, draftIssues.workspaceId]
    }),
    foreignKey({
      name: 'draft_issue_assignees_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    uniqueIndex('draft_issue_assignee_unique_issue_assignee_when_deleted_at_null')
      .on(table.draftIssueId, table.assigneeId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('draft_issue_assignees_assignee_id_idx').on(table.assigneeId),
    index('draft_issue_assignees_created_by_id_idx').on(table.createdById),
    index('draft_issue_assignees_draft_issue_id_idx').on(table.draftIssueId),
    index('draft_issue_assignees_project_id_idx').on(table.projectId),
    index('draft_issue_assignees_updated_by_id_idx').on(table.updatedById),
    index('draft_issue_assignees_workspace_id_idx').on(table.workspaceId)
  ]
)

export const draftIssueLabels = sqliteTable(
  'draft_issue_labels',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    deletedAt: timestamp('deleted_at'),
    draftIssueId: integer('draft_issue_id')
      .notNull()
      .references((): AnySQLiteColumn => draftIssues.id, { onDelete: 'cascade' }),
    labelId: integer('label_id')
      .notNull()
      .references((): AnySQLiteColumn => labels.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' })
  },
  (table): SQLiteTableExtraConfigValue[] => [
    foreignKey({
      name: 'draft_issue_labels_draft_issue_id_workspace_id_fk',
      columns: [table.draftIssueId, table.workspaceId],
      foreignColumns: [draftIssues.id, draftIssues.workspaceId]
    }),
    foreignKey({
      name: 'draft_issue_labels_label_id_workspace_id_fk',
      columns: [table.labelId, table.workspaceId],
      foreignColumns: [labels.id, labels.workspaceId]
    }),
    foreignKey({
      name: 'draft_issue_labels_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('draft_issue_labels_created_by_id_idx').on(table.createdById),
    index('draft_issue_labels_draft_issue_id_idx').on(table.draftIssueId),
    index('draft_issue_labels_label_id_idx').on(table.labelId),
    index('draft_issue_labels_project_id_idx').on(table.projectId),
    index('draft_issue_labels_updated_by_id_idx').on(table.updatedById),
    index('draft_issue_labels_workspace_id_idx').on(table.workspaceId)
  ]
)

export const draftIssueModules = sqliteTable(
  'draft_issue_modules',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    deletedAt: timestamp('deleted_at'),
    draftIssueId: integer('draft_issue_id')
      .notNull()
      .references((): AnySQLiteColumn => draftIssues.id, { onDelete: 'cascade' }),
    moduleId: integer('module_id')
      .notNull()
      .references((): AnySQLiteColumn => modules.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' })
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('draft_issue_modules_draft_issue_id_module_id_deleted_at_unique').on(
      table.draftIssueId,
      table.moduleId,
      table.deletedAt
    ),
    foreignKey({
      name: 'draft_issue_modules_draft_issue_id_workspace_id_fk',
      columns: [table.draftIssueId, table.workspaceId],
      foreignColumns: [draftIssues.id, draftIssues.workspaceId]
    }),
    foreignKey({
      name: 'draft_issue_modules_module_id_project_id_fk',
      columns: [table.moduleId, table.projectId],
      foreignColumns: [modules.id, modules.projectId]
    }),
    foreignKey({
      name: 'draft_issue_modules_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('draft_issue_modules_created_by_id_idx').on(table.createdById),
    index('draft_issue_modules_draft_issue_id_idx').on(table.draftIssueId),
    index('draft_issue_modules_module_id_idx').on(table.moduleId),
    index('draft_issue_modules_project_id_idx').on(table.projectId),
    index('draft_issue_modules_updated_by_id_idx').on(table.updatedById),
    index('draft_issue_modules_workspace_id_idx').on(table.workspaceId),
    uniqueIndex('module_draft_issue_unique_issue_module_when_deleted_at_null')
      .on(table.draftIssueId, table.moduleId)
      .where(sql`(${table.deletedAt} IS NULL)`)
  ]
)

export const draftIssueCycles = sqliteTable(
  'draft_issue_cycles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    deletedAt: timestamp('deleted_at'),
    cycleId: integer('cycle_id')
      .notNull()
      .references((): AnySQLiteColumn => cycles.id, { onDelete: 'cascade' }),
    draftIssueId: integer('draft_issue_id')
      .notNull()
      .references((): AnySQLiteColumn => draftIssues.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' })
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('draft_issue_cycles_draft_issue_id_cycle_id_deleted_at_unique').on(
      table.draftIssueId,
      table.cycleId,
      table.deletedAt
    ),
    foreignKey({
      name: 'draft_issue_cycles_cycle_id_project_id_fk',
      columns: [table.cycleId, table.projectId],
      foreignColumns: [cycles.id, cycles.projectId]
    }),
    foreignKey({
      name: 'draft_issue_cycles_draft_issue_id_workspace_id_fk',
      columns: [table.draftIssueId, table.workspaceId],
      foreignColumns: [draftIssues.id, draftIssues.workspaceId]
    }),
    foreignKey({
      name: 'draft_issue_cycles_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    uniqueIndex('draft_issue_cycle_when_deleted_at_null')
      .on(table.draftIssueId, table.cycleId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('draft_issue_cycles_created_by_id_idx').on(table.createdById),
    index('draft_issue_cycles_cycle_id_idx').on(table.cycleId),
    index('draft_issue_cycles_draft_issue_id_idx').on(table.draftIssueId),
    index('draft_issue_cycles_project_id_idx').on(table.projectId),
    index('draft_issue_cycles_updated_by_id_idx').on(table.updatedById),
    index('draft_issue_cycles_workspace_id_idx').on(table.workspaceId)
  ]
)
