import { z } from 'zod'

const id = z.coerce.number().int().positive().safe()
/** `YYYY-MM-DD` or an ISO 8601 datetime. The service converts it with the project timezone (Plane `convert_to_utc`). */
const cycleDay = z.union([z.iso.date(), z.iso.datetime({ offset: true })])
const externalText = z.string().trim().min(1).max(255).nullable().optional()
const jsonObject = z.record(z.string(), z.unknown())

export const CYCLE_VIEWS = ['all', 'current', 'upcoming', 'completed', 'draft', 'incomplete'] as const
export type CycleView = (typeof CYCLE_VIEWS)[number]

/** Query string of the cycle list endpoints. Unknown `cycle_view` values behave like `all`, as in Plane. */
export const cycleListQuerySchema = z.object({
  cycle_view: z
    .string()
    .optional()
    .transform((value): CycleView =>
      (CYCLE_VIEWS as readonly string[]).includes(value ?? '') ? (value as CycleView) : 'all'
    ),
  order_by: z.string().optional(),
  per_page: z.string().optional(),
  cursor: z.string().optional()
})
export type CycleListQuery = z.output<typeof cycleListQuerySchema>

const cycleBody = {
  name: z.string().trim().min(1).max(255),
  description: z.string().optional(),
  start_date: cycleDay.nullable().optional(),
  end_date: cycleDay.nullable().optional(),
  owned_by: id.nullable().optional(),
  external_source: externalText,
  external_id: externalText,
  timezone: z.string().min(1).max(255).optional(),
  view_props: jsonObject.optional(),
  logo_props: jsonObject.optional(),
  sort_order: z.number().finite().optional()
}

type Dated = { start_date?: string | null; end_date?: string | null }
const startsAfterEnd = (x: Dated) =>
  Boolean(x.start_date && x.end_date && Date.parse(x.start_date) > Date.parse(x.end_date))

/** Plane `CycleCreateSerializer` and the both-or-neither rule of `CycleViewSet.create`. */
export const createCycleApiInputSchema = z
  .object(cycleBody)
  .refine(x => Boolean(x.start_date) === Boolean(x.end_date), {
    message: 'Both start date and end date are either required or are to be null',
    path: ['start_date']
  })
  .refine(x => !startsAfterEnd(x), { message: 'Start date cannot exceed end date', path: ['start_date'] })

/** Plane `CycleUpdateSerializer`: partial. The service merges the dates with the stored ones. */
export const updateCycleApiInputSchema = z
  .object(cycleBody)
  .partial()
  .refine(x => Object.keys(x).length > 0, 'No changes supplied')
  .refine(x => !startsAfterEnd(x), { message: 'Start date cannot exceed end date', path: ['start_date'] })

/** Plane `CycleDateCheckEndpoint.post`. */
export const cycleDateCheckInputSchema = z.object({
  start_date: cycleDay,
  end_date: cycleDay,
  cycle_id: id.nullable().optional()
})

/** Plane `CycleFavoriteViewSet.create`: the body names the cycle. */
export const cycleFavoriteInputSchema = z.object({ cycle: id })

/** Plane `CycleUserPropertiesEndpoint.patch`. Omitted keys keep their stored value. */
export const cycleUserPropertiesInputSchema = z.object({
  filters: jsonObject.optional(),
  rich_filters: jsonObject.optional(),
  display_filters: jsonObject.optional(),
  display_properties: jsonObject.optional()
})

/** Query of `GET .../cycles/:id/analytics`: `issues` (default) or `points`. */
export const cycleAnalyticsQuerySchema = z.object({
  type: z.enum(['issues', 'points']).catch('issues').default('issues')
})

export type CreateCycleApiInput = z.output<typeof createCycleApiInputSchema>
export type UpdateCycleApiInput = z.output<typeof updateCycleApiInputSchema>
export type CycleDateCheckInput = z.output<typeof cycleDateCheckInputSchema>
export type CycleUserPropertiesInput = z.output<typeof cycleUserPropertiesInputSchema>
export type CycleAnalyticsQuery = z.output<typeof cycleAnalyticsQuerySchema>
