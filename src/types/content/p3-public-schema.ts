import { z } from 'zod'
import { attachmentMimeTypes } from '@/types/content/p2-asset-schema'

const id = z.coerce.number().int().positive().safe()

/** Plane `IssueReaction.reaction` / `CommentReaction.reaction`: a short code such as an emoji. */
export const publicReactionCodeSchema = z.string().trim().min(1).max(20)
export const publicReactionInputSchema = z.object({ reaction: publicReactionCodeSchema })
export type PublicReactionInput = z.infer<typeof publicReactionInputSchema>

/** `request.data.get("vote", 1)`; the table only stores -1 and 1. */
export const publicVoteInputSchema = z.object({
  vote: z.union([z.literal(1), z.literal(-1)]).default(1)
})
export type PublicVoteInput = z.infer<typeof publicVoteInputSchema>

/**
 * PD-1655 `_public_comment_content`: only the content is writable from a board. `text` is kept for the clients that
 * already use it. Unknown keys (actor, access, parent, ...) are dropped, never trusted.
 */
export const publicCommentInputSchema = z
  .object({
    text: z.string().trim().min(1).max(10000).optional(),
    comment_html: z.string().min(1).max(1_000_000).optional(),
    comment_json: z.record(z.string(), z.unknown()).optional()
  })
  .strict()
  .refine(value => value.text !== undefined || value.comment_html !== undefined, {
    message: 'text or comment_html is required'
  })
export type PublicCommentInput = z.infer<typeof publicCommentInputSchema>

const priority = z.enum(['low', 'medium', 'high', 'urgent', 'none'], { error: 'Invalid priority' })

/** PD-1649 body of `IntakeIssuePublicViewSet.create`. */
export const publicIntakeCreateSchema = z.object({
  issue: z.object({
    name: z.string().trim().min(1, 'Name is required').max(255),
    description_html: z.string().max(1_000_000).optional(),
    description_json: z.record(z.string(), z.unknown()).optional(),
    priority: priority.optional()
  })
})
export type PublicIntakeCreateInput = z.infer<typeof publicIntakeCreateSchema>

/** PD-1650 body of `IntakeIssuePublicViewSet.partial_update`: only name and description are editable. */
export const publicIntakeUpdateSchema = z.object({
  issue: z
    .object({
      name: z.string().trim().min(1).max(255).optional(),
      description_html: z.string().max(1_000_000).optional(),
      description_json: z.record(z.string(), z.unknown()).optional()
    })
    .default({})
})
export type PublicIntakeUpdateInput = z.infer<typeof publicIntakeUpdateSchema>

/** Only raster images may be uploaded from a board (PD-1629). */
export const publicAssetTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'image/gif'] as const

/** PD-1629 `EntityAssetEndpoint.post`. Only comment images are accepted. */
export const publicAssetCreateSchema = z.object({
  name: z.string().max(1000).optional(),
  type: z
    .enum(publicAssetTypes, { error: 'Invalid file type. Only JPEG, PNG, WebP, JPG and GIF files are allowed.' })
    .default('image/jpeg'),
  size: z.coerce.number().int().positive().safe().optional(),
  entity_type: z.literal('COMMENT_DESCRIPTION', { error: 'Invalid entity type.' }),
  entity_identifier: z.preprocess(value => (value === '' || value === null ? undefined : value), id.optional())
})
export type PublicAssetCreateInput = z.infer<typeof publicAssetCreateSchema>

/** PD-1630 body of `EntityAssetEndpoint.patch`. Attributes are descriptive only. */
export const publicAssetPatchSchema = z.object({
  attributes: z
    .object({
      name: z.string().max(1000).optional(),
      type: z.enum(attachmentMimeTypes).optional(),
      size: z.number().int().nonnegative().optional()
    })
    .optional()
})
export type PublicAssetPatchInput = z.infer<typeof publicAssetPatchSchema>

/** PD-1633 body of `EntityBulkAssetEndpoint.post`. */
export const publicAssetBulkSchema = z.object({
  asset_ids: z.array(id).min(1, 'No asset ids provided.').max(50)
})
export type PublicAssetBulkInput = z.infer<typeof publicAssetBulkSchema>

/** Board owner settings: what visitors may do. `intake` is the intake id that receives public submissions, or null. */
export const publicationSettingsSchema = z
  .object({
    is_comments_enabled: z.boolean().optional(),
    is_reactions_enabled: z.boolean().optional(),
    is_votes_enabled: z.boolean().optional(),
    intake: id.nullable().optional()
  })
  .strict()
  .refine(value => Object.keys(value).length > 0, { message: 'No setting provided' })
export type PublicationSettings = z.infer<typeof publicationSettingsSchema>

export const publicReactionCodeParamSchema = publicReactionCodeSchema
export const publicWorkspaceSlugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/)
