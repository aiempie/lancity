import { z } from 'zod'
import { jsonValueSchema } from '@/types/database/schema'

/** Request schemas of the module endpoints (Plane `ModuleWriteSerializer`, `ModuleCreateSerializer` and friends). */
export const MODULE_STATUSES = ['backlog', 'planned', 'in-progress', 'paused', 'completed', 'cancelled'] as const
export type ModuleStatus = (typeof MODULE_STATUSES)[number]

const id = z.number().int().positive().safe()
const jsonObject = z.record(z.string(), z.json())

const moduleFields = {
  name: z.string().trim().min(1).max(255),
  description: z.string(),
  description_text: jsonValueSchema.nullable(),
  description_html: jsonValueSchema.nullable(),
  start_date: z.iso.date().nullable(),
  target_date: z.iso.date().nullable(),
  status: z.enum(MODULE_STATUSES),
  lead_id: id.nullable(),
  /** Alias of `lead_id` used by the external API (`ModuleCreateSerializer.lead`). */
  lead: id.nullable(),
  member_ids: z.array(id).max(100),
  /** Alias of `member_ids` used by the external API (`ModuleCreateSerializer.members`). */
  members: z.array(id).max(100),
  view_props: jsonObject,
  sort_order: z.number().finite(),
  external_source: z.string().max(255).nullable(),
  external_id: z.string().max(255).nullable(),
  logo_props: jsonObject
}

/** PD-0035 / PD-0340 `validate`: the start date cannot be after the target date. */
function datesInOrder(value: { start_date?: string | null; target_date?: string | null }) {
  return !value.start_date || !value.target_date || value.start_date <= value.target_date
}
const DATE_MESSAGE = 'Start date cannot exceed target date'

/** Fold the API aliases into `lead_id` / `member_ids` so the service sees one shape. */
function normalizeAliases<
  T extends { lead?: number | null; members?: number[]; lead_id?: number | null; member_ids?: number[] }
>(value: T) {
  const { lead, members, ...rest } = value
  return {
    ...rest,
    ...(rest.lead_id === undefined && lead !== undefined ? { lead_id: lead } : {}),
    ...(rest.member_ids === undefined && members !== undefined ? { member_ids: members } : {})
  }
}

const updateShape = z.object(moduleFields).partial()

/** PD-0035 / PD-0340: POST and PUT body. `name` is required. */
export const moduleWriteInputSchema = updateShape
  .required({ name: true })
  .refine(datesInOrder, { message: DATE_MESSAGE, path: ['target_date'] })
  .transform(normalizeAliases)
/** PATCH body: every field optional. The service also checks the dates against the stored ones. */
export const moduleUpdateInputSchema = updateShape
  .refine(datesInOrder, { message: DATE_MESSAGE, path: ['target_date'] })
  .transform(normalizeAliases)
export type ModuleWriteInput = z.output<typeof moduleWriteInputSchema>
export type ModuleUpdateInput = z.output<typeof moduleUpdateInputSchema>

/** PD-0343 / PD-0344 `ModuleLinkSerializer.to_internal_value` and `validate_url`: prefix `http://`, then validate. */
export function normalizeModuleLinkUrl(value: string) {
  const trimmed = value.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}
export function isValidModuleLinkUrl(value: string) {
  if (value.length > 200 || /\s/.test(value)) return false
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password
  } catch {
    return false
  }
}
const moduleLinkUrl = z
  .string()
  .min(1)
  .transform(normalizeModuleLinkUrl)
  .refine(isValidModuleLinkUrl, { message: 'Invalid URL format.' })
export const moduleLinkInputSchema = z
  .object({
    url: moduleLinkUrl,
    title: z.string().trim().max(255).nullable().optional(),
    metadata: jsonObject.optional()
  })
  .strict()
export const moduleLinkUpdateInputSchema = moduleLinkInputSchema.partial()
export type ModuleLinkInput = z.output<typeof moduleLinkInputSchema>
export type ModuleLinkUpdateInput = z.output<typeof moduleLinkUpdateInputSchema>

/** PD-0684 body: only the keys that are present change. */
export const moduleUserPropertiesInputSchema = z
  .object({
    filters: jsonValueSchema.optional(),
    rich_filters: jsonValueSchema.optional(),
    display_filters: jsonValueSchema.optional(),
    display_properties: jsonValueSchema.optional()
  })
  .strip()
export type ModuleUserPropertiesInput = z.output<typeof moduleUserPropertiesInputSchema>

/** PD-0682 body. */
export const moduleFavoriteInputSchema = z.object({ module: id }).strip()

/** PD-0213 / PD-0695: issues to add to a module. */
export const moduleIssuesInputSchema = z.object({ issues: z.array(id).min(1).max(100) }).strip()
/** PD-0696: add and remove several modules of one issue. */
export const issueModulesInputSchema = z
  .object({ modules: z.array(id).max(100).default([]), removed_modules: z.array(id).max(100).default([]) })
  .strip()
export type IssueModulesInput = z.output<typeof issueModulesInputSchema>

/** Query string of the module lists (`BasePaginator` plus `fields`, `expand`). */
export const moduleListQuerySchema = z
  .object({
    cursor: z.string().optional(),
    per_page: z.string().optional(),
    order_by: z.string().optional(),
    fields: z.string().optional(),
    expand: z.string().optional()
  })
  .strip()
export type ModuleListQuery = z.output<typeof moduleListQuerySchema>

/** Plane `MODULE_ORDER_BY_ALLOWLIST` (PD-0204). */
export const MODULE_ORDER_BY_ALLOWLIST = new Set([
  'created_at',
  'updated_at',
  'name',
  'start_date',
  'target_date',
  'status',
  'sort_order'
])
