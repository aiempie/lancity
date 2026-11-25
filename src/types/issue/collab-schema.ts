import { z } from 'zod'

const positiveId = z.number().int().positive().safe()
const optionalText255 = z.string().trim().min(1).max(255).nullable().optional()
const maxHtmlLength = 10 * 1024 * 1024

/** Relation types accepted by the API. `implements`/`implemented_by` come from Plane's relation mapper. */
export const issueRelationTypes = [
  'blocking',
  'blocked_by',
  'duplicate',
  'relates_to',
  'start_after',
  'start_before',
  'finish_after',
  'finish_before',
  'implements',
  'implemented_by'
] as const
export const issueRelationCreateExtSchema = z
  .object({
    relation_type: z.enum(issueRelationTypes),
    issues: z.array(positiveId).min(1).max(50)
  })
  .strict()
  .refine(value => new Set(value.issues).size === value.issues.length)
export type IssueRelationCreateExt = z.infer<typeof issueRelationCreateExtSchema>

/** Comment access levels (Plane `IssueComment.access`). */
export const commentAccessSchema = z.enum(['INTERNAL', 'EXTERNAL'])
const commentContent = {
  comment_html: z.string().max(maxHtmlLength).optional(),
  comment_json: z.json().optional(),
  access: commentAccessSchema.optional()
}
/** `text` is the plain-text form kept for existing clients. It is mutually exclusive with `comment_html`. */
export const createRichCommentSchema = z
  .object({
    text: z.string().trim().min(1).max(10000).optional(),
    ...commentContent,
    external_id: optionalText255,
    external_source: optionalText255
  })
  .strict()
  .refine(value => (value.text === undefined) !== (value.comment_html === undefined), {
    message: 'Provide exactly one of text or comment_html'
  })
export const updateRichCommentSchema = z
  .object({ text: z.string().trim().min(1).max(10000).optional(), ...commentContent })
  .strict()
  .refine(value => Object.keys(value).length > 0, 'Provide at least one field')
  .refine(value => value.text === undefined || value.comment_html === undefined, {
    message: 'Provide only one of text or comment_html'
  })
export type CreateRichCommentInput = z.infer<typeof createRichCommentSchema>
export type UpdateRichCommentInput = z.infer<typeof updateRichCommentSchema>

export const reactionInputSchema = z.object({ reaction: z.string().trim().min(1).max(50) }).strict()
export type ReactionInput = z.infer<typeof reactionInputSchema>
export const reactionCodeParamSchema = z.string().trim().min(1).max(50)

export const issueVoteInputSchema = z.object({ vote: z.union([z.literal(1), z.literal(-1)]) }).strict()
export type IssueVoteInput = z.infer<typeof issueVoteInputSchema>

/** MIME types accepted for issue attachments (Plane `ATTACHMENT_MIME_TYPES`, document/media subset). */
export const attachmentMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/svg+xml',
  'image/webp',
  'image/tiff',
  'image/bmp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/rtf',
  'application/zip',
  'application/json',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.graphics',
  'application/vnd.visio',
  'image/x-portable-graymap',
  'image/x-portable-bitmap',
  'image/x-portable-pixmap',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/midi',
  'audio/x-midi',
  'audio/aac',
  'audio/flac',
  'audio/x-m4a',
  'video/mp4',
  'video/mpeg',
  'video/ogg',
  'video/webm'
] as const
export const createAttachmentSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    type: z.enum(attachmentMimeTypes),
    size: z.number().int().positive().safe(),
    external_id: optionalText255,
    external_source: optionalText255
  })
  .strict()
export const confirmAttachmentSchema = z.object({ is_uploaded: z.literal(true).optional() }).strict()
export type CreateAttachmentInput = z.infer<typeof createAttachmentSchema>

/** Cursor pagination shared by activity and version lists. The cursor is the id of the last row returned. */
export const collabPageQuerySchema = z.object({
  cursor: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(positiveId)
    .optional(),
  per_page: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .optional()
})
export type CollabPageQuery = z.infer<typeof collabPageQuerySchema>

export const issueHistoryQuerySchema = z.object({
  created_at__gt: z.iso
    .datetime({ offset: true })
    .transform(value => new Date(value))
    .optional(),
  activity_type: z.enum(['issue-property', 'issue-comment']).optional()
})
export type IssueHistoryQuery = z.infer<typeof issueHistoryQuerySchema>
