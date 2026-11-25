import { z } from 'zod'

/** Plane `FileAsset.EntityTypeContext`. */
export const assetEntityTypes = [
  'ISSUE_ATTACHMENT',
  'ISSUE_DESCRIPTION',
  'COMMENT_DESCRIPTION',
  'PAGE_DESCRIPTION',
  'USER_COVER',
  'USER_AVATAR',
  'WORKSPACE_LOGO',
  'PROJECT_COVER',
  'DRAFT_ISSUE_ATTACHMENT',
  'DRAFT_ISSUE_DESCRIPTION'
] as const
export type AssetEntityType = (typeof assetEntityTypes)[number]
export const assetEntityTypeSchema = z.enum(assetEntityTypes, { error: 'Invalid entity type.' })
export const userAssetEntityTypeSchema = z.enum(['USER_AVATAR', 'USER_COVER'], { error: 'Invalid entity type.' })

/** Image types accepted by the v2 asset endpoints. */
export const imageAssetTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'image/gif'] as const
const imageTypeSchema = z.enum(imageAssetTypes, {
  error: 'Invalid file type. Only JPEG, PNG, WebP, JPG and GIF files are allowed.'
})

/** Plane `settings.ATTACHMENT_MIME_TYPES`. */
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
  'application/rtf',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.graphics',
  'application/vnd.visio',
  'image/x-portable-graymap',
  'image/x-portable-bitmap',
  'image/x-portable-pixmap',
  'application/vnd.oasis.opendocument.database',
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
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-ms-wmv',
  'application/zip',
  'application/x-rar',
  'application/x-rar-compressed',
  'application/x-tar',
  'application/gzip',
  'application/x-zip',
  'application/x-zip-compressed',
  'application/x-7z-compressed',
  'application/x-compressed',
  'application/x-compressed-tar',
  'application/x-compressed-tar-gz',
  'application/x-compressed-tar-bz2',
  'application/x-compressed-tar-zip',
  'application/x-compressed-tar-7z',
  'application/x-compressed-tar-rar',
  'model/gltf-binary',
  'model/gltf+json',
  'application/octet-stream',
  'font/ttf',
  'font/otf',
  'font/woff',
  'font/woff2',
  'text/css',
  'text/javascript',
  'application/json',
  'text/xml',
  'text/csv',
  'application/xml',
  'application/x-sql',
  'application/x-gzip'
] as const
const attachmentTypeSchema = z.enum(attachmentMimeTypes, { error: 'Invalid file type.' })

/** The only types ever served inline (Plane `INLINE_SAFE_MIME_TYPES`). */
export const inlineSafeMimeTypes: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp'
])

const entityIdSchema = z.coerce.number().int().positive().safe()
/** Optional entity id. Missing, null and an empty string mean "leave the asset unbound". */
const optionalEntityId = z.preprocess(
  value => (value === '' || value === null ? undefined : value),
  entityIdSchema.optional()
)
const assetName = z.string().max(1000).optional()
const assetSize = z.coerce.number().int().positive().safe().optional()

export const assetAttributesSchema = z
  .record(z.string().max(100), z.json())
  .refine(value => JSON.stringify(value).length <= 4096, 'Attributes are too large')

/** `UserAssetsV2Endpoint.post` and the external `UserAssetEndpoint` / `UserServerAssetEndpoint` post. */
export const createUserAssetInputSchema = z.object({
  name: assetName,
  type: imageTypeSchema.default('image/jpeg'),
  size: assetSize,
  entity_type: userAssetEntityTypeSchema
})
/** `WorkspaceFileAssetEndpoint.post` and `ProjectAssetEndpoint.post`. */
export const createAssetInputSchema = z.object({
  name: assetName,
  type: imageTypeSchema.default('image/jpeg'),
  size: assetSize,
  entity_type: assetEntityTypeSchema,
  entity_identifier: optionalEntityId
})
/** `GenericAssetEndpoint.post`: a project attachment that is bound to an issue later. */
export const createGenericAssetInputSchema = z.object({
  name: z.string().min(1, 'Name and size are required fields.').max(1000),
  type: attachmentTypeSchema,
  size: assetSize,
  project_id: entityIdSchema,
  external_id: z.string().max(255).optional(),
  external_source: z.string().max(255).optional()
})
/** `...patch` bodies: optional replacement of `attributes`. */
export const updateAssetInputSchema = z.object({ attributes: assetAttributesSchema.optional() })
export const duplicateAssetInputSchema = z.object({
  entity_type: assetEntityTypeSchema,
  entity_id: optionalEntityId,
  project_id: optionalEntityId
})
export const bulkAssetInputSchema = z.object({
  asset_ids: z.array(entityIdSchema).min(1, 'No asset ids provided.').max(50)
})
/** `PD-0297` and `PD-0298`: a file about to be stored by a multipart route must be of an allowed type and size. */
export function uploadedFileSchema(limit: number) {
  return z
    .custom<File>(value => value instanceof File, 'Expected a file')
    .superRefine((file, ctx) => {
      if (!(attachmentMimeTypes as readonly string[]).includes(file.type.toLowerCase()))
        ctx.addIssue({ code: 'custom', message: 'Invalid file type.' })
      else if (file.size <= 0) ctx.addIssue({ code: 'custom', message: 'The submitted file is empty.' })
      else if (file.size > limit) ctx.addIssue({ code: 'custom', message: 'File too large.' })
    })
}

export type CreateUserAssetInput = z.infer<typeof createUserAssetInputSchema>
export type CreateAssetInput = z.infer<typeof createAssetInputSchema>
export type CreateGenericAssetInput = z.infer<typeof createGenericAssetInputSchema>
export type UpdateAssetInput = z.infer<typeof updateAssetInputSchema>
export type DuplicateAssetInput = z.infer<typeof duplicateAssetInputSchema>
export type BulkAssetInput = z.infer<typeof bulkAssetInputSchema>
