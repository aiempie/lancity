import { z } from 'zod'

const id = z.coerce.number().int().positive().safe()

/** Formats of `DataExporter.FORMATTERS` (PD-1980, PD-1986). */
export const exportProviders = ['csv', 'json', 'xlsx'] as const
export type ExportProvider = (typeof exportProviders)[number]
export const exportProviderSchema = z.enum(exportProviders)

/** Exporter statuses of `ExporterHistory.status`. */
export const jobStatuses = ['queued', 'processing', 'completed', 'failed'] as const
export type JobStatus = (typeof jobStatuses)[number]

/** Body of `POST export-issues`. Plane reads `provider`, `multiple` and `project` and accepts anything else silently. */
export const exportIssuesInputSchema = z.object({
  provider: z.string().optional(),
  multiple: z.boolean().optional().default(false),
  project: z.array(id).max(100).optional().default([])
})
export type ExportIssuesInput = z.output<typeof exportIssuesInputSchema>

/** Payload of the `export.issues` job. Ids only, the job reloads everything it needs. */
export type ExportIssuesPayload = {
  exportId: number
  token: string
  provider: string
  workspaceId: number
  slug: string
  projectIds: number[]
  multiple: boolean
}

/** Sort keys of `EXPORTER_HISTORY_ORDER_BY_ALLOWLIST`. */
export const exporterHistoryOrderByAllowlist = new Set(['created_at', 'updated_at'])

export const importSources = ['file', 'plane'] as const
export type ImportSource = (typeof importSources)[number]
export const importFormats = ['csv', 'json', 'xlsx'] as const
export type ImportFormat = (typeof importFormats)[number]

/** Text fields of the multipart import request. The `file` part is read separately. */
export const importIssuesFieldsSchema = z.object({
  source: z.enum(importSources).optional().default('file')
})
export type ImportIssuesFields = z.output<typeof importIssuesFieldsSchema>

/** Payload of the `import.issues` job. `offset` is the first row the job has not handled yet. */
export type ImportIssuesPayload = { importId: number; offset?: number }

export const importListQuerySchema = z.object({
  per_page: z.string().optional(),
  cursor: z.string().optional()
})

/** Largest accepted import upload and row count (one D1 batch per row keeps a run well under Worker limits). */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024
export const MAX_IMPORT_ROWS = 5000

type Named = { name: string }
type IssueRef = { sequenceId: number; project: { identifier: string } }

/**
 * One issue with every relation the export reads, the object graph Plane's `select_related` and
 * `prefetch_related` build in `issue_export_task`.
 */
export type IssueExportRecord = {
  id: number
  name: string
  descriptionStripped: string | null
  priority: string
  startDate: string | null
  targetDate: string | null
  sequenceId: number
  createdAt: Date | null
  updatedAt: Date | null
  completedAt: Date | null
  archivedAt: string | null
  isDraft: boolean
  projectId: number
  workspace: { slug: string }
  project: { id: number; name: string; identifier: string }
  state: Named | null
  createdBy: Named | null
  estimatePoint: { value: string } | null
  parent: IssueRef | null
  labels: Named[]
  assignees: Named[]
  subscribers: Named[]
  cycles: { createdAt: Date | null; cycle: { name: string; startDate: Date | null; endDate: Date | null } }[]
  modules: Named[]
  links: { url: string; title: string | null }[]
  /** Outgoing relations (`issue_relation`). */
  relations: { relationType: string; relatedIssue: IssueRef }[]
  /** Incoming relations (`issue_related`). */
  related: { relationType: string; issue: IssueRef }[]
  comments: { commentStripped: string; createdAt: Date | null; actor: Named | null }[]
  attachmentIds: number[]
}
