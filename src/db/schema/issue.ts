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
import { descriptions } from './content'
import { estimatePoints, issueTypes } from './planning'
import { projects, workspaces } from './workspace'

export const issues = sqliteTable(
  'issues',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    name: text('name', { length: 255 }).notNull(),
    priority: text('priority', { length: 30, enum: ['urgent', 'high', 'medium', 'low', 'none'] })
      .notNull()
      .default('none'),
    startDate: text('start_date'),
    targetDate: text('target_date'),
    sequenceId: integer('sequence_id').notNull(),
    parentId: integer('parent_id').references((): AnySQLiteColumn => issues.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    stateId: integer('state_id').references((): AnySQLiteColumn => states.id, { onDelete: 'set null' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    descriptionHtml: text('description_html').notNull().default('<p></p>'),
    descriptionStripped: text('description_stripped'),
    completedAt: timestamp('completed_at'),
    sortOrder: real('sort_order').notNull().default(65535),
    archivedAt: text('archived_at'),
    isDraft: integer('is_draft', { mode: 'boolean' }).notNull().default(false),
    externalId: text('external_id', { length: 255 }),
    externalSource: text('external_source', { length: 255 }),
    descriptionBinary: blob('description_binary', { mode: 'buffer' }),
    point: integer('point'),
    estimatePointId: integer('estimate_point_id').references((): AnySQLiteColumn => estimatePoints.id, {
      onDelete: 'set null'
    }),
    typeId: integer('type_id').references((): AnySQLiteColumn => issueTypes.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at'),
    descriptionJson: text('description_json', { mode: 'json' }).$type<JsonValue>().notNull().default({})
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('issues_priority_values', sql`${table.priority} in ('urgent', 'high', 'medium', 'low', 'none')`),
    check('issues_description_json_json', sql`json_valid(${table.descriptionJson})`),
    check('issues_sequence_id_positive', sql`${table.sequenceId} > 0`),
    uniqueIndex('issues_project_sequence_unique').on(table.projectId, table.sequenceId),
    uniqueIndex('issues_id_project_id_unique').on(table.id, table.projectId),
    uniqueIndex('issues_id_workspace_id_unique').on(table.id, table.workspaceId),
    foreignKey({
      name: 'issues_parent_id_project_id_fk',
      columns: [table.parentId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'issues_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    foreignKey({
      name: 'issues_state_id_project_id_fk',
      columns: [table.stateId, table.projectId],
      foreignColumns: [states.id, states.projectId]
    }),
    foreignKey({
      name: 'issues_estimate_point_id_project_id_fk',
      columns: [table.estimatePointId, table.projectId],
      foreignColumns: [estimatePoints.id, estimatePoints.projectId]
    }),
    foreignKey({
      name: 'issues_type_id_workspace_id_fk',
      columns: [table.typeId, table.workspaceId],
      foreignColumns: [issueTypes.id, issueTypes.workspaceId]
    }),
    index('issues_created_by_id_idx').on(table.createdById),
    index('issues_parent_id_idx').on(table.parentId),
    index('issues_project_id_idx').on(table.projectId),
    index('issues_state_id_idx').on(table.stateId),
    index('issues_updated_by_id_idx').on(table.updatedById),
    index('issues_workspace_id_idx').on(table.workspaceId),
    index('issues_estimate_point_id_idx').on(table.estimatePointId),
    index('issues_type_id_idx').on(table.typeId)
  ]
)

export const states = sqliteTable(
  'states',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    name: text('name', { length: 255 }).notNull(),
    description: text('description').notNull().default(''),
    color: text('color', { length: 255 }).notNull(),
    slug: text('slug', { length: 100 }).notNull(),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    sequence: real('sequence').notNull().default(65535),
    group: text('group', { length: 20, enum: ['backlog', 'unstarted', 'started', 'completed', 'cancelled', 'triage'] })
      .notNull()
      .default('backlog'),
    default: integer('default', { mode: 'boolean' }).notNull().default(false),
    externalId: text('external_id', { length: 255 }),
    externalSource: text('external_source', { length: 255 }),
    isTriage: integer('is_triage', { mode: 'boolean' }).notNull().default(false),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check(
      'states_group_values',
      sql`${table.group} in ('backlog', 'unstarted', 'started', 'completed', 'cancelled', 'triage')`
    ),
    uniqueIndex('states_name_project_id_deleted_at_unique').on(table.name, table.projectId, table.deletedAt),
    uniqueIndex('states_id_project_id_unique').on(table.id, table.projectId),
    foreignKey({
      name: 'states_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('states_created_by_id_idx').on(table.createdById),
    index('states_project_id_idx').on(table.projectId),
    index('states_slug_idx').on(table.slug),
    uniqueIndex('state_unique_name_project_when_deleted_at_null')
      .on(table.name, table.projectId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('states_updated_by_id_idx').on(table.updatedById),
    index('states_workspace_id_idx').on(table.workspaceId)
  ]
)

export const labels = sqliteTable(
  'labels',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    name: text('name', { length: 255 }).notNull(),
    description: text('description').notNull().default(''),
    projectId: integer('project_id').references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    parentId: integer('parent_id').references((): AnySQLiteColumn => labels.id, { onDelete: 'cascade' }),
    color: text('color', { length: 255 }).notNull().default(''),
    sortOrder: real('sort_order').notNull().default(65535),
    externalId: text('external_id', { length: 255 }),
    externalSource: text('external_source', { length: 255 }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('labels_id_workspace_id_unique').on(table.id, table.workspaceId),
    foreignKey({
      name: 'labels_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    foreignKey({
      name: 'labels_parent_id_workspace_id_fk',
      columns: [table.parentId, table.workspaceId],
      foreignColumns: [labels.id, labels.workspaceId]
    }),
    index('labels_created_by_id_idx').on(table.createdById),
    index('labels_parent_id_idx').on(table.parentId),
    index('labels_project_id_idx').on(table.projectId),
    index('labels_updated_by_id_idx').on(table.updatedById),
    index('labels_workspace_id_idx').on(table.workspaceId),
    uniqueIndex('labels_workspace_name_live_unique')
      .on(table.workspaceId, table.name)
      .where(sql`((${table.deletedAt} IS NULL) AND (${table.projectId} IS NULL))`),
    uniqueIndex('unique_project_name_when_not_deleted')
      .on(table.projectId, table.name)
      .where(sql`((${table.deletedAt} IS NULL) AND (${table.projectId} IS NOT NULL))`)
  ]
)

export const issueSequences = sqliteTable(
  'issue_sequences',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    sequence: integer('sequence').notNull().default(1),
    deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
    issueId: integer('issue_id').references((): AnySQLiteColumn => issues.id, { onDelete: 'set null' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('issue_sequence_sequence_check', sql`${table.sequence} >= 0`),
    check('issue_sequences_sequence_positive', sql`${table.sequence} > 0`),
    uniqueIndex('issue_sequences_project_sequence_unique').on(table.projectId, table.sequence),
    uniqueIndex('issue_sequences_issue_unique').on(table.issueId),
    foreignKey({
      name: 'issue_sequences_issue_id_project_id_fk',
      columns: [table.issueId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'issue_sequences_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('issue_sequences_created_by_id_idx').on(table.createdById),
    index('issue_sequences_project_id_idx').on(table.projectId),
    index('issue_sequences_updated_by_id_idx').on(table.updatedById),
    index('issue_sequences_workspace_id_idx').on(table.workspaceId),
    index('issue_sequences_sequence_idx').on(table.sequence)
  ]
)

export const projectIssueCounters = sqliteTable(
  'project_issue_counters',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    lastSequence: integer('last_sequence').notNull().default(0)
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('project_issue_counters_last_sequence_check', sql`${table.lastSequence} >= 0`),
    uniqueIndex('project_issue_counters_project_unique').on(table.projectId)
  ]
)

export const issueAssignees = sqliteTable(
  'issue_assignees',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    assigneeId: integer('assignee_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
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
    uniqueIndex('issue_assignees_issue_id_assignee_id_deleted_at_unique').on(
      table.issueId,
      table.assigneeId,
      table.deletedAt
    ),
    foreignKey({
      name: 'issue_assignees_issue_id_project_id_fk',
      columns: [table.issueId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'issue_assignees_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('issue_assignees_assignee_id_idx').on(table.assigneeId),
    index('issue_assignees_created_by_id_idx').on(table.createdById),
    index('issue_assignees_issue_id_idx').on(table.issueId),
    index('issue_assignees_project_id_idx').on(table.projectId),
    uniqueIndex('issue_assignee_unique_issue_assignee_when_deleted_at_null')
      .on(table.issueId, table.assigneeId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('issue_assignees_updated_by_id_idx').on(table.updatedById),
    index('issue_assignees_workspace_id_idx').on(table.workspaceId)
  ]
)

export const issueLabels = sqliteTable(
  'issue_labels',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    issueId: integer('issue_id')
      .notNull()
      .references((): AnySQLiteColumn => issues.id, { onDelete: 'cascade' }),
    labelId: integer('label_id')
      .notNull()
      .references((): AnySQLiteColumn => labels.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    foreignKey({
      name: 'issue_labels_issue_id_project_id_fk',
      columns: [table.issueId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'issue_labels_label_id_workspace_id_fk',
      columns: [table.labelId, table.workspaceId],
      foreignColumns: [labels.id, labels.workspaceId]
    }),
    foreignKey({
      name: 'issue_labels_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('issue_labels_created_by_id_idx').on(table.createdById),
    index('issue_labels_issue_id_idx').on(table.issueId),
    index('issue_labels_label_id_idx').on(table.labelId),
    index('issue_labels_project_id_idx').on(table.projectId),
    index('issue_labels_updated_by_id_idx').on(table.updatedById),
    index('issue_labels_workspace_id_idx').on(table.workspaceId)
  ]
)

export const issueRelations = sqliteTable(
  'issue_relations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    relationType: text('relation_type', { length: 20 }).notNull().default('blocked_by'),
    issueId: integer('issue_id')
      .notNull()
      .references((): AnySQLiteColumn => issues.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    relatedIssueId: integer('related_issue_id')
      .notNull()
      .references((): AnySQLiteColumn => issues.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('issue_relations_issue_id_related_issue_id_deleted_at_unique').on(
      table.issueId,
      table.relatedIssueId,
      table.deletedAt
    ),
    foreignKey({
      name: 'issue_relations_issue_id_workspace_id_fk',
      columns: [table.issueId, table.workspaceId],
      foreignColumns: [issues.id, issues.workspaceId]
    }),
    foreignKey({
      name: 'issue_relations_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    foreignKey({
      name: 'issue_relations_related_issue_id_workspace_id_fk',
      columns: [table.relatedIssueId, table.workspaceId],
      foreignColumns: [issues.id, issues.workspaceId]
    }),
    uniqueIndex('issue_relation_unique_issue_related_issue_when_deleted_at_null')
      .on(table.issueId, table.relatedIssueId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('issue_relations_created_by_id_idx').on(table.createdById),
    index('issue_relations_issue_id_idx').on(table.issueId),
    index('issue_relations_project_id_idx').on(table.projectId),
    index('issue_relations_related_issue_id_idx').on(table.relatedIssueId),
    index('issue_relations_updated_by_id_idx').on(table.updatedById),
    index('issue_relations_workspace_id_idx').on(table.workspaceId)
  ]
)

export const issueBlockers = sqliteTable(
  'issue_blockers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    blockId: integer('block_id')
      .notNull()
      .references((): AnySQLiteColumn => issues.id, { onDelete: 'cascade' }),
    blockedById: integer('blocked_by_id')
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
    foreignKey({
      name: 'issue_blockers_block_id_project_id_fk',
      columns: [table.blockId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'issue_blockers_blocked_by_id_project_id_fk',
      columns: [table.blockedById, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'issue_blockers_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('issue_blockers_block_id_idx').on(table.blockId),
    index('issue_blockers_blocked_by_id_idx').on(table.blockedById),
    index('issue_blockers_created_by_id_idx').on(table.createdById),
    index('issue_blockers_project_id_idx').on(table.projectId),
    index('issue_blockers_updated_by_id_idx').on(table.updatedById),
    index('issue_blockers_workspace_id_idx').on(table.workspaceId)
  ]
)

export const issueMentions = sqliteTable(
  'issue_mentions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    issueId: integer('issue_id')
      .notNull()
      .references((): AnySQLiteColumn => issues.id, { onDelete: 'cascade' }),
    mentionId: integer('mention_id')
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
    uniqueIndex('issue_mentions_issue_id_mention_id_deleted_at_unique').on(
      table.issueId,
      table.mentionId,
      table.deletedAt
    ),
    foreignKey({
      name: 'issue_mentions_issue_id_project_id_fk',
      columns: [table.issueId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'issue_mentions_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    uniqueIndex('issue_mention_unique_issue_mention_when_deleted_at_null')
      .on(table.issueId, table.mentionId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('issue_mentions_created_by_id_idx').on(table.createdById),
    index('issue_mentions_issue_id_idx').on(table.issueId),
    index('issue_mentions_mention_id_idx').on(table.mentionId),
    index('issue_mentions_project_id_idx').on(table.projectId),
    index('issue_mentions_updated_by_id_idx').on(table.updatedById),
    index('issue_mentions_workspace_id_idx').on(table.workspaceId)
  ]
)

export const issueLinks = sqliteTable(
  'issue_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    title: text('title', { length: 255 }),
    url: text('url').notNull(),
    issueId: integer('issue_id')
      .notNull()
      .references((): AnySQLiteColumn => issues.id, { onDelete: 'cascade' }),
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
    check('issue_links_metadata_json', sql`json_valid(${table.metadata})`),
    foreignKey({
      name: 'issue_links_issue_id_project_id_fk',
      columns: [table.issueId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'issue_links_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('issue_links_created_by_id_idx').on(table.createdById),
    index('issue_links_issue_id_idx').on(table.issueId),
    index('issue_links_project_id_idx').on(table.projectId),
    index('issue_links_updated_by_id_idx').on(table.updatedById),
    index('issue_links_workspace_id_idx').on(table.workspaceId)
  ]
)

export const issueAttachments = sqliteTable(
  'issue_attachments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    attributes: text('attributes', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    asset: text('asset', { length: 100 }).notNull(),
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
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('issue_attachments_attributes_json', sql`json_valid(${table.attributes})`),
    foreignKey({
      name: 'issue_attachments_issue_id_project_id_fk',
      columns: [table.issueId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'issue_attachments_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('issue_attachments_created_by_id_idx').on(table.createdById),
    index('issue_attachments_issue_id_idx').on(table.issueId),
    index('issue_attachments_project_id_idx').on(table.projectId),
    index('issue_attachments_updated_by_id_idx').on(table.updatedById),
    index('issue_attachments_workspace_id_idx').on(table.workspaceId)
  ]
)

export const issueComments = sqliteTable(
  'issue_comments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    attachments: text('attachments', { mode: 'json' }).$type<string[]>().notNull().default([]),
    issueId: integer('issue_id')
      .notNull()
      .references((): AnySQLiteColumn => issues.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    actorId: integer('actor_id').references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    commentStripped: text('comment_stripped').notNull().default(''),
    commentHtml: text('comment_html').notNull().default('<p></p>'),
    commentJson: text('comment_json', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    access: text('access', { length: 100, enum: ['INTERNAL', 'EXTERNAL'] })
      .notNull()
      .default('INTERNAL'),
    externalId: text('external_id', { length: 255 }),
    externalSource: text('external_source', { length: 255 }),
    deletedAt: timestamp('deleted_at'),
    editedAt: timestamp('edited_at'),
    descriptionId: integer('description_id').references((): AnySQLiteColumn => descriptions.id, {
      onDelete: 'cascade'
    }),
    parentId: integer('parent_id').references((): AnySQLiteColumn => issueComments.id, { onDelete: 'cascade' })
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check(
      'issue_comments_attachments_json',
      sql`json_valid(${table.attachments}) and json_type(${table.attachments}) = 'array' and json_type(${table.attachments}) = 'array'`
    ),
    check('issue_comments_comment_json_json', sql`json_valid(${table.commentJson})`),
    check('issue_comments_access_values', sql`${table.access} in ('INTERNAL', 'EXTERNAL')`),
    uniqueIndex('issue_comments_description_id_key').on(table.descriptionId),
    uniqueIndex('issue_comments_id_project_id_unique').on(table.id, table.projectId),
    foreignKey({
      name: 'issue_comments_issue_id_project_id_fk',
      columns: [table.issueId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'issue_comments_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    foreignKey({
      name: 'issue_comments_description_id_workspace_id_fk',
      columns: [table.descriptionId, table.workspaceId],
      foreignColumns: [descriptions.id, descriptions.workspaceId]
    }),
    foreignKey({
      name: 'issue_comments_parent_id_project_id_fk',
      columns: [table.parentId, table.projectId],
      foreignColumns: [issueComments.id, issueComments.projectId]
    }),
    index('issue_comments_actor_id_idx').on(table.actorId),
    index('issue_comments_created_by_id_idx').on(table.createdById),
    index('issue_comments_issue_id_idx').on(table.issueId),
    index('issue_comments_project_id_idx').on(table.projectId),
    index('issue_comments_updated_by_id_idx').on(table.updatedById),
    index('issue_comments_workspace_id_idx').on(table.workspaceId),
    index('issue_comments_parent_id_idx').on(table.parentId)
  ]
)

export const issueActivities = sqliteTable(
  'issue_activities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    verb: text('verb', { length: 255 }).notNull().default('created'),
    field: text('field', { length: 255 }),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    comment: text('comment').notNull().default(''),
    attachments: text('attachments', { mode: 'json' }).$type<string[]>().notNull().default([]),
    issueId: integer('issue_id').references((): AnySQLiteColumn => issues.id, { onDelete: 'no action' }),
    issueCommentId: integer('issue_comment_id').references((): AnySQLiteColumn => issueComments.id, {
      onDelete: 'no action'
    }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    actorId: integer('actor_id').references((): AnySQLiteColumn => user.id, { onDelete: 'set null' }),
    newIdentifier: integer('new_identifier'),
    oldIdentifier: integer('old_identifier'),
    epoch: real('epoch'),
    deletedAt: timestamp('deleted_at'),
    mutationId: text('mutation_id')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check(
      'issue_activities_attachments_json',
      sql`json_valid(${table.attachments}) and json_type(${table.attachments}) = 'array' and json_type(${table.attachments}) = 'array'`
    ),
    uniqueIndex('issue_activities_id_project_id_unique').on(table.id, table.projectId),
    index('issue_activities_mutation_id_idx').on(table.mutationId),
    foreignKey({
      name: 'issue_activities_issue_id_project_id_fk',
      columns: [table.issueId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'issue_activities_issue_comment_id_project_id_fk',
      columns: [table.issueCommentId, table.projectId],
      foreignColumns: [issueComments.id, issueComments.projectId]
    }),
    foreignKey({
      name: 'issue_activities_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('issue_activities_actor_id_idx').on(table.actorId),
    index('issue_activities_created_by_id_idx').on(table.createdById),
    index('issue_activities_issue_comment_id_idx').on(table.issueCommentId),
    index('issue_activities_issue_id_idx').on(table.issueId),
    index('issue_activities_project_id_idx').on(table.projectId),
    index('issue_activities_updated_by_id_idx').on(table.updatedById),
    index('issue_activities_workspace_id_idx').on(table.workspaceId)
  ]
)

export const issueSubscribers = sqliteTable(
  'issue_subscribers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    issueId: integer('issue_id')
      .notNull()
      .references((): AnySQLiteColumn => issues.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    subscriberId: integer('subscriber_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('issue_subscribers_issue_id_subscriber_id_deleted_at_unique').on(
      table.issueId,
      table.subscriberId,
      table.deletedAt
    ),
    foreignKey({
      name: 'issue_subscribers_issue_id_project_id_fk',
      columns: [table.issueId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'issue_subscribers_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    uniqueIndex('issue_subscriber_unique_issue_subscriber_when_deleted_at_null')
      .on(table.issueId, table.subscriberId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('issue_subscribers_created_by_id_idx').on(table.createdById),
    index('issue_subscribers_issue_id_idx').on(table.issueId),
    index('issue_subscribers_project_id_idx').on(table.projectId),
    index('issue_subscribers_subscriber_id_idx').on(table.subscriberId),
    index('issue_subscribers_updated_by_id_idx').on(table.updatedById),
    index('issue_subscribers_workspace_id_idx').on(table.workspaceId)
  ]
)

export const issueReactions = sqliteTable(
  'issue_reactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    reaction: text('reaction').notNull(),
    actorId: integer('actor_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
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
    uniqueIndex('issue_reactions_issue_id_actor_id_reaction_deleted_at_unique').on(
      table.issueId,
      table.actorId,
      table.reaction,
      table.deletedAt
    ),
    foreignKey({
      name: 'issue_reactions_issue_id_project_id_fk',
      columns: [table.issueId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'issue_reactions_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    uniqueIndex('issue_reaction_unique_issue_actor_reaction_when_deleted_at_null')
      .on(table.issueId, table.actorId, table.reaction)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('issue_reactions_actor_id_idx').on(table.actorId),
    index('issue_reactions_created_by_id_idx').on(table.createdById),
    index('issue_reactions_issue_id_idx').on(table.issueId),
    index('issue_reactions_project_id_idx').on(table.projectId),
    index('issue_reactions_updated_by_id_idx').on(table.updatedById),
    index('issue_reactions_workspace_id_idx').on(table.workspaceId)
  ]
)

export const commentReactions = sqliteTable(
  'comment_reactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    reaction: text('reaction').notNull(),
    actorId: integer('actor_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    commentId: integer('comment_id')
      .notNull()
      .references((): AnySQLiteColumn => issueComments.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('comment_reactions_comment_id_actor_id_reaction_deleted_at_unique').on(
      table.commentId,
      table.actorId,
      table.reaction,
      table.deletedAt
    ),
    foreignKey({
      name: 'comment_reactions_comment_id_project_id_fk',
      columns: [table.commentId, table.projectId],
      foreignColumns: [issueComments.id, issueComments.projectId]
    }),
    foreignKey({
      name: 'comment_reactions_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    uniqueIndex('comment_reaction_unique_comment_actor_reaction_when_deleted_at_')
      .on(table.commentId, table.actorId, table.reaction)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('comment_reactions_actor_id_idx').on(table.actorId),
    index('comment_reactions_comment_id_idx').on(table.commentId),
    index('comment_reactions_created_by_id_idx').on(table.createdById),
    index('comment_reactions_project_id_idx').on(table.projectId),
    index('comment_reactions_updated_by_id_idx').on(table.updatedById),
    index('comment_reactions_workspace_id_idx').on(table.workspaceId)
  ]
)

export const issueVotes = sqliteTable(
  'issue_votes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    vote: integer('vote').notNull().default(1),
    actorId: integer('actor_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
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
    check('issue_votes_vote_values', sql`${table.vote} in (-1, 1)`),
    uniqueIndex('issue_votes_issue_id_actor_id_deleted_at_unique').on(table.issueId, table.actorId, table.deletedAt),
    foreignKey({
      name: 'issue_votes_issue_id_project_id_fk',
      columns: [table.issueId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'issue_votes_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    uniqueIndex('issue_vote_unique_issue_actor_when_deleted_at_null')
      .on(table.issueId, table.actorId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('issue_votes_actor_id_idx').on(table.actorId),
    index('issue_votes_created_by_id_idx').on(table.createdById),
    index('issue_votes_issue_id_idx').on(table.issueId),
    index('issue_votes_project_id_idx').on(table.projectId),
    index('issue_votes_updated_by_id_idx').on(table.updatedById),
    index('issue_votes_workspace_id_idx').on(table.workspaceId)
  ]
)

export const issueVersions = sqliteTable(
  'issue_versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    deletedAt: timestamp('deleted_at'),
    parent: integer('parent'),
    state: integer('state'),
    estimatePoint: integer('estimate_point'),
    name: text('name', { length: 255 }).notNull(),
    priority: text('priority', { length: 30, enum: ['urgent', 'high', 'medium', 'low', 'none'] })
      .notNull()
      .default('none'),
    startDate: text('start_date'),
    targetDate: text('target_date'),
    sequenceId: integer('sequence_id').notNull().default(1),
    sortOrder: real('sort_order').notNull().default(65535),
    completedAt: timestamp('completed_at'),
    archivedAt: text('archived_at'),
    isDraft: integer('is_draft', { mode: 'boolean' }).notNull().default(false),
    externalSource: text('external_source', { length: 255 }),
    externalId: text('external_id', { length: 255 }),
    type: integer('type'),
    lastSavedAt: now('last_saved_at').notNull(),
    ownedById: integer('owned_by_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    assignees: text('assignees', { mode: 'json' }).$type<number[]>().notNull().default([]),
    labels: text('labels', { mode: 'json' }).$type<number[]>().notNull().default([]),
    cycle: integer('cycle'),
    modules: text('modules', { mode: 'json' }).$type<number[]>().notNull().default([]),
    properties: text('properties', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    meta: text('meta', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    issueId: integer('issue_id')
      .notNull()
      .references((): AnySQLiteColumn => issues.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    activityId: integer('activity_id').references((): AnySQLiteColumn => issueActivities.id, { onDelete: 'set null' })
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('issue_versions_priority_values', sql`${table.priority} in ('urgent', 'high', 'medium', 'low', 'none')`),
    check(
      'issue_versions_assignees_json',
      sql`json_valid(${table.assignees}) and json_type(${table.assignees}) = 'array'`
    ),
    check('issue_versions_labels_json', sql`json_valid(${table.labels}) and json_type(${table.labels}) = 'array'`),
    check('issue_versions_modules_json', sql`json_valid(${table.modules}) and json_type(${table.modules}) = 'array'`),
    check('issue_versions_properties_json', sql`json_valid(${table.properties})`),
    check('issue_versions_meta_json', sql`json_valid(${table.meta})`),
    foreignKey({
      name: 'issue_versions_issue_id_project_id_fk',
      columns: [table.issueId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'issue_versions_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    foreignKey({
      name: 'issue_versions_activity_id_project_id_fk',
      columns: [table.activityId, table.projectId],
      foreignColumns: [issueActivities.id, issueActivities.projectId]
    }),
    index('issue_versions_activity_id_idx').on(table.activityId),
    index('issue_versions_created_by_id_idx').on(table.createdById),
    index('issue_versions_issue_id_idx').on(table.issueId),
    index('issue_versions_owned_by_id_idx').on(table.ownedById),
    index('issue_versions_project_id_idx').on(table.projectId),
    index('issue_versions_updated_by_id_idx').on(table.updatedById),
    index('issue_versions_workspace_id_idx').on(table.workspaceId)
  ]
)

export const issueDescriptionVersions = sqliteTable(
  'issue_description_versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    deletedAt: timestamp('deleted_at'),
    descriptionBinary: blob('description_binary', { mode: 'buffer' }),
    descriptionHtml: text('description_html').notNull().default('<p></p>'),
    descriptionStripped: text('description_stripped'),
    descriptionJson: text('description_json', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    lastSavedAt: now('last_saved_at').notNull(),
    issueId: integer('issue_id')
      .notNull()
      .references((): AnySQLiteColumn => issues.id, { onDelete: 'cascade' }),
    ownedById: integer('owned_by_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' })
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('issue_description_versions_description_json_json', sql`json_valid(${table.descriptionJson})`),
    foreignKey({
      name: 'issue_description_versions_issue_id_project_id_fk',
      columns: [table.issueId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'issue_description_versions_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('issue_description_versions_created_by_id_idx').on(table.createdById),
    index('issue_description_versions_issue_id_idx').on(table.issueId),
    index('issue_description_versions_owned_by_id_idx').on(table.ownedById),
    index('issue_description_versions_project_id_idx').on(table.projectId),
    index('issue_description_versions_updated_by_id_idx').on(table.updatedById),
    index('issue_description_versions_workspace_id_idx').on(table.workspaceId)
  ]
)
