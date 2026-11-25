import { and, eq, isNull } from 'drizzle-orm'
import { fileAssets } from '@/db/schema/content'
import { parseInput } from '@/server/api/v1/validation'
import { canModifyAsset, isProjectAccessibleTo } from '@/server/asset/access'
import { fileSizeLimit, getUploadPath } from '@/server/asset/model-rules'
import { presentFileAsset } from '@/server/asset/presenters'
import { requireBucket } from '@/server/asset/storage'
import { validImage } from '@/server/asset/service'
import { forbiddenError, ServiceError } from '@/server/common/errors'
import { ROLE, requireWorkspaceRole } from '@/server/common/permissions'
import type { Actor } from '@/types/auth/schema'
import { assetAttributesSchema, uploadedFileSchema } from '@/types/content/p2-asset-schema'
import type { LancityDb } from '@/types/database/schema'

/** Legacy multipart file assets (`/file-assets/`): the file goes through the Worker into R2 in one request. */
const ALL_ROLES = [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST]
const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

async function storeFile(bucket: R2Bucket | undefined, key: string, file: File) {
  const store = requireBucket(bucket)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = file.type.toLowerCase()
  if (imageTypes.includes(type) && !validImage(bytes, type))
    throw new ServiceError(400, 'INVALID_ASSET', 'Image content does not match its type')
  await store.put(key, bytes, { httpMetadata: { contentType: type } })
  return bytes.byteLength
}

/** Client attributes (a JSON string in a multipart field) under the server derived name, type and size. */
function clientAttributes(raw: FormDataEntryValue | null) {
  if (typeof raw !== 'string' || !raw) return {}
  try {
    return parseInput(assetAttributesSchema, JSON.parse(raw))
  } catch (error) {
    if (error instanceof ServiceError) throw error
    throw new ServiceError(400, 'INVALID_JSON', 'attributes must be valid JSON')
  }
}

async function insertUploaded(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  form: FormData,
  workspaceId: number | null
) {
  const file = parseInput(uploadedFileSchema(fileSizeLimit()), form.get('asset'))
  const attributes = { ...clientAttributes(form.get('attributes')), name: file.name, type: file.type, size: file.size }
  const key = getUploadPath(workspaceId, file.name)
  const size = await storeFile(bucket, key, file)
  try {
    const [asset] = await db
      .insert(fileAssets)
      .values({
        attributes,
        asset: key,
        size,
        workspaceId,
        // The server stores the bytes, so the upload is complete.
        isUploaded: true,
        createdById: actor.userId,
        updatedById: actor.userId,
        ...(workspaceId === null ? { userId: actor.userId } : {})
      })
      .returning()
    return asset
  } catch (error) {
    await requireBucket(bucket)
      .delete(key)
      .catch(() => undefined)
    throw error
  }
}

async function byKey(db: LancityDb, key: string, extra?: ReturnType<typeof and>) {
  const [asset] = await db
    .select()
    .from(fileAssets)
    .where(and(eq(fileAssets.asset, key), isNull(fileAssets.deletedAt), extra))
    .limit(1)
  return asset
}

/** PD-0434 `FileAssetEndpoint.get`: assets stored under the key that the caller may reach. */
export async function getFileAsset(db: LancityDb, actor: Actor, slug: string, assetKey: string) {
  const ctx = await requireWorkspaceRole(db, actor, slug, ALL_ROLES)
  const asset = await byKey(db, `${ctx.workspaceId}/${assetKey}`)
  if (asset && (await isProjectAccessibleTo(db, actor.userId, asset)))
    return { data: [presentFileAsset(asset, slug)], status: true }
  return { error: 'Asset key does not exist', status: false }
}

/** PD-0435 `FileAssetEndpoint.post`. */
export async function createFileAsset(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  slug: string,
  form: FormData
) {
  const ctx = await requireWorkspaceRole(db, actor, slug, ALL_ROLES)
  return presentFileAsset(await insertUploaded(db, bucket, actor, form, ctx.workspaceId), slug)
}

async function modifiableByKey(db: LancityDb, actor: Actor, slug: string, assetKey: string) {
  const ctx = await requireWorkspaceRole(db, actor, slug, ALL_ROLES)
  const asset = await byKey(db, `${ctx.workspaceId}/${assetKey}`)
  if (!asset) throw new ServiceError(404, 'ASSET_NOT_FOUND', 'The requested asset could not be found.')
  if (!(await canModifyAsset(db, actor.userId, asset))) throw forbiddenError()
  return asset
}

/** PD-0436 `FileAssetEndpoint.delete`: sets `is_deleted` only. The object stays in R2 for a restore. */
export async function deleteFileAsset(db: LancityDb, actor: Actor, slug: string, assetKey: string) {
  const asset = await modifiableByKey(db, actor, slug, assetKey)
  await db.update(fileAssets).set({ isDeleted: true, updatedById: actor.userId }).where(eq(fileAssets.id, asset.id))
}

/** PD-0437 `FileAssetViewSet.restore`. */
export async function restoreFileAsset(db: LancityDb, actor: Actor, slug: string, assetKey: string) {
  const asset = await modifiableByKey(db, actor, slug, assetKey)
  await db.update(fileAssets).set({ isDeleted: false, updatedById: actor.userId }).where(eq(fileAssets.id, asset.id))
}

/** PD-0438 `UserAssetsEndpoint.get`: the caller's own upload by key. */
export async function getUserAssets(db: LancityDb, actor: Actor, assetKey: string) {
  const asset = await byKey(db, assetKey, eq(fileAssets.createdById, actor.userId))
  return asset ? { data: presentFileAsset(asset), status: true } : { error: 'Asset key does not exist', status: false }
}

/** PD-0439 `UserAssetsEndpoint.post`. The asset is also linked to the user so the profile can adopt it. */
export async function createUserFileAssets(db: LancityDb, bucket: R2Bucket | undefined, actor: Actor, form: FormData) {
  return presentFileAsset(await insertUploaded(db, bucket, actor, form, null))
}

/** PD-0440 `UserAssetsEndpoint.delete`. */
export async function deleteUserFileAssets(db: LancityDb, actor: Actor, assetKey: string) {
  const asset = await byKey(db, assetKey, eq(fileAssets.createdById, actor.userId))
  if (!asset) throw new ServiceError(404, 'ASSET_NOT_FOUND', 'The requested asset could not be found.')
  await db.update(fileAssets).set({ isDeleted: true, updatedById: actor.userId }).where(eq(fileAssets.id, asset.id))
}
