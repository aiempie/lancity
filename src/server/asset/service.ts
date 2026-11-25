import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { fileAssets } from '@/db/schema/content'
import { ServiceError } from '@/server/common/errors'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

const maxBytes = 10 * 1024 * 1024
const types = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
export function validImage(bytes: Uint8Array, contentType: string) {
  if (contentType === 'image/jpeg')
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (contentType === 'image/png')
    return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)
  if (contentType === 'image/gif')
    return bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(new TextDecoder().decode(bytes.slice(0, 6)))
  if (contentType === 'image/webp')
    return (
      bytes.length >= 12 &&
      new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
      new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
    )
  return false
}
function safeName(name: string) {
  return name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 150) || 'image'
}
function requireBucket(bucket?: R2Bucket) {
  if (!bucket) throw new ServiceError(503, 'STORAGE_UNAVAILABLE', 'Asset storage is not configured')
  return bucket
}

function activeAssetMember(workspaceId: number, projectId: number, userId: number, role = 5) {
  return sql`exists (select 1 from project_members pm
    join projects p on p.id = pm.project_id and p.workspace_id = pm.workspace_id
    join workspaces w on w.id = p.workspace_id
    join workspace_members wm on wm.workspace_id = w.id and wm.member_id = pm.member_id
    where pm.project_id = ${projectId} and pm.workspace_id = ${workspaceId} and pm.member_id = ${userId}
      and pm.is_active = 1 and pm.deleted_at is null and wm.is_active = 1 and wm.deleted_at is null
      and w.deleted_at is null and p.deleted_at is null and (pm.role >= ${role} or wm.role = 20))`
}
export async function uploadProjectAsset(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  slug: string,
  projectId: number,
  file: File
) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId)
  const store = requireBucket(bucket)
  const contentType = file.type.toLowerCase()
  if (!types.some(type => type === contentType) || file.size <= 0 || file.size > maxBytes)
    throw new ServiceError(400, 'INVALID_ASSET', 'Expected a JPEG, PNG, WebP or GIF image up to 10 MiB')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!validImage(bytes, contentType))
    throw new ServiceError(400, 'INVALID_ASSET', 'Image content does not match its type')
  const name = safeName(file.name)
  const key = `projects/${workspace.id}/${projectId}/${crypto.randomUUID()}`
  const [pending] = await db
    .insert(fileAssets)
    .values({
      workspaceId: workspace.id,
      projectId,
      asset: key,
      attributes: { name, type: contentType },
      size: bytes.length,
      createdById: actor.userId,
      userId: actor.userId
    })
    .returning({ id: fileAssets.id })
  try {
    await store.put(key, bytes, { httpMetadata: { contentType } })
    const [uploaded] = await db
      .update(fileAssets)
      .set({ isUploaded: true })
      .where(
        and(
          eq(fileAssets.id, pending.id),
          eq(fileAssets.isUploaded, false),
          eq(fileAssets.isDeleted, false),
          activeAssetMember(workspace.id, projectId, actor.userId)
        )
      )
      .returning({ id: fileAssets.id })
    if (!uploaded) throw new ServiceError(409, 'ASSET_CHANGED', 'Asset or project permissions changed during upload')
    return { id: pending.id, name, type: contentType, size: bytes.length }
  } catch (error) {
    try {
      const [saved] = await db
        .select({ uploaded: fileAssets.isUploaded, deleted: fileAssets.isDeleted })
        .from(fileAssets)
        .where(eq(fileAssets.id, pending.id))
        .limit(1)
      if (saved?.uploaded && !saved.deleted) return { id: pending.id, name, type: contentType, size: bytes.length }
      await store.delete(key)
      await db.delete(fileAssets).where(and(eq(fileAssets.id, pending.id), eq(fileAssets.isUploaded, false)))
    } catch (cleanupError) {
      console.error('Unable to clean up pending asset', cleanupError)
      throw new ServiceError(503, 'ASSET_CLEANUP_REQUIRED', 'Asset upload failed; cleanup can be retried', {
        assetId: pending.id
      })
    }
    throw error
  }
}

async function findAsset(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  assetId: number,
  includePendingDeletion = false,
  allowProjectCover = false
) {
  const access = await requireProjectAccess(db, actor, slug, projectId)
  const [asset] = await db
    .select()
    .from(fileAssets)
    .where(
      and(
        eq(fileAssets.id, assetId),
        eq(fileAssets.workspaceId, access.workspace.id),
        eq(fileAssets.projectId, projectId),
        includePendingDeletion ? undefined : eq(fileAssets.isDeleted, false),
        isNull(fileAssets.deletedAt)
      )
    )
    .limit(1)
  if (!asset) throw new ServiceError(404, 'ASSET_NOT_FOUND', 'Asset not found')
  // This adapter creates unbound assets only. Do not expose assets bound to entities whose own permissions have not been checked.
  // A project cover is shown to every project member, so it may be read (never deleted) through this route.
  if (allowProjectCover && asset.entityType === 'PROJECT_COVER') return { asset, access }
  if (asset.issueId || asset.commentId || asset.pageId || asset.draftIssueId || asset.entityType)
    throw new ServiceError(404, 'ASSET_NOT_FOUND', 'Asset not found')
  return { asset, access }
}
export async function downloadProjectAsset(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  slug: string,
  projectId: number,
  assetId: number
) {
  const { asset, access } = await findAsset(db, actor, slug, projectId, assetId, false, true)
  if (
    !asset.isUploaded ||
    (access.membership.role === 5 && !access.project.guestViewAllFeatures && asset.createdById !== actor.userId)
  )
    throw new ServiceError(404, 'ASSET_NOT_FOUND', 'Asset not found')
  const object = await requireBucket(bucket).get(asset.asset)
  if (!object) throw new ServiceError(404, 'ASSET_NOT_FOUND', 'Asset not found')
  return object
}
export async function deleteProjectAsset(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  slug: string,
  projectId: number,
  assetId: number
) {
  const { asset, access } = await findAsset(db, actor, slug, projectId, assetId, true)
  if (asset.createdById !== actor.userId && access.membership.role < 15 && access.workspaceMembership.role !== 20)
    throw new ServiceError(403, 'FORBIDDEN', 'Insufficient asset permissions')
  const store = requireBucket(bucket)
  // Hide downloads before touching R2. Keeping deletedAt null makes a failed delete retryable.
  const [marked] = await db
    .update(fileAssets)
    .set({ isDeleted: true, updatedById: actor.userId })
    .where(
      and(
        eq(fileAssets.id, asset.id),
        isNull(fileAssets.deletedAt),
        activeAssetMember(access.workspace.id, projectId, actor.userId),
        or(
          eq(fileAssets.createdById, actor.userId),
          activeAssetMember(access.workspace.id, projectId, actor.userId, 15)
        )
      )
    )
    .returning({ id: fileAssets.id })
  if (!marked) throw new ServiceError(409, 'ASSET_CHANGED', 'Asset or project permissions changed during deletion')
  try {
    await store.delete(asset.asset)
    await db
      .update(fileAssets)
      .set({ isUploaded: false, deletedAt: new Date(), updatedById: actor.userId })
      .where(and(eq(fileAssets.id, asset.id), eq(fileAssets.isDeleted, true), isNull(fileAssets.deletedAt)))
  } catch (error) {
    console.error('Unable to finish asset deletion', error)
    throw new ServiceError(503, 'ASSET_CLEANUP_REQUIRED', 'Asset deletion can be retried', { assetId })
  }
}

export * from './file-assets'
