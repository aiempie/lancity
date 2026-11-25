import { z } from 'zod'
import { jsonValueSchema } from '@/types/database/schema'

const jsonObject = z.record(z.string(), z.json())
const positiveId = z.coerce.number().int().positive().safe()

/**
 * Body of POST/PATCH of saved views (`IssueViewSerializer`). Superset of `savedViewInputSchema`:
 * `query` is optional because it is derived from `filters` (`IssueView.save`).
 */
export const viewInputSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    description: z.string().optional(),
    query: jsonValueSchema.optional(),
    filters: jsonObject.optional(),
    display_filters: jsonObject.optional(),
    display_properties: jsonObject.optional(),
    rich_filters: jsonObject.optional(),
    logo_props: jsonObject.optional(),
    sort_order: z.number().finite().optional(),
    access: z.literal([0, 1]).default(1)
  })
  .strict()
export const viewUpdateSchema = viewInputSchema
  .partial()
  .extend({ access: z.literal([0, 1]).optional() })
  .strict()
  .refine(value => Object.keys(value).length > 0)
export type ViewInput = z.input<typeof viewInputSchema> & { access?: 0 | 1 }
export type ViewUpdate = z.output<typeof viewUpdateSchema>

/** Query string of the view lists: `fields=a,b` and `order_by` (`VIEW_ORDER_BY_ALLOWLIST`). */
export const viewListQuerySchema = z.object({ fields: z.string().optional(), order_by: z.string().optional() })
export type ViewListQuery = z.output<typeof viewListQuerySchema>

/** Body of `POST /user-favorite-views`. */
export const viewFavoriteInputSchema = z.object({ view: positiveId }).strict()
export type ViewFavoriteInput = z.output<typeof viewFavoriteInputSchema>

/** Query string of the global search (`GlobalSearchEndpoint`). */
export const GLOBAL_SEARCH_ENTITIES = [
  'workspace',
  'project',
  'issue',
  'cycle',
  'module',
  'issue_view',
  'page',
  'intake'
] as const
export type GlobalSearchEntity = (typeof GLOBAL_SEARCH_ENTITIES)[number]
export const globalSearchQuerySchema = z.object({
  search: z.string().max(200).optional(),
  entities: z.string().optional(),
  workspace_search: z.string().optional(),
  project_id: z.string().optional()
})
export type GlobalSearchQuery = z.output<typeof globalSearchQuerySchema>

/** Query string of `entity-search` (`SearchEndpoint`). */
export const ENTITY_SEARCH_TYPES = ['user_mention', 'project', 'issue', 'cycle', 'module', 'page'] as const
export const entitySearchQuerySchema = z.object({
  query: z.string().max(200).optional(),
  query_type: z.string().optional(),
  count: z.string().optional(),
  project_id: z.string().optional()
})
export type EntitySearchQuery = z.output<typeof entitySearchQuerySchema>

/** Query string of `search-issues` (`IssueSearchEndpoint`). Values stay raw strings like Plane's. */
export const issueSearchQuerySchema = z.object({
  search: z.string().max(200).optional(),
  workspace_search: z.string().optional(),
  parent: z.string().optional(),
  issue_relation: z.string().optional(),
  cycle: z.string().optional(),
  module: z.string().optional(),
  sub_issue: z.string().optional(),
  target_date: z.string().optional(),
  issue_id: z.string().optional()
})
export type IssueSearchQuery = z.output<typeof issueSearchQuerySchema>
