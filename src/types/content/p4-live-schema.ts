import { z } from 'zod'
import { contentIdSchema } from '@/types/content/schema'

/** Plane `convertDocumentSchema` (apps/live document.controller.ts). */
export const convertDocumentBodySchema = z
  .object({
    description_html: z
      .string()
      .min(1, 'HTML content cannot be empty')
      .refine(html => html.trim().length > 0, 'HTML content cannot be just whitespace')
      .refine(html => html.includes('<') && html.includes('>'), 'Content must be valid HTML'),
    variant: z.enum(['rich', 'document'])
  })
  .strict()
export type ConvertDocumentBody = z.output<typeof convertDocumentBodySchema>

/** Only user document types may open a socket (Plane `USER_DOCUMENT_TYPES`). */
export const liveDocumentTypeSchema = z.literal('project_page')
export type LiveDocumentType = z.output<typeof liveDocumentTypeSchema>

/** Query of the collaboration socket. The document name is the page id. */
export const liveConnectionQuerySchema = z
  .object({
    workspaceSlug: z.string().min(1).max(255),
    documentType: liveDocumentTypeSchema,
    pageId: contentIdSchema
  })
  .strict()
export type LiveConnectionQuery = z.output<typeof liveConnectionQuerySchema>

/** Token the Plane editor sends in the Hocuspocus auth message (`TUserDetails`: id and optional cookie). */
export const liveTokenSchema = z.object({ id: z.union([z.string(), z.number()]).transform(String) }).passthrough()

export const forceCloseReasons = [
  'critical_error',
  'memory_leak',
  'document_too_large',
  'admin_request',
  'server_shutdown',
  'security_violation',
  'corruption_detected'
] as const
export const forceCloseReasonSchema = z.enum(forceCloseReasons)

/** Body of the secret-protected admin endpoint that force closes a page (replaces the Redis admin channel). */
export const forceCloseBodySchema = z
  .object({
    page_id: contentIdSchema,
    reason: forceCloseReasonSchema.default('admin_request'),
    code: z.number().int().min(4000).max(4999).default(4000)
  })
  .strict()
export type ForceCloseBody = z.output<typeof forceCloseBodySchema>

/** Payload broadcast to every client of a page (Plane `createRealtimeEvent`). */
export const realtimeEventSchema = z
  .object({
    action: z.string().min(1).max(64),
    page_id: z.string().min(1).max(32),
    parent_id: z.string().max(32).optional(),
    descendants_ids: z.array(z.string().max(32)).max(500).default([]),
    data: z.record(z.string(), z.unknown()).default({}),
    workspace_slug: z.string().max(255).default(''),
    project_id: z.string().max(32).optional(),
    teamspace_id: z.string().max(32).optional(),
    user_id: z.string().max(32).default('')
  })
  .strict()
export type RealtimeEvent = z.output<typeof realtimeEventSchema>

/** Trusted headers the Worker adds when it forwards an authorized socket to the Durable Object. */
export const liveContextHeaders = {
  userId: 'x-live-user-id',
  userName: 'x-live-user-name',
  workspaceSlug: 'x-live-workspace-slug',
  projectId: 'x-live-project-id',
  pageId: 'x-live-page-id',
  readOnly: 'x-live-read-only'
} as const

/** Per-connection context kept in the WebSocket attachment (survives Durable Object hibernation). */
export type LiveConnectionContext = {
  userId: number
  userName: string
  workspaceSlug: string
  projectId: number
  pageId: number
  readOnly: boolean
  authenticated: boolean
  awarenessIds: number[]
}
