import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import {
  apiActivityLogs,
  apiTokens,
  exporters,
  githubCommentSyncs,
  githubIssueSyncs,
  githubRepositories,
  githubRepositorySyncs,
  importers,
  integrations,
  projectWebhooks,
  slackProjectSyncs,
  webhookLogs,
  webhooks,
  workspaceIntegrations
} from '@/db/schema/integration'
import { jsonValueSchema } from '@/types/database/schema'

const integrationFields = {
  network: () => z.literal([1, 2]),
  description: () => jsonValueSchema,
  metadata: () => jsonValueSchema
}
export const integrationSchema = createSelectSchema(integrations, integrationFields).strict()
export const integrationInsertSchema = createInsertSchema(integrations, integrationFields).omit({ id: true }).strict()
export type Integration = z.infer<typeof integrationSchema>
export type IntegrationInsert = z.infer<typeof integrationInsertSchema>

const workspaceIntegrationFields = {
  metadata: () => jsonValueSchema,
  config: () => jsonValueSchema
}
export const workspaceIntegrationSchema = createSelectSchema(workspaceIntegrations, workspaceIntegrationFields).strict()
export const workspaceIntegrationInsertSchema = createInsertSchema(workspaceIntegrations, workspaceIntegrationFields)
  .omit({ id: true })
  .strict()
export type WorkspaceIntegration = z.infer<typeof workspaceIntegrationSchema>
export type WorkspaceIntegrationInsert = z.infer<typeof workspaceIntegrationInsertSchema>

const githubRepositorieFields = {
  config: () => jsonValueSchema
}
export const githubRepositorieSchema = createSelectSchema(githubRepositories, githubRepositorieFields).strict()
export const githubRepositorieInsertSchema = createInsertSchema(githubRepositories, githubRepositorieFields)
  .omit({ id: true })
  .strict()
export type GithubRepositorie = z.infer<typeof githubRepositorieSchema>
export type GithubRepositorieInsert = z.infer<typeof githubRepositorieInsertSchema>

const githubRepositorySyncFields = {
  credentials: () => jsonValueSchema
}
export const githubRepositorySyncSchema = createSelectSchema(githubRepositorySyncs, githubRepositorySyncFields).strict()
export const githubRepositorySyncInsertSchema = createInsertSchema(githubRepositorySyncs, githubRepositorySyncFields)
  .omit({ id: true })
  .strict()
export type GithubRepositorySync = z.infer<typeof githubRepositorySyncSchema>
export type GithubRepositorySyncInsert = z.infer<typeof githubRepositorySyncInsertSchema>

export const githubIssueSyncSchema = createSelectSchema(githubIssueSyncs).strict()
export const githubIssueSyncInsertSchema = createInsertSchema(githubIssueSyncs).omit({ id: true }).strict()
export type GithubIssueSync = z.infer<typeof githubIssueSyncSchema>
export type GithubIssueSyncInsert = z.infer<typeof githubIssueSyncInsertSchema>

export const githubCommentSyncSchema = createSelectSchema(githubCommentSyncs).strict()
export const githubCommentSyncInsertSchema = createInsertSchema(githubCommentSyncs).omit({ id: true }).strict()
export type GithubCommentSync = z.infer<typeof githubCommentSyncSchema>
export type GithubCommentSyncInsert = z.infer<typeof githubCommentSyncInsertSchema>

const slackProjectSyncFields = {
  data: () => jsonValueSchema
}
export const slackProjectSyncSchema = createSelectSchema(slackProjectSyncs, slackProjectSyncFields).strict()
export const slackProjectSyncInsertSchema = createInsertSchema(slackProjectSyncs, slackProjectSyncFields)
  .omit({ id: true })
  .strict()
export type SlackProjectSync = z.infer<typeof slackProjectSyncSchema>
export type SlackProjectSyncInsert = z.infer<typeof slackProjectSyncInsertSchema>

