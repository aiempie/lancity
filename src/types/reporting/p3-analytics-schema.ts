import { z } from 'zod'
import { jsonValueSchema } from '@/types/database/schema'

/** Plane `VALID_ANALYTICS_FIELDS` (utils/analytics_plot.py). */
export const VALID_ANALYTICS_FIELDS = [
  'state_id',
  'state__group',
  'labels__id',
  'assignees__id',
  'estimate_point__value',
  'issue_cycle__cycle_id',
  'issue_module__module_id',
  'priority',
  'start_date',
  'target_date',
  'created_at',
  'completed_at'
] as const
export type AnalyticsField = (typeof VALID_ANALYTICS_FIELDS)[number]

/** Plane `VALID_YAXIS`. */
export const VALID_YAXIS = ['issue_count', 'estimate'] as const
export type AnalyticsYAxis = (typeof VALID_YAXIS)[number]

/** Plane `x_axis_mapper` (utils/build_chart.py). */
export const X_AXIS_MAPPER = [
  'STATES',
  'STATE_GROUPS',
  'LABELS',
  'ASSIGNEES',
  'ESTIMATE_POINTS',
  'CYCLES',
  'MODULES',
  'PRIORITY',
  'START_DATE',
  'TARGET_DATE',
  'CREATED_AT',
  'COMPLETED_AT',
  'CREATED_BY'
] as const
export type ChartAxis = (typeof X_AXIS_MAPPER)[number]

const id = z.coerce.number().int().positive().safe()
const optionalText = z.string().trim().min(1).optional()

/** Query string of the advance analytics endpoints (workspace and project). */
export const advanceAnalyticsQuerySchema = z.object({
  tab: optionalText,
  type: optionalText,
  date_filter: optionalText,
  project_ids: optionalText,
  group_by: optionalText,
  x_axis: optionalText,
  cycle_id: id.optional(),
  module_id: id.optional()
})
export type AdvanceAnalyticsQuery = z.output<typeof advanceAnalyticsQuerySchema>

/** Query string of `GET /project-stats`. */
export const projectStatsQuerySchema = z.object({ fields: z.string().optional(), project_ids: z.string().optional() })
export type ProjectStatsQuery = z.output<typeof projectStatsQuerySchema>

/** Issue filter parameters as the issue lists accept them: a string or a list of strings per key. */
export const analyticsFilterParamsSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]))

/** Body of `POST /export-analytics`: the axes plus any issue filter. Axis values are validated by the service. */
export const exportAnalyticsInputSchema = z
  .object({
    x_axis: z.string().optional(),
    y_axis: z.string().optional(),
    segment: z
      .union([z.string(), z.literal(false)])
      .nullable()
      .optional()
  })
  .catchall(z.union([z.string(), z.array(z.string()), z.number(), z.boolean(), z.null()]))
export type ExportAnalyticsInput = z.output<typeof exportAnalyticsInputSchema>

/** Writable fields of `AnalyticViewSerializer` (`workspace` and `query` are read-only). */
export const analyticViewInputSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    description: z.string().optional(),
    query_dict: z.record(z.string(), jsonValueSchema).optional()
  })
  .strict()
export const analyticViewUpdateSchema = analyticViewInputSchema.partial().strict()
export type AnalyticViewInput = z.output<typeof analyticViewInputSchema>
export type AnalyticViewUpdate = z.output<typeof analyticViewUpdateSchema>

export const analyticsIdSchema = id

/** Payloads of the background jobs (kept small: Queues allow 128 KB). */
export type AnalyticExportJob = { exportId: number }
export type AnalyticCsvEmailJob = {
  data: Record<string, unknown>[]
  headers: string[]
  keys: string[]
  email: string
  slug: string
  /** Lancity addition: owner of the file, who may download it. */
  userId: number
  workspaceId: number
}
