import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
  type SQLiteTableExtraConfigValue,
  uniqueIndex
} from 'drizzle-orm/sqlite-core'
import type { JsonValue } from '@/types/database/schema'
import { user } from './auth'
import { auditTimestamps, auditUsers, timestamp } from './columns'
import { issueComments, issues, labels } from './issue'
import { projects, workspaces } from './workspace'

export const integrations = sqliteTable(
  'integrations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    title: text('title', { length: 400 }).notNull(),
    provider: text('provider', { length: 400 }).notNull(),
    network: integer('network').notNull().default(1),
    description: text('description', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    author: text('author', { length: 400 }).notNull().default(''),
    webhookUrl: text('webhook_url').notNull().default(''),
    webhookSecret: text('webhook_secret').notNull().default(''),
    redirectUrl: text('redirect_url').notNull().default(''),
    metadata: text('metadata', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
    avatarUrl: text('avatar_url'),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('integrations_network_values', sql`${table.network} in (1, 2)`),
    check('integrations_description_json', sql`json_valid(${table.description})`),
    check('integrations_metadata_json', sql`json_valid(${table.metadata})`),
    check('integrations_network_check', sql`${table.network} >= 0`),
    uniqueIndex('integrations_provider_key').on(table.provider),
    index('integrations_created_by_id_idx').on(table.createdById),
    index('integrations_updated_by_id_idx').on(table.updatedById)
  ]
)

export const workspaceIntegrations = sqliteTable(
  'workspace_integrations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    metadata: text('metadata', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    config: text('config', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    actorId: integer('actor_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    apiTokenId: integer('api_token_id')
      .notNull()
      .references((): AnySQLiteColumn => apiTokens.id, { onDelete: 'cascade' }),
    integrationId: integer('integration_id')
      .notNull()
      .references((): AnySQLiteColumn => integrations.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('workspace_integrations_metadata_json', sql`json_valid(${table.metadata})`),
    check('workspace_integrations_config_json', sql`json_valid(${table.config})`),
    uniqueIndex('workspace_integrations_workspace_id_integration_id_unique').on(table.workspaceId, table.integrationId),
    uniqueIndex('workspace_integrations_id_workspace_id_unique').on(table.id, table.workspaceId),
    index('workspace_integrations_actor_id_idx').on(table.actorId),
    index('workspace_integrations_api_token_id_idx').on(table.apiTokenId),
    index('workspace_integrations_created_by_id_idx').on(table.createdById),
    index('workspace_integrations_integration_id_idx').on(table.integrationId),
    index('workspace_integrations_updated_by_id_idx').on(table.updatedById),
    index('workspace_integrations_workspace_id_idx').on(table.workspaceId)
  ]
)

export const githubRepositories = sqliteTable(
  'github_repositories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    name: text('name', { length: 500 }).notNull(),
    url: text('url', { length: 200 }),
    config: text('config', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    repositoryId: integer('repository_id').notNull(),
    owner: text('owner', { length: 500 }).notNull(),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('github_repositories_config_json', sql`json_valid(${table.config})`),
    uniqueIndex('github_repositories_id_project_id_unique').on(table.id, table.projectId),
    foreignKey({
      name: 'github_repositories_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('github_repositories_created_by_id_idx').on(table.createdById),
    index('github_repositories_project_id_idx').on(table.projectId),
    index('github_repositories_updated_by_id_idx').on(table.updatedById),
    index('github_repositories_workspace_id_idx').on(table.workspaceId)
  ]
)

export const githubRepositorySyncs = sqliteTable(
  'github_repository_syncs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    credentials: text('credentials', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    actorId: integer('actor_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    labelId: integer('label_id').references((): AnySQLiteColumn => labels.id, { onDelete: 'set null' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    repositoryId: integer('repository_id')
      .notNull()
      .references((): AnySQLiteColumn => githubRepositories.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    workspaceIntegrationId: integer('workspace_integration_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaceIntegrations.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('github_repository_syncs_credentials_json', sql`json_valid(${table.credentials})`),
    uniqueIndex('github_repository_syncs_project_id_repository_id_unique').on(table.projectId, table.repositoryId),
    uniqueIndex('github_repository_syncs_repository_id_key').on(table.repositoryId),
    uniqueIndex('github_repository_syncs_id_project_id_unique').on(table.id, table.projectId),
    foreignKey({
      name: 'github_repository_syncs_label_id_workspace_id_fk',
      columns: [table.labelId, table.workspaceId],
      foreignColumns: [labels.id, labels.workspaceId]
    }),
    foreignKey({
      name: 'github_repository_syncs_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    foreignKey({
      name: 'github_repository_syncs_repository_id_project_id_fk',
      columns: [table.repositoryId, table.projectId],
      foreignColumns: [githubRepositories.id, githubRepositories.projectId]
    }),
    foreignKey({
      name: 'github_repository_syncs_workspace_integration_id_workspace_id_fk',
      columns: [table.workspaceIntegrationId, table.workspaceId],
      foreignColumns: [workspaceIntegrations.id, workspaceIntegrations.workspaceId]
    }),
    index('github_repository_syncs_actor_id_idx').on(table.actorId),
    index('github_repository_syncs_created_by_id_idx').on(table.createdById),
    index('github_repository_syncs_label_id_idx').on(table.labelId),
    index('github_repository_syncs_project_id_idx').on(table.projectId),
    index('github_repository_syncs_updated_by_id_idx').on(table.updatedById),
    index('github_repository_syncs_workspace_id_idx').on(table.workspaceId),
    index('github_repository_syncs_workspace_integration_id_idx').on(table.workspaceIntegrationId)
  ]
)

export const githubIssueSyncs = sqliteTable(
  'github_issue_syncs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    repoIssueId: integer('repo_issue_id').notNull(),
    githubIssueId: integer('github_issue_id').notNull(),
    issueUrl: text('issue_url', { length: 200 }).notNull(),
    issueId: integer('issue_id')
      .notNull()
      .references((): AnySQLiteColumn => issues.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    repositorySyncId: integer('repository_sync_id')
      .notNull()
      .references((): AnySQLiteColumn => githubRepositorySyncs.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('github_issue_syncs_repository_sync_id_issue_id_unique').on(table.repositorySyncId, table.issueId),
    uniqueIndex('github_issue_syncs_id_project_id_unique').on(table.id, table.projectId),
    foreignKey({
      name: 'github_issue_syncs_issue_id_project_id_fk',
      columns: [table.issueId, table.projectId],
      foreignColumns: [issues.id, issues.projectId]
    }),
    foreignKey({
      name: 'github_issue_syncs_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    foreignKey({
      name: 'github_issue_syncs_repository_sync_id_project_id_fk',
      columns: [table.repositorySyncId, table.projectId],
      foreignColumns: [githubRepositorySyncs.id, githubRepositorySyncs.projectId]
    }),
    index('github_issue_syncs_created_by_id_idx').on(table.createdById),
    index('github_issue_syncs_issue_id_idx').on(table.issueId),
    index('github_issue_syncs_project_id_idx').on(table.projectId),
    index('github_issue_syncs_repository_sync_id_idx').on(table.repositorySyncId),
    index('github_issue_syncs_updated_by_id_idx').on(table.updatedById),
    index('github_issue_syncs_workspace_id_idx').on(table.workspaceId)
  ]
)

export const githubCommentSyncs = sqliteTable(
  'github_comment_syncs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    repoCommentId: integer('repo_comment_id').notNull(),
    commentId: integer('comment_id')
      .notNull()
      .references((): AnySQLiteColumn => issueComments.id, { onDelete: 'cascade' }),
    issueSyncId: integer('issue_sync_id')
      .notNull()
      .references((): AnySQLiteColumn => githubIssueSyncs.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('github_comment_syncs_issue_sync_id_comment_id_unique').on(table.issueSyncId, table.commentId),
    foreignKey({
      name: 'github_comment_syncs_comment_id_project_id_fk',
      columns: [table.commentId, table.projectId],
      foreignColumns: [issueComments.id, issueComments.projectId]
    }),
    foreignKey({
      name: 'github_comment_syncs_issue_sync_id_project_id_fk',
      columns: [table.issueSyncId, table.projectId],
      foreignColumns: [githubIssueSyncs.id, githubIssueSyncs.projectId]
    }),
    foreignKey({
      name: 'github_comment_syncs_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('github_comment_syncs_comment_id_idx').on(table.commentId),
    index('github_comment_syncs_created_by_id_idx').on(table.createdById),
    index('github_comment_syncs_issue_sync_id_idx').on(table.issueSyncId),
    index('github_comment_syncs_project_id_idx').on(table.projectId),
    index('github_comment_syncs_updated_by_id_idx').on(table.updatedById),
    index('github_comment_syncs_workspace_id_idx').on(table.workspaceId)
  ]
)

export const slackProjectSyncs = sqliteTable(
  'slack_project_syncs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    accessToken: text('access_token', { length: 300 }).notNull(),
    scopes: text('scopes').notNull(),
    botUserId: text('bot_user_id', { length: 50 }).notNull(),
    webhookUrl: text('webhook_url', { length: 1000 }).notNull(),
    data: text('data', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    teamId: text('team_id', { length: 30 }).notNull(),
    teamName: text('team_name', { length: 300 }).notNull(),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    workspaceIntegrationId: integer('workspace_integration_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaceIntegrations.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('slack_project_syncs_data_json', sql`json_valid(${table.data})`),
    uniqueIndex('slack_project_syncs_team_id_project_id_unique').on(table.teamId, table.projectId),
    foreignKey({
      name: 'slack_project_syncs_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    foreignKey({
      name: 'slack_project_syncs_workspace_integration_id_workspace_id_fk',
      columns: [table.workspaceIntegrationId, table.workspaceId],
      foreignColumns: [workspaceIntegrations.id, workspaceIntegrations.workspaceId]
    }),
    index('slack_project_syncs_created_by_id_idx').on(table.createdById),
    index('slack_project_syncs_project_id_idx').on(table.projectId),
    index('slack_project_syncs_updated_by_id_idx').on(table.updatedById),
    index('slack_project_syncs_workspace_id_idx').on(table.workspaceId),
    index('slack_project_syncs_workspace_integration_id_idx').on(table.workspaceIntegrationId)
  ]
)

export const webhooks = sqliteTable(
  'webhooks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    url: text('url', { length: 1024 }).notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    secretKey: text('secret_key', { length: 255 }).notNull(),
    project: integer('project', { mode: 'boolean' }).notNull().default(false),
    issue: integer('issue', { mode: 'boolean' }).notNull().default(false),
    module: integer('module', { mode: 'boolean' }).notNull().default(false),
    cycle: integer('cycle', { mode: 'boolean' }).notNull().default(false),
    issueComment: integer('issue_comment', { mode: 'boolean' }).notNull().default(false),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at'),
    isInternal: integer('is_internal', { mode: 'boolean' }).notNull().default(false),
    version: text('version', { length: 50 }).notNull().default('v1')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('webhooks_workspace_id_url_deleted_at_unique').on(table.workspaceId, table.url, table.deletedAt),
    uniqueIndex('webhooks_id_workspace_id_unique').on(table.id, table.workspaceId),
    uniqueIndex('webhook_url_unique_url_when_deleted_at_null')
      .on(table.workspaceId, table.url)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('webhooks_created_by_id_idx').on(table.createdById),
    index('webhooks_updated_by_id_idx').on(table.updatedById),
    index('webhooks_workspace_id_idx').on(table.workspaceId)
  ]
)

export const projectWebhooks = sqliteTable(
  'project_webhooks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    deletedAt: timestamp('deleted_at'),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    webhookId: integer('webhook_id')
      .notNull()
      .references((): AnySQLiteColumn => webhooks.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' })
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('project_webhooks_project_id_webhook_id_deleted_at_unique').on(
      table.projectId,
      table.webhookId,
      table.deletedAt
    ),
    foreignKey({
      name: 'project_webhooks_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    foreignKey({
      name: 'project_webhooks_webhook_id_workspace_id_fk',
      columns: [table.webhookId, table.workspaceId],
      foreignColumns: [webhooks.id, webhooks.workspaceId]
    }),
    uniqueIndex('project_webhook_unique_project_webhook_when_deleted_at_null')
      .on(table.projectId, table.webhookId)
      .where(sql`(${table.deletedAt} IS NULL)`),
    index('project_webhooks_created_by_id_idx').on(table.createdById),
    index('project_webhooks_project_id_idx').on(table.projectId),
    index('project_webhooks_updated_by_id_idx').on(table.updatedById),
    index('project_webhooks_webhook_id_idx').on(table.webhookId),
    index('project_webhooks_workspace_id_idx').on(table.workspaceId)
  ]
)

export const webhookLogs = sqliteTable(
  'webhook_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    eventType: text('event_type', { length: 255 }),
    requestMethod: text('request_method', { length: 10 }),
    requestHeaders: text('request_headers'),
    requestBody: text('request_body'),
    responseStatus: text('response_status'),
    responseHeaders: text('response_headers'),
    responseBody: text('response_body'),
    retryCount: integer('retry_count').notNull().default(0),
    webhook: integer('webhook').notNull(),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('webhook_logs_retry_count_check', sql`${table.retryCount} >= 0`),
    index('webhook_logs_created_by_id_idx').on(table.createdById),
    index('webhook_logs_updated_by_id_idx').on(table.updatedById),
    index('webhook_logs_workspace_id_idx').on(table.workspaceId)
  ]
)

export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    token: text('token', { length: 255 }).notNull(),
    label: text('label', { length: 255 }).notNull(),
    userType: integer('user_type').notNull().default(0),
    userId: integer('user_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id').references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    description: text('description').notNull().default(''),
    expiredAt: timestamp('expired_at'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    lastUsed: timestamp('last_used'),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('api_tokens_user_type_values', sql`${table.userType} in (0, 1)`),
    check('api_tokens_user_type_check', sql`${table.userType} >= 0`),
    uniqueIndex('api_tokens_token_key').on(table.token),
    index('api_tokens_created_by_id_idx').on(table.createdById),
    index('api_tokens_updated_by_id_idx').on(table.updatedById),
    index('api_tokens_user_id_idx').on(table.userId),
    index('api_tokens_workspace_id_idx').on(table.workspaceId)
  ]
)

export const apiActivityLogs = sqliteTable(
  'api_activity_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    tokenIdentifier: text('token_identifier', { length: 255 }).notNull(),
    path: text('path', { length: 255 }).notNull(),
    method: text('method', { length: 10 }).notNull(),
    queryParams: text('query_params'),
    headers: text('headers'),
    body: text('body'),
    responseCode: integer('response_code').notNull(),
    responseBody: text('response_body'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent', { length: 512 }),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('api_activity_logs_response_code_check', sql`${table.responseCode} >= 0`),
    index('api_activity_logs_created_by_id_idx').on(table.createdById),
    index('api_activity_logs_updated_by_id_idx').on(table.updatedById)
  ]
)

export const importers = sqliteTable(
  'importers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    service: text('service', { length: 50, enum: ['github', 'jira'] }).notNull(),
    status: text('status', { length: 50, enum: ['queued', 'processing', 'completed', 'failed'] })
      .notNull()
      .default('queued'),
    metadata: text('metadata', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    config: text('config', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    data: text('data', { mode: 'json' }).$type<JsonValue>().notNull().default({}),
    initiatedById: integer('initiated_by_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    tokenId: integer('token_id')
      .notNull()
      .references((): AnySQLiteColumn => apiTokens.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    importedData: text('imported_data', { mode: 'json' }).$type<JsonValue>(),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('importers_service_values', sql`${table.service} in ('github', 'jira')`),
    check('importers_status_values', sql`${table.status} in ('queued', 'processing', 'completed', 'failed')`),
    check('importers_metadata_json', sql`json_valid(${table.metadata})`),
    check('importers_config_json', sql`json_valid(${table.config})`),
    check('importers_data_json', sql`json_valid(${table.data})`),
    check('importers_imported_data_json', sql`json_valid(${table.importedData}) or ${table.importedData} is null`),
    foreignKey({
      name: 'importers_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('importers_created_by_id_idx').on(table.createdById),
    index('importers_initiated_by_id_idx').on(table.initiatedById),
    index('importers_project_id_idx').on(table.projectId),
    index('importers_token_id_idx').on(table.tokenId),
    index('importers_updated_by_id_idx').on(table.updatedById),
    index('importers_workspace_id_idx').on(table.workspaceId)
  ]
)

export const exporters = sqliteTable(
  'exporters',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    project: text('project', { mode: 'json' }).$type<number[]>(),
    provider: text('provider', { length: 50, enum: ['json', 'csv', 'xlsx'] }).notNull(),
    status: text('status', { length: 50, enum: ['queued', 'processing', 'completed', 'failed'] })
      .notNull()
      .default('queued'),
    reason: text('reason').notNull().default(''),
    key: text('key').notNull().default(''),
    url: text('url', { length: 800 }),
    token: text('token', { length: 255 }).notNull(),
    initiatedById: integer('initiated_by_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    filters: text('filters', { mode: 'json' }).$type<JsonValue>(),
    name: text('name', { length: 255 }),
    type: text('type', { length: 50, enum: ['issue_exports', 'issue_worklogs'] })
      .notNull()
      .default('issue_exports'),
    deletedAt: timestamp('deleted_at'),
    richFilters: text('rich_filters', { mode: 'json' }).$type<JsonValue>().default({})
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check(
      'exporters_project_json',
      sql`json_valid(${table.project}) and json_type(${table.project}) = 'array' or ${table.project} is null`
    ),
    check('exporters_provider_values', sql`${table.provider} in ('json', 'csv', 'xlsx')`),
    check('exporters_status_values', sql`${table.status} in ('queued', 'processing', 'completed', 'failed')`),
    check('exporters_filters_json', sql`json_valid(${table.filters}) or ${table.filters} is null`),
    check('exporters_type_values', sql`${table.type} in ('issue_exports', 'issue_worklogs')`),
    check('exporters_rich_filters_json', sql`json_valid(${table.richFilters}) or ${table.richFilters} is null`),
    uniqueIndex('exporters_token_key').on(table.token),
    index('exporters_created_by_id_idx').on(table.createdById),
    index('exporters_initiated_by_id_idx').on(table.initiatedById),
    index('exporters_updated_by_id_idx').on(table.updatedById),
    index('exporters_workspace_id_idx').on(table.workspaceId)
  ]
)
