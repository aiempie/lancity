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
import { issueComments, issues, labels } from './issue'
import { draftIssues, intakes } from './planning'
import { projects, workspaces } from './workspace'

export const pages = sqliteTable(
  'pages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    name: text('name').notNull().default(''),
    descriptionHtml: text('description_html').notNull().default('<p></p>'),
    descriptionStripped: text('description_stripped'),
    access: integer('access').notNull().default(0),
    ownedById: integer('owned_by_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    color: text('color', { length: 255 }).notNull().default(''),
    archivedAt: text('archived_at'),
    isLocked: integer('is_locked', { mode: 'boolean' }).notNull().default(false),
    parentId: integer('parent_id').references((): AnySQLiteColumn => pages.id, { onDelete: 'cascade' }),
    viewProps: text('view_props', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    logoProps: text('logo_props', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    descriptionBinary: blob('description_binary', { mode: 'buffer' }),
    isGlobal: integer('is_global', { mode: 'boolean' }).notNull().default(false),
    deletedAt: timestamp('deleted_at'),
    movedToPage: integer('moved_to_page'),
    movedToProject: integer('moved_to_project'),
    externalId: text('external_id', { length: 255 }),
    externalSource: text('external_source', { length: 255 }),
    sortOrder: real('sort_order').notNull().default(65535),
    descriptionJson: text('description_json', { mode: 'json' }).$type<JsonValue>().notNull().default({})
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('pages_access_values', sql`${table.access} in (0, 1)`),
    check('pages_view_props_json', sql`json_valid(${table.viewProps})`),
    check('pages_logo_props_json', sql`json_valid(${table.logoProps})`),
    check('pages_description_json_json', sql`json_valid(${table.descriptionJson})`),
    check('pages_access_check', sql`${table.access} >= 0`),
    uniqueIndex('pages_id_workspace_id_unique').on(table.id, table.workspaceId),
    foreignKey({
      name: 'pages_parent_id_workspace_id_fk',
      columns: [table.parentId, table.workspaceId],
      foreignColumns: [pages.id, pages.workspaceId]
    }),
    index('pages_created_by_id_idx').on(table.createdById),
    index('pages_owned_by_id_idx').on(table.ownedById),
    index('pages_parent_id_idx').on(table.parentId),
    index('pages_updated_by_id_idx').on(table.updatedById),
    index('pages_workspace_id_idx').on(table.workspaceId)
  ]
)

export const pageLabels = sqliteTable(
  'page_labels',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    labelId: integer('label_id')
      .notNull()
      .references((): AnySQLiteColumn => labels.id, { onDelete: 'cascade' }),
    pageId: integer('page_id')
      .notNull()
      .references((): AnySQLiteColumn => pages.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    foreignKey({
      name: 'page_labels_label_id_workspace_id_fk',
      columns: [table.labelId, table.workspaceId],
      foreignColumns: [labels.id, labels.workspaceId]
    }),
    foreignKey({
      name: 'page_labels_page_id_workspace_id_fk',
      columns: [table.pageId, table.workspaceId],
      foreignColumns: [pages.id, pages.workspaceId]
    }),
    index('page_labels_created_by_id_idx').on(table.createdById),
    index('page_labels_label_id_idx').on(table.labelId),
    index('page_labels_page_id_idx').on(table.pageId),
    index('page_labels_updated_by_id_idx').on(table.updatedById),
    index('page_labels_workspace_id_idx').on(table.workspaceId)
  ]
)

export const projectPages = sqliteTable(
  'project_pages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    pageId: integer('page_id')
      .notNull()
      .references((): AnySQLiteColumn => pages.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('project_pages_project_id_page_id_deleted_at_unique').on(
      table.projectId,
      table.pageId,
      table.deletedAt
    ),
    foreignKey({
      name: 'project_pages_page_id_workspace_id_fk',
      columns: [table.pageId, table.workspaceId],
      foreignColumns: [pages.id, pages.workspaceId]
    }),
    foreignKey({
      name: 'project_pages_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    uniqueIndex('project_page_unique_project_page_when_deleted_at_null')
      .on(table.projectId, table.pageId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('project_pages_created_by_id_idx').on(table.createdById),
    index('project_pages_page_id_idx').on(table.pageId),
    index('project_pages_project_id_idx').on(table.projectId),
    index('project_pages_updated_by_id_idx').on(table.updatedById),
    index('project_pages_workspace_id_idx').on(table.workspaceId)
  ]
)

export const pageLogs = sqliteTable(
  'page_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    transaction: text('transaction').notNull(),
    entityIdentifier: integer('entity_identifier'),
    entityName: text('entity_name', { length: 30 }).notNull(),
    pageId: integer('page_id')
      .notNull()
      .references((): AnySQLiteColumn => pages.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at'),
    entityType: text('entity_type', { length: 30 })
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('page_logs_page_id_transaction_unique').on(table.pageId, table.transaction),
    foreignKey({
      name: 'page_logs_page_id_workspace_id_fk',
      columns: [table.pageId, table.workspaceId],
      foreignColumns: [pages.id, pages.workspaceId]
    }),
    index('page_logs_created_by_id_idx').on(table.createdById),
    index('page_logs_page_id_idx').on(table.pageId),
    index('page_logs_updated_by_id_idx').on(table.updatedById),
    index('page_logs_workspace_id_idx').on(table.workspaceId),
    index('pagelog_entity_id_idx').on(table.entityIdentifier),
    index('pagelog_entity_name_idx').on(table.entityName),
    index('pagelog_entity_type_idx').on(table.entityType),
    index('pagelog_name_id_idx').on(table.entityName, table.entityIdentifier),
    index('pagelog_type_id_idx').on(table.entityType, table.entityIdentifier)
  ]
)

export const pageVersions = sqliteTable(
  'page_versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    lastSavedAt: now('last_saved_at').notNull(),
    descriptionBinary: blob('description_binary', { mode: 'buffer' }),
    descriptionHtml: text('description_html').notNull().default('<p></p>'),
    descriptionStripped: text('description_stripped'),
    descriptionJson: text('description_json', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    ownedById: integer('owned_by_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    pageId: integer('page_id')
      .notNull()
      .references((): AnySQLiteColumn => pages.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at'),
    subPagesData: text('sub_pages_data', { mode: 'json' }).$type<JsonValue>().notNull().default({})
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('page_versions_description_json_json', sql`json_valid(${table.descriptionJson})`),
    check('page_versions_sub_pages_data_json', sql`json_valid(${table.subPagesData})`),
    foreignKey({
      name: 'page_versions_page_id_workspace_id_fk',
      columns: [table.pageId, table.workspaceId],
      foreignColumns: [pages.id, pages.workspaceId]
    }),
    index('page_versions_created_by_id_idx').on(table.createdById),
    index('page_versions_owned_by_id_idx').on(table.ownedById),
    index('page_versions_page_id_idx').on(table.pageId),
    index('page_versions_updated_by_id_idx').on(table.updatedById),
    index('page_versions_workspace_id_idx').on(table.workspaceId)
  ]
)

export const descriptions = sqliteTable(
  'descriptions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    deletedAt: timestamp('deleted_at'),
    descriptionJson: text('description_json', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    descriptionHtml: text('description_html').notNull().default('<p></p>'),
    descriptionBinary: blob('description_binary', { mode: 'buffer' }),
    descriptionStripped: text('description_stripped'),
    projectId: integer('project_id').references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' })
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('descriptions_description_json_json', sql`json_valid(${table.descriptionJson})`),
    uniqueIndex('descriptions_id_workspace_id_unique').on(table.id, table.workspaceId),
    foreignKey({
      name: 'descriptions_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('descriptions_created_by_id_idx').on(table.createdById),
    index('descriptions_project_id_idx').on(table.projectId),
    index('descriptions_updated_by_id_idx').on(table.updatedById),
    index('descriptions_workspace_id_idx').on(table.workspaceId)
  ]
)

export const descriptionVersions = sqliteTable(
  'description_versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    deletedAt: timestamp('deleted_at'),
    descriptionJson: text('description_json', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    descriptionHtml: text('description_html').notNull().default('<p></p>'),
    descriptionBinary: blob('description_binary', { mode: 'buffer' }),
    descriptionStripped: text('description_stripped'),
    descriptionId: integer('description_id')
      .notNull()
      .references((): AnySQLiteColumn => descriptions.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' })
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('description_versions_description_json_json', sql`json_valid(${table.descriptionJson})`),
    foreignKey({
      name: 'description_versions_description_id_workspace_id_fk',
      columns: [table.descriptionId, table.workspaceId],
      foreignColumns: [descriptions.id, descriptions.workspaceId]
    }),
    foreignKey({
      name: 'description_versions_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('description_versions_created_by_id_idx').on(table.createdById),
    index('description_versions_description_id_idx').on(table.descriptionId),
    index('description_versions_project_id_idx').on(table.projectId),
    index('description_versions_updated_by_id_idx').on(table.updatedById),
    index('description_versions_workspace_id_idx').on(table.workspaceId)
  ]
)

export const fileAssets = sqliteTable(
  'file_assets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    attributes: text('attributes', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    asset: text('asset', { length: 800 }).notNull(),
    workspaceId: integer('workspace_id').references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    isDeleted: integer('is_deleted', { mode: 'boolean' }).notNull().default(false),
    deletedAt: timestamp('deleted_at'),
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    commentId: integer('comment_id').references((): AnySQLiteColumn => issueComments.id, { onDelete: 'cascade' }),
    entityType: text('entity_type', { length: 255 }),
    externalId: text('external_id', { length: 255 }),
    externalSource: text('external_source', { length: 255 }),
    isUploaded: integer('is_uploaded', { mode: 'boolean' }).notNull().default(false),
    issueId: integer('issue_id').references((): AnySQLiteColumn => issues.id, { onDelete: 'cascade' }),
    pageId: integer('page_id').references((): AnySQLiteColumn => pages.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    size: real('size').notNull().default(0),
    storageMetadata: text('storage_metadata', { mode: 'json' }).$type<JsonValue>().default({}),
    userId: integer('user_id').references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    draftIssueId: integer('draft_issue_id').references((): AnySQLiteColumn => draftIssues.id, { onDelete: 'cascade' }),
    entityIdentifier: text('entity_identifier', { length: 255 })
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('file_assets_attributes_json', sql`json_valid(${table.attributes})`),
    check(
      'file_assets_storage_metadata_json',
      sql`json_valid(${table.storageMetadata}) or ${table.storageMetadata} is null`
    ),
    foreignKey({
      name: 'file_assets_comment_id_project_id_fk',
      columns: [table.commentId, table.projectId],
      foreignColumns: [issueComments.id, issueComments.projectId]
    }),
    foreignKey({
      name: 'file_assets_issue_id_project_id_fk',
      columns: [table.issueId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'file_assets_page_id_workspace_id_fk',
      columns: [table.pageId, table.workspaceId],
      foreignColumns: [pages.id, pages.workspaceId]
    }),
    foreignKey({
      name: 'file_assets_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    foreignKey({
      name: 'file_assets_draft_issue_id_workspace_id_fk',
      columns: [table.draftIssueId, table.workspaceId],
      foreignColumns: [draftIssues.id, draftIssues.workspaceId]
    }),
    index('asset_asset_idx').on(table.asset),
    index('asset_entity_identifier_idx').on(table.entityIdentifier),
    index('asset_entity_idx').on(table.entityType, table.entityIdentifier),
    index('asset_entity_type_idx').on(table.entityType),
    index('file_assets_created_by_id_idx').on(table.createdById),
    index('file_assets_updated_by_id_idx').on(table.updatedById),
    index('file_assets_comment_id_idx').on(table.commentId),
    index('file_assets_draft_issue_id_idx').on(table.draftIssueId),
    index('file_assets_issue_id_idx').on(table.issueId),
    index('file_assets_page_id_idx').on(table.pageId),
    index('file_assets_project_id_idx').on(table.projectId),
    index('file_assets_user_id_idx').on(table.userId),
    index('file_assets_workspace_id_idx').on(table.workspaceId)
  ]
)

export const deployBoards = sqliteTable(
  'deploy_boards',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    entityIdentifier: integer('entity_identifier'),
    entityName: text('entity_name', { length: 30 }),
    anchor: text('anchor', { length: 255 }).notNull(),
    isCommentsEnabled: integer('is_comments_enabled', { mode: 'boolean' }).notNull().default(false),
    isReactionsEnabled: integer('is_reactions_enabled', { mode: 'boolean' }).notNull().default(false),
    isVotesEnabled: integer('is_votes_enabled', { mode: 'boolean' }).notNull().default(false),
    viewProps: text('view_props', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    projectId: integer('project_id').references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at'),
    isActivityEnabled: integer('is_activity_enabled', { mode: 'boolean' }).notNull().default(true),
    isDisabled: integer('is_disabled', { mode: 'boolean' }).notNull().default(false),
    intakeId: integer('intake_id').references((): AnySQLiteColumn => intakes.id, { onDelete: 'set null' })
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('deploy_boards_view_props_json', sql`json_valid(${table.viewProps})`),
    uniqueIndex('deploy_boards_anchor_key').on(table.anchor),
    uniqueIndex('deploy_boards_entity_name_entity_identifier_deleted_at_unique').on(
      table.entityName,
      table.entityIdentifier,
      table.deletedAt
    ),
    foreignKey({
      name: 'deploy_boards_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    foreignKey({
      name: 'deploy_boards_intake_id_project_id_fk',
      columns: [table.intakeId, table.projectId],
      foreignColumns: [intakes.id, intakes.projectId]
    }),
    uniqueIndex('deploy_board_unique_entity_name_entity_identifier_when_deleted_')
      .on(table.entityName, table.entityIdentifier)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('deploy_boards_created_by_id_idx').on(table.createdById),
    index('deploy_boards_intake_id_idx').on(table.intakeId),
    index('deploy_boards_project_id_idx').on(table.projectId),
    index('deploy_boards_updated_by_id_idx').on(table.updatedById),
    index('deploy_boards_workspace_id_idx').on(table.workspaceId)
  ]
)

export const projectDeployBoards = sqliteTable(
  'project_deploy_boards',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    anchor: text('anchor', { length: 255 }).notNull(),
    comments: integer('comments', { mode: 'boolean' }).notNull().default(false),
    reactions: integer('reactions', { mode: 'boolean' }).notNull().default(false),
    votes: integer('votes', { mode: 'boolean' }).notNull().default(false),
    views: text('views', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at'),
    intakeId: integer('intake_id').references((): AnySQLiteColumn => intakes.id, { onDelete: 'set null' })
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('project_deploy_boards_views_json', sql`json_valid(${table.views})`),
    uniqueIndex('project_deploy_boards_anchor_key').on(table.anchor),
    uniqueIndex('project_deploy_boards_project_id_anchor_unique').on(table.projectId, table.anchor),
    foreignKey({
      name: 'project_deploy_boards_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    foreignKey({
      name: 'project_deploy_boards_intake_id_project_id_fk',
      columns: [table.intakeId, table.projectId],
      foreignColumns: [intakes.id, intakes.projectId]
    }),
    index('project_deploy_boards_created_by_id_idx').on(table.createdById),
    index('project_deploy_boards_intake_id_idx').on(table.intakeId),
    index('project_deploy_boards_project_id_idx').on(table.projectId),
    index('project_deploy_boards_updated_by_id_idx').on(table.updatedById),
    index('project_deploy_boards_workspace_id_idx').on(table.workspaceId)
  ]
)

export const projectPublicMembers = sqliteTable(
  'project_public_members',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    memberId: integer('member_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('project_public_members_project_id_member_id_deleted_at_unique').on(
      table.projectId,
      table.memberId,
      table.deletedAt
    ),
    foreignKey({
      name: 'project_public_members_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    uniqueIndex('project_public_member_unique_project_member_when_deleted_at_nul')
      .on(table.projectId, table.memberId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('project_public_members_created_by_id_idx').on(table.createdById),
    index('project_public_members_member_id_idx').on(table.memberId),
    index('project_public_members_project_id_idx').on(table.projectId),
    index('project_public_members_updated_by_id_idx').on(table.updatedById),
    index('project_public_members_workspace_id_idx').on(table.workspaceId)
  ]
)
