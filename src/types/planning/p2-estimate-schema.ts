import { z } from 'zod'
import { estimatePointInputSchema, updateEstimateInputSchema } from '@/types/planning/schema'

const id = z.number().int().positive().safe()

/** Plane `BulkEstimatePointEndpoint.create`: the estimate name is optional and defaults to a random one. */
export const bulkCreateEstimateInputSchema = z
  .object({
    estimate: z
      .object({
        name: z.string().trim().min(1).max(255).optional(),
        description: z.string().default(''),
        type: z.enum(['categories', 'points']).default('categories'),
        last_used: z.boolean().default(false)
      })
      .strict(),
    estimate_points: z.array(estimatePointInputSchema).max(100).default([])
  })
  .strict()
export type BulkCreateEstimateInput = z.output<typeof bulkCreateEstimateInputSchema>

/** Plane `BulkEstimatePointEndpoint.partial_update`: points are required, `id` selects the point to change. */
export const bulkUpdateEstimateInputSchema = z
  .object({
    estimate: z
      .object({ name: z.string().trim().min(1).max(255).optional(), type: z.enum(['categories', 'points']).optional() })
      .strict()
      .optional(),
    estimate_points: z
      .array(
        z
          .object({
            id,
            key: z.number().int().min(0).optional(),
            value: z.string().min(1).max(20).optional()
          })
          .strict()
      )
      .min(1, 'Estimate points are required')
      .max(100)
  })
  .strict()
export type BulkUpdateEstimateInput = z.output<typeof bulkUpdateEstimateInputSchema>

/** PATCH body of one estimate: either the name/description form or the bulk points form. */
export const patchEstimateInputSchema = z.union([bulkUpdateEstimateInputSchema, updateEstimateInputSchema])

/** Plane `EstimatePointEndpoint.create`: Plane rejects a falsy key or value, so `key` starts at 1. */
export const createEstimatePointInputSchema = z
  .object({
    key: z.number().int().min(1),
    value: z.string().min(1).max(255),
    description: z.string().default('')
  })
  .strict()
export type CreateEstimatePointInput = z.output<typeof createEstimatePointInputSchema>

/** Body of POST `/estimates/:id/estimate-points`: a single point or the bulk forms of the API. */
export const createEstimatePointsInputSchema = z.union([
  createEstimatePointInputSchema,
  z.array(estimatePointInputSchema).min(1).max(100),
  z.object({ estimate_points: z.array(estimatePointInputSchema).min(1).max(100) }).strict()
])

/** Plane `EstimatePointEndpoint.destroy`: `new_estimate_id` is the point that takes over the issues. */
export const deleteEstimatePointInputSchema = z.object({ new_estimate_id: id.nullable().optional() }).strict()
export type DeleteEstimatePointInput = z.output<typeof deleteEstimatePointInputSchema>
