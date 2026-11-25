import { z } from 'zod'
import { webhookInputSchema } from '@/types/integration/schema'

// ------------------------------------------------------------------ API tokens (Plane `ApiTokenEndpoint`)

export const apiTokenIdSchema = z.coerce.number().int().positive().safe()

/** POST body. Plane reads `label`, `description` and `expired_at` straight from `request.data`. */
export const apiTokenCreateSchema = z
  .object({
    workspaceId: z.number().int().positive().safe(),
    label: z.string().trim().min(1).max(255).optional(),
    description: z.string().max(5000).optional(),
    expiredAt: z.coerce.date().nullable().optional()
  })
  .strict()

/** PATCH body. `APITokenSerializer` makes every other field read only. */
export const apiTokenUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(255).optional(),
    description: z.string().max(5000).optional()
  })
  .strict()
  .refine(input => Object.keys(input).length > 0, 'Provide at least one field')

export type ApiTokenCreate = z.infer<typeof apiTokenCreateSchema>
export type ApiTokenUpdate = z.infer<typeof apiTokenUpdateSchema>

// ------------------------------------------------------------------ Webhooks

/** Same as `webhookInputSchema` but lets an admin turn a webhook on (`is_active`) after it was created inactive. */
export const webhookPatchSchema = webhookInputSchema
  .extend({ isActive: z.boolean().optional() })
  .partial()
  .refine(input => Object.keys(input).length > 0, 'Provide at least one field')
export type WebhookPatch = z.infer<typeof webhookPatchSchema>

export const webhookLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  before: z.coerce.number().int().positive().optional()
})
export type WebhookLogQuery = z.infer<typeof webhookLogQuerySchema>

/** Events that Plane's `webhook_activity` knows. Each maps to one boolean flag of the webhook. */
export const webhookEventSchema = z.enum([
  'project',
  'issue',
  'module',
  'module_issue',
  'cycle',
  'cycle_issue',
  'issue_comment'
])
export type WebhookEvent = z.infer<typeof webhookEventSchema>

const id = z.number().int().positive()
const jsonBlob = z.union([z.string(), z.record(z.string(), z.unknown()), z.null()]).optional()

/** `webhook.model_activity` (Plane `model_activity`). Keys keep Plane's snake_case names, ids are numbers. */
export const modelActivityJobSchema = z.object({
  model_name: z.string().min(1),
  model_id: id,
  requested_data: jsonBlob,
  current_instance: jsonBlob,
  actor_id: id,
  slug: z.string().min(1)
})
export type ModelActivityJob = z.infer<typeof modelActivityJobSchema>

/** `webhook.activity` (Plane `webhook_activity`). */
export const webhookActivityJobSchema = z.object({
  event: z.string().min(1),
  verb: z.string().min(1),
  field: z.string().nullable().optional(),
  old_value: z.unknown().optional(),
  new_value: z.unknown().optional(),
  actor_id: id,
  slug: z.string().min(1),
  event_id: id,
  old_identifier: z.union([z.string(), z.number()]).nullable().optional(),
  new_identifier: z.union([z.string(), z.number()]).nullable().optional()
})
export type WebhookActivityJob = z.infer<typeof webhookActivityJobSchema>

/** `webhook.send` (Plane `webhook_send_task`). `retryCount` replaces Celery's `request.retries`. */
export const webhookSendJobSchema = z.object({
  webhookId: id,
  slug: z.string().min(1),
  event: z.string().min(1),
  /** Absent when the data was too large for a Queue message; the task then reloads it from `eventRef`. */
  eventData: z.unknown().optional(),
  eventRef: z.object({ event: z.string(), id }).optional(),
  action: z.string().min(1),
  currentSite: z.string().default(''),
  activity: z.record(z.string(), z.unknown()).nullable().optional(),
  deliveryId: z.string().min(1).optional(),
  retryCount: z.number().int().min(0).default(0)
})
export type WebhookSendJob = z.input<typeof webhookSendJobSchema>

/** `webhook.deactivation_email` (Plane `send_webhook_deactivation_email`). */
export const webhookDeactivationEmailJobSchema = z.object({
  webhookId: id,
  receiverId: id,
  currentSite: z.string().default(''),
  reason: z.string().default('')
})
export type WebhookDeactivationEmailJob = z.input<typeof webhookDeactivationEmailJobSchema>

/** `webhook.dispatch` sent by the issue activity job when `webhook: true`. */
export const webhookDispatchJobSchema = z.object({
  source: z.string().optional(),
  type: z.string().min(1),
  issueId: id.nullable().optional(),
  projectId: id,
  workspaceId: id,
  actorId: id.nullable().optional(),
  activityIds: z.array(id).max(500).default([])
})
export type WebhookDispatchJob = z.infer<typeof webhookDispatchJobSchema>

// ------------------------------------------------------------------ External tools (AI assistant, Unsplash)

export const aiAssistantSchema = z
  .object({
    task: z.string().trim().min(1, 'Task is required').max(20_000),
    prompt: z.string().max(100_000).optional()
  })
  .strict()
export type AiAssistantInput = z.infer<typeof aiAssistantSchema>

export const unsplashQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  per_page: z.coerce.number().int().min(1).max(30).default(20)
})
export type UnsplashQuery = z.infer<typeof unsplashQuerySchema>
