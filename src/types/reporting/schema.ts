import { z } from 'zod'
import { jsonValueSchema } from '@/types/database/schema'

export const reportingIdSchema = z.coerce.number().int().positive().safe()
export const stickyInputSchema = z
  .object({
    name: z.string().max(255).nullable().optional(),
    description: jsonValueSchema.optional(),
    description_html: z.string().optional(),
    color: z.string().max(255).nullable().optional(),
    background_color: z.string().max(255).nullable().optional()
  })
  .strict()
export const stickyUpdateSchema = stickyInputSchema.refine(x => Object.keys(x).length > 0)
export const savedViewInputSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    description: z.string().optional(),
    query: jsonValueSchema,
    access: z.literal([0, 1]).default(1)
  })
  .strict()
export const savedViewUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().optional(),
    query: jsonValueSchema.optional(),
    access: z.literal([0, 1]).optional()
  })
  .strict()
  .refine(x => Object.keys(x).length > 0)
export const searchQuerySchema = z.string().trim().min(1).max(200)
export type StickyInput = z.output<typeof stickyInputSchema>
export type SavedViewInput = z.output<typeof savedViewInputSchema>
export type SavedViewUpdate = z.output<typeof savedViewUpdateSchema>
