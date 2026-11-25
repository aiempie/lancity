import { and, eq, exists, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { fileAssets } from '@/db/schema/content'
import { issues } from '@/db/schema/issue'
import { parseInput } from '@/server/api/v1/validation'
import { attributesOf, fileSizeLimit, newAssetKey, safeAssetName } from '@/server/asset/model-rules'
import { validImage } from '@/server/asset/service'
import { objectMetadata, objectResponse, requireBucket, uploadInstructions } from '@/server/asset/storage'
import { ServiceError } from '@/server/common/errors'
import { isOwnBoardComment, requireBoard, requireBoardFeature, type PublicBoard } from '@/server/public/board'
import { visibleIssues } from '@/server/public/service'
import type { Actor } from '@/types/auth/schema'
import {
  publicAssetBulkSchema,
  publicAssetCreateSchema,
  publicAssetPatchSchema
} from '@/types/content/p3-public-schema'
import type { LancityDb } from '@/types/database/schema'

const notFound = () => new ServiceError(404, 'ASSET_NOT_FOUND', 'The requested asset could not be found.')

/** An asset the caller created on this board. Public visitors only change what they uploaded themselves. */
function ownAsset(board: PublicBoard, actor: Actor, assetId: number): SQL | undefined {
  return and(
    eq(fileAssets.id, assetId),
    eq(fileAssets.workspaceId, board.workspaceId),
    eq(fileAssets.projectId, board.projectId),
    eq(fileAssets.createdById, actor.userId)
  )
}

async function findOwn(db: LancityDb, board: PublicBoard, actor: Actor, assetId: number, includeDeleted = false) {
  const [asset] = await db
    .select()
    .from(fileAssets)
    .where(and(ownAsset(board, actor, assetId), includeDeleted ? undefined : isNull(fileAssets.deletedAt)))
    .limit(1)
  if (!asset) throw notFound()
  return asset
}

/**
 * PD-1627 `EntityAssetEndpoint.get_permissions` is a route concern: reading is open, every write needs a session.
 * PD-1628 `EntityAssetEndpoint.get`: a stored image of an issue or public comment description of the board project.
 * Plane serves any uploaded `ISSUE_DESCRIPTION` or `COMMENT_DESCRIPTION` asset of the project through a presigned URL;
 * here the asset must also belong to an issue the board shows or to a public comment, and a visitor may always read
 * the comment images they just uploaded. Inline only for allow-listed images (`objectResponse`).
 */
export async function getPublicAsset(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor | null,
  anchor: string,
  assetId: number
) {
  const board = await requireBoard(db, anchor)
  const [asset] = await db
    .select()
    .from(fileAssets)
    .where(
      and(
        eq(fileAssets.id, assetId),
        eq(fileAssets.workspaceId, board.workspaceId),
        eq(fileAssets.projectId, board.projectId),
        eq(fileAssets.isUploaded, true),
        isNull(fileAssets.deletedAt),
        or(
          and(
            eq(fileAssets.entityType, 'ISSUE_DESCRIPTION'),
            exists(
              db
                .select({ id: issues.id })
                .from(issues)
                .where(and(eq(issues.id, fileAssets.issueId), visibleIssues(db, anchor)))
            )
          ),
          and(
            eq(fileAssets.entityType, 'COMMENT_DESCRIPTION'),
            sql`exists (select 1 from issue_comments c where c.id = ${fileAssets.commentId} and c.access = 'EXTERNAL'
              and c.deleted_at is null and c.project_id = ${board.projectId})`
          ),
          actor
            ? and(eq(fileAssets.entityType, 'COMMENT_DESCRIPTION'), eq(fileAssets.createdById, actor.userId))
            : undefined
        )
      )
    )
    .limit(1)
  if (!asset) throw notFound()
  const object = await requireBucket(bucket).get(asset.asset)
  if (!object) throw notFound()
  const { name, type } = attributesOf(asset)
  return objectResponse(object, { disposition: 'inline', filename: name, contentType: type })
}

/**
 * PD-1629 `EntityAssetEndpoint.post`: register a comment image. R2 has no presigned POST, so the response tells the
 * client where to `PUT` the bytes (`contentUrl`). Only raster images and only `COMMENT_DESCRIPTION`.
 */
export async function createPublicAsset(
  db: LancityDb,
  actor: Actor,
  anchor: string,
  raw: unknown,
  contentUrl: (assetId: number) => string,
  assetUrl: (assetId: number) => string
) {
  const board = await requireBoard(db, anchor)
  requireBoardFeature(board, 'comments')
  const input = parseInput(publicAssetCreateSchema, raw ?? {})
  if (input.entity_identifier && !(await isOwnBoardComment(db, board, input.entity_identifier, actor)))
    throw new ServiceError(404, 'COMMENT_NOT_FOUND', 'Comment not found')
  const name = safeAssetName(input.name)
  const size = Math.min(input.size ?? fileSizeLimit(), fileSizeLimit())
  const [asset] = await db
    .insert(fileAssets)
    .values({
      attributes: { name, type: input.type, size },
      asset: newAssetKey(board.workspaceId, name),
      size,
      workspaceId: board.workspaceId,
      projectId: board.projectId,
      createdById: actor.userId,
      updatedById: actor.userId,
      entityType: input.entity_type,
      commentId: input.entity_identifier ?? null
    })
    .returning()
  return {
    upload_data: uploadInstructions(contentUrl(asset.id), input.type, size),
    asset_id: asset.id,
    asset_url: assetUrl(asset.id)
  }
}

/**
 * Replacement for the presigned POST: the creator sends the bytes of a registered asset to the Worker once. The
 * content type must match the declared one, the length must be declared and within the limit, and an image must start
 * with the signature of its type.
 */
export async function uploadPublicAssetContent(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  anchor: string,
  assetId: number,
  request: Request
) {
  const board = await requireBoard(db, anchor)
  const asset = await findOwn(db, board, actor, assetId)
  if (asset.isUploaded) throw new ServiceError(409, 'ASSET_UPLOADED', 'The asset is already uploaded')
  const { type, size: declared = 0 } = attributesOf(asset)
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (!type || contentType !== type)
    throw new ServiceError(400, 'INVALID_FILE_TYPE', 'Content-Type must match the declared type')
  const length = Number(request.headers.get('content-length'))
  if (!Number.isSafeInteger(length) || length <= 0)
    throw new ServiceError(411, 'LENGTH_REQUIRED', 'A valid Content-Length is required')
  if (length > Math.min(declared, fileSizeLimit()))
    throw new ServiceError(413, 'FILE_TOO_LARGE', 'Upload exceeds the declared size')
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength !== length) throw new ServiceError(400, 'INVALID_REQUEST', 'Body does not match Content-Length')
  if (!validImage(bytes, type === 'image/jpg' ? 'image/jpeg' : type))
    throw new ServiceError(400, 'INVALID_ASSET', 'Image content does not match its type')
  await requireBucket(bucket).put(asset.asset, bytes, { httpMetadata: { contentType: type } })
  await db
    .update(fileAssets)
    .set({ size: bytes.byteLength, updatedById: actor.userId })
    .where(and(eq(fileAssets.id, asset.id), eq(fileAssets.isUploaded, false)))
  return { id: asset.id, size: bytes.byteLength }
}

