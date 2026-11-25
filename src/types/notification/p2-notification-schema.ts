import { z } from 'zod'
import { jsonValueSchema } from '@/types/database/schema'

const id = z.number().int().positive().safe()
const MAX_CONTENT_BYTES = 10 * 1024 * 1024

/**
 * Plane `StickySerializer` input (PD-0047). `workspace` and `owner` are read only and unknown keys are ignored,
 * like DRF. HTML sanitising and binary validation need no D1 and run in `src/server/sticky/model-rules.ts`.
 */
export const stickyApiInputSchema = z
  .object({
    name: z.string().nullable().optional(),
    description: jsonValueSchema.optional(),
    description_html: z.string().optional(),
    /** Base64 encoded Yjs document. */
    description_binary: z
      .string()
      .max(Math.ceil((MAX_CONTENT_BYTES * 4) / 3) + 4)
      .nullable()
      .optional(),
    logo_props: jsonValueSchema.optional(),
    color: z.string().max(255).nullable().optional(),
    background_color: z.string().max(255).nullable().optional(),
    sort_order: z.number().finite().optional()
  })
  .strip()
export type StickyApiInput = z.output<typeof stickyApiInputSchema>

/** Query of the sticky list: `query` filters on the stripped description; pagination follows `paginate`. */
export const stickyListQuerySchema = z.object({ query: z.string().trim().max(200).optional() }).strip()
export type StickyListQuery = z.output<typeof stickyListQuerySchema>

const jsonObject = z.record(z.string(), z.unknown())

/** Payload of the `notification.issue` job, sent by `issue.activity` (Plane `notifications` task). */
export const notificationIssueJobSchema = z.object({
  type: z.string().min(1),
  issueId: id.nullable().optional(),
  actorId: id.nullable().optional(),
  projectId: id,
  subscriber: z.boolean().default(true),
  issueActivitiesCreated: z.array(jsonObject).nullable().optional(),
  truncated: z.boolean().default(false),
  requestedData: jsonObject.nullable().optional(),
  currentInstance: jsonObject.nullable().optional()
})
export type NotificationIssueJob = z.output<typeof notificationIssueJobSchema>

/** Payload of `notification.email.send` (Plane `send_email_notification`). The data is reloaded from the logs. */
export const emailNotificationJobSchema = z.object({
  issueId: id,
  receiverId: id,
  emailNotificationIds: z.array(id).min(1).max(500)
})
export type EmailNotificationJob = z.output<typeof emailNotificationJobSchema>