export const webhookSchema = createSelectSchema(webhooks).strict()
export const webhookInsertSchema = createInsertSchema(webhooks).omit({ id: true }).strict()
export type Webhook = z.infer<typeof webhookSchema>
export type WebhookInsert = z.infer<typeof webhookInsertSchema>

export const projectWebhookSchema = createSelectSchema(projectWebhooks).strict()
export const projectWebhookInsertSchema = createInsertSchema(projectWebhooks).omit({ id: true }).strict()
export type ProjectWebhook = z.infer<typeof projectWebhookSchema>
export type ProjectWebhookInsert = z.infer<typeof projectWebhookInsertSchema>

const webhookLogFields = {
  retryCount: (schema: z.ZodNumber) => schema.gte(0)
}
export const webhookLogSchema = createSelectSchema(webhookLogs, webhookLogFields).strict()
export const webhookLogInsertSchema = createInsertSchema(webhookLogs, webhookLogFields).omit({ id: true }).strict()
export type WebhookLog = z.infer<typeof webhookLogSchema>
export type WebhookLogInsert = z.infer<typeof webhookLogInsertSchema>

const apiTokenFields = {
  userType: () => z.literal([0, 1])
}
export const apiTokenSchema = createSelectSchema(apiTokens, apiTokenFields).strict()
export const apiTokenInsertSchema = createInsertSchema(apiTokens, apiTokenFields).omit({ id: true }).strict()
export type ApiToken = z.infer<typeof apiTokenSchema>
export type ApiTokenInsert = z.infer<typeof apiTokenInsertSchema>

const apiActivityLogFields = {
  responseCode: (schema: z.ZodNumber) => schema.gte(0)
}
export const apiActivityLogSchema = createSelectSchema(apiActivityLogs, apiActivityLogFields).strict()
export const apiActivityLogInsertSchema = createInsertSchema(apiActivityLogs, apiActivityLogFields)
  .omit({ id: true })
  .strict()
export type ApiActivityLog = z.infer<typeof apiActivityLogSchema>
export type ApiActivityLogInsert = z.infer<typeof apiActivityLogInsertSchema>

const importerFields = {
  metadata: () => jsonValueSchema,
  config: () => jsonValueSchema,
  data: () => jsonValueSchema,
  importedData: () => jsonValueSchema
}
export const importerSchema = createSelectSchema(importers, importerFields).strict()
export const importerInsertSchema = createInsertSchema(importers, importerFields).omit({ id: true }).strict()
export type Importer = z.infer<typeof importerSchema>
export type ImporterInsert = z.infer<typeof importerInsertSchema>

const exporterFields = {
  project: () => z.array(z.int().positive()),
  filters: () => jsonValueSchema,
  richFilters: () => jsonValueSchema
}
export const exporterSchema = createSelectSchema(exporters, exporterFields).strict()
export const exporterInsertSchema = createInsertSchema(exporters, exporterFields).omit({ id: true }).strict()
export type Exporter = z.infer<typeof exporterSchema>
export type ExporterInsert = z.infer<typeof exporterInsertSchema>

export const webhookIdSchema = z.coerce.number().int().positive().safe()
const webhookUrlSchema = z
  .url({ protocol: /^https$/ })
  .max(1024)
  .refine(value => {
    const url = new URL(value)
    return !url.username && !url.password && !url.hash
  }, 'Use an HTTPS URL without credentials or fragments')
export const webhookInputSchema = z
  .object({
    url: webhookUrlSchema,
    project: z.boolean().optional(),
    issue: z.boolean().optional(),
    module: z.boolean().optional(),
    cycle: z.boolean().optional(),
    issueComment: z.boolean().optional(),
    isActive: z.literal(false).optional()
  })
  .strict()
export const webhookUpdateSchema = webhookInputSchema.partial().refine(input => Object.keys(input).length > 0)
export type WebhookInput = z.infer<typeof webhookInputSchema>
export type WebhookUpdate = z.infer<typeof webhookUpdateSchema>