/** PD-1630 `EntityAssetEndpoint.patch`: confirm the upload of the caller's own asset (the object must exist in R2). */
export async function updatePublicAsset(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  anchor: string,
  assetId: number,
  raw: unknown
) {
  const board = await requireBoard(db, anchor)
  const input = parseInput(publicAssetPatchSchema, raw ?? {})
  const asset = await findOwn(db, board, actor, assetId)
  const head = await requireBucket(bucket).head(asset.asset)
  if (!head) throw new ServiceError(400, 'ASSET_NOT_UPLOADED', 'The asset is not uploaded.')
  // Only the file name is taken from the client; type and size describe what is stored and what is served.
  const attributes = { ...attributesOf(asset), ...(input.attributes?.name ? { name: input.attributes.name } : {}) }
  await db
    .update(fileAssets)
    .set({
      isUploaded: true,
      size: head.size,
      attributes,
      storageMetadata: objectMetadata(head),
      updatedById: actor.userId
    })
    .where(eq(fileAssets.id, asset.id))
}

/** PD-1631 `EntityAssetEndpoint.delete`: soft delete the caller's own asset. */
export async function deletePublicAsset(db: LancityDb, actor: Actor, anchor: string, assetId: number) {
  const board = await requireBoard(db, anchor)
  const asset = await findOwn(db, board, actor, assetId)
  await db
    .update(fileAssets)
    .set({ isDeleted: true, deletedAt: new Date(), updatedById: actor.userId })
    .where(eq(fileAssets.id, asset.id))
}

/** PD-1632 `AssetRestoreEndpoint.post`: undo the soft delete of the caller's own asset. */
export async function restorePublicAsset(db: LancityDb, actor: Actor, anchor: string, assetId: number) {
  const board = await requireBoard(db, anchor)
  const asset = await findOwn(db, board, actor, assetId, true)
  await db
    .update(fileAssets)
    .set({ isDeleted: false, deletedAt: null, updatedById: actor.userId })
    .where(eq(fileAssets.id, asset.id))
}

/**
 * PD-1633 `EntityBulkAssetEndpoint.post`: attach the caller's fresh comment images to their comment. Only
 * `COMMENT_DESCRIPTION` assets are rebound, and the comment must be the caller's own comment on this board.
 */
export async function bulkBindPublicAssets(
  db: LancityDb,
  actor: Actor,
  anchor: string,
  commentId: number,
  raw: unknown
) {
  const board = await requireBoard(db, anchor)
  requireBoardFeature(board, 'comments')
  if (!(await isOwnBoardComment(db, board, commentId, actor)))
    throw new ServiceError(404, 'COMMENT_NOT_FOUND', 'Comment not found')
  const { asset_ids } = parseInput(publicAssetBulkSchema, raw ?? {})
  const owned = await db
    .select({ id: fileAssets.id, entityType: fileAssets.entityType })
    .from(fileAssets)
    .where(
      and(
        inArray(fileAssets.id, asset_ids),
        eq(fileAssets.workspaceId, board.workspaceId),
        eq(fileAssets.projectId, board.projectId),
        eq(fileAssets.createdById, actor.userId),
        isNull(fileAssets.deletedAt)
      )
    )
  if (!owned.length) throw notFound()
  const ids = owned.filter(asset => asset.entityType === 'COMMENT_DESCRIPTION').map(asset => asset.id)
  if (ids.length)
    await db
      .update(fileAssets)
      .set({ commentId, updatedById: actor.userId })
      .where(and(inArray(fileAssets.id, ids), eq(fileAssets.createdById, actor.userId)))
}
