import { and, desc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm'
import { fileAssets } from '@/db/schema/content'
import { profiles } from '@/db/schema/identity'
import { projects, workspaces } from '@/db/schema/workspace'
import { parseInput } from '@/server/api/v1/validation'
import { canBindAsset, canModifyAsset, isProjectAccessibleTo } from '@/server/asset/access'
import {
  assetUrl,
  attributesOf,
  bindingValues,
  fileSizeLimit,
  getEntityIdField,
  newAssetKey,
  safeAssetName,
  type EntityBinding,
  type FileAssetRow
} from '@/server/asset/model-rules'
import { copyObject, deleteFiles, objectMetadata, objectResponse, requireBucket } from '@/server/asset/storage'
import { validImage } from '@/server/asset/service'
import { forbiddenError, isIntegrityError, ServiceError } from '@/server/common/errors'
import { ROLE, requireProjectRole, requireWorkspaceRole } from '@/server/common/permissions'
import { getDefaultOnboarding, getDefaultProductTour, getMobileDefaultOnboarding } from '@/server/identity/model-rules'
import type { Actor } from '@/types/auth/schema'
import {
  bulkAssetInputSchema,
  createAssetInputSchema,
  createUserAssetInputSchema,
  duplicateAssetInputSchema,
  updateAssetInputSchema
} from '@/types/content/p2-asset-schema'
import type { JsonValue, LancityDb } from '@/types/database/schema'

export { canBindAsset, canModifyAsset } from '@/server/asset/access'
export { getEntityIdField as getEntityIdFieldWorkspaceFileAsset } from '@/server/asset/model-rules'

const ALL_ROLES = [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST]
/** Entity types a project endpoint may bind (adds the draft issue description). */
const projectEntityOptions = { draft: true }

export type CreatedAsset = { asset: FileAssetRow; assetUrl: string | null }

const notFound = () => new ServiceError(404, 'ASSET_NOT_FOUND', 'The requested asset could not be found.')
const noAccess = () => new ServiceError(403, 'FORBIDDEN', "You don't have access to this asset.")

/** Plane `FileAsset.objects.get`: soft deleted rows (`deleted_at`) are hidden. `all_objects` shows them. */
async function findAsset(db: LancityDb, where: SQL | undefined, includeSoftDeleted = false): Promise<FileAssetRow> {
  const [asset] = await db
    .select()
    .from(fileAssets)
    .where(and(includeSoftDeleted ? undefined : isNull(fileAssets.deletedAt), where))
    .limit(1)
  if (!asset) throw notFound()
  return asset
}

async function markDeleted(db: LancityDb, id: number, actor?: Actor) {
  await db
    .update(fileAssets)
    .set({ isDeleted: true, deletedAt: new Date(), ...(actor ? { updatedById: actor.userId } : {}) })
    .where(eq(fileAssets.id, id))
}

function hasMetadata(value: unknown) {
  return Boolean(value) && typeof value === 'object' && Object.keys(value as object).length > 0
}

/**
 * Plane `asset.is_uploaded = True` plus `get_asset_object_metadata`: the object must exist in R2 (there is no
 * presigned POST, so the Worker received the bytes). The size and metadata come from the stored object.
 */
async function confirmUpload(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  asset: FileAssetRow,
  attributes?: Record<string, unknown>
) {
  const head = await requireBucket(bucket).head(asset.asset)
  if (!head) throw new ServiceError(400, 'ASSET_NOT_UPLOADED', 'The asset is not uploaded.')
  await db
    .update(fileAssets)
    .set({
      isUploaded: true,
      size: head.size,
      attributes: (attributes ?? asset.attributes) as never,
      storageMetadata: hasMetadata(asset.storageMetadata) ? asset.storageMetadata : objectMetadata(head),
      updatedById: actor.userId
    })
    .where(eq(fileAssets.id, asset.id))
}

function sizeFor(requested: number | undefined) {
  const limit = fileSizeLimit()
  return Math.min(requested ?? limit, limit)
}

/** Serve an uploaded object: inline only for allow-listed images, otherwise as a download. */
export function streamAsset(asset: FileAssetRow, object: R2ObjectBody, disposition: 'inline' | 'attachment') {
  const { name, type } = attributesOf(asset)
  return objectResponse(object, { disposition, filename: name, contentType: type })
}

async function readObject(bucket: R2Bucket | undefined, asset: FileAssetRow) {
  const object = await requireBucket(bucket).get(asset.asset)
  if (!object) throw notFound()
  return object
}

// ------------------------------------------------------------------------------------------ user assets

/** PD-0443 `UserAssetsV2Endpoint.asset_delete`: soft delete an asset owned by the user. */
export async function assetDeleteUserAssets(db: LancityDb, assetId: number, userId: number) {
  const [asset] = await db
    .select({ id: fileAssets.id })
    .from(fileAssets)
    .where(and(eq(fileAssets.id, assetId), eq(fileAssets.userId, userId)))
    .limit(1)
  if (asset) await markDeleted(db, asset.id)
}

async function setProfileAsset(
  db: LancityDb,
  userId: number,
  column: 'avatarAssetId' | 'coverImageAssetId',
  id: number
) {
  const set = column === 'avatarAssetId' ? { avatarAssetId: id } : { coverImageAssetId: id }
  await db
    .insert(profiles)
    .values({
      userId,
      onboardingStep: getDefaultOnboarding(),
      mobileOnboardingStep: getMobileDefaultOnboarding(),
      productTour: getDefaultProductTour(),
      ...set
    })
    .onConflictDoUpdate({ target: profiles.userId, set })
}

/**
 * PD-0444 `entity_asset_save`: a new avatar or cover replaces the previous asset. The profile only stores the asset
 * id; the asset URL replaces `user.image` in the presenter, so `user.image` is left alone.
 */
export async function entityAssetSaveUserAssets(db: LancityDb, entityType: string | null, asset: FileAssetRow) {
  if (!asset.userId || (entityType !== 'USER_AVATAR' && entityType !== 'USER_COVER')) return
  const column = entityType === 'USER_AVATAR' ? 'avatarAssetId' : 'coverImageAssetId'
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, asset.userId)).limit(1)
  const previous = profile?.[column]
  if (previous && previous !== asset.id) await assetDeleteUserAssets(db, previous, asset.userId)
  await setProfileAsset(db, asset.userId, column, asset.id)
}

/** PD-0445 `entity_asset_delete`: unlink the asset from the profile when it is the current avatar or cover. */
export async function entityAssetDeleteUserAssets(db: LancityDb, entityType: string | null, asset: FileAssetRow) {
  if (!asset.userId) return
  if (entityType === 'USER_AVATAR')
    await db
      .update(profiles)
      .set({ avatarAssetId: null })
      .where(and(eq(profiles.userId, asset.userId), eq(profiles.avatarAssetId, asset.id)))
  if (entityType === 'USER_COVER')
    await db
      .update(profiles)
      .set({ coverImageAssetId: null })
      .where(and(eq(profiles.userId, asset.userId), eq(profiles.coverImageAssetId, asset.id)))
}

/** PD-0446 (and external PD-0050, PD-0055) `UserAssetsV2Endpoint.post`: register a user avatar or cover upload. */
export async function createUserAssets(db: LancityDb, actor: Actor, raw: unknown): Promise<CreatedAsset> {
  const input = parseInput(createUserAssetInputSchema, raw)
  const name = safeAssetName(input.name)
  const size = sizeFor(input.size)
  const [asset] = await db
    .insert(fileAssets)
    .values({
      attributes: { name, type: input.type, size },
      asset: newAssetKey(null, name),
      size,
      userId: actor.userId,
      createdById: actor.userId,
      updatedById: actor.userId,
      entityType: input.entity_type
    })
    .returning()
  return { asset, assetUrl: assetUrl(asset, '') }
}

async function ownAsset(db: LancityDb, actor: Actor, assetId: number) {
  return findAsset(db, and(eq(fileAssets.id, assetId), eq(fileAssets.userId, actor.userId)))
}

/** PD-0447 (and PD-0051, PD-0056) `UserAssetsV2Endpoint.patch`: confirm the upload and bind the avatar or cover. */
export async function updateUserAssets(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  assetId: number,
  raw: unknown
) {
  const input = parseInput(updateAssetInputSchema, raw ?? {})
  const asset = await ownAsset(db, actor, assetId)
  await confirmUpload(db, bucket, actor, asset, input.attributes)
  await entityAssetSaveUserAssets(db, asset.entityType, asset)
}

/** PD-0448 (and PD-0052, PD-0057) `UserAssetsV2Endpoint.delete`. */
export async function deleteUserAssets(db: LancityDb, actor: Actor, assetId: number) {
  const asset = await ownAsset(db, actor, assetId)
  await entityAssetDeleteUserAssets(db, asset.entityType, asset)
  await markDeleted(db, asset.id)
}

/** PD-0457 `StaticFileAssetEndpoint.get`: avatars, covers and logos are readable without a session. */
export async function getStaticFileAsset(db: LancityDb, bucket: R2Bucket | undefined, assetId: number) {
  const asset = await findAsset(db, eq(fileAssets.id, assetId))
  if (!asset.isUploaded) throw notFound()
  if (!['USER_AVATAR', 'USER_COVER', 'WORKSPACE_LOGO', 'PROJECT_COVER'].includes(asset.entityType ?? ''))
    throw new ServiceError(400, 'INVALID_ENTITY_TYPE', 'Invalid entity type.')
  return { asset, object: await readObject(bucket, asset) }
}

// -------------------------------------------------------------------------------------- workspace assets

/** PD-0450 `WorkspaceFileAssetEndpoint.asset_delete`. */
export async function assetDeleteWorkspaceFileAsset(db: LancityDb, assetId: number) {
  const [asset] = await db.select({ id: fileAssets.id }).from(fileAssets).where(eq(fileAssets.id, assetId)).limit(1)
  if (asset) await markDeleted(db, asset.id)
}

/** PD-0451 `entity_asset_save`: the workspace logo or project cover now points at the confirmed asset. */
export async function entityAssetSaveWorkspaceFileAsset(db: LancityDb, entityType: string | null, asset: FileAssetRow) {
  if (entityType === 'WORKSPACE_LOGO' && asset.workspaceId) {
    const [workspace] = await db
      .select({ logoAssetId: workspaces.logoAssetId })
      .from(workspaces)
      .where(eq(workspaces.id, asset.workspaceId))
      .limit(1)
    if (!workspace) return
    if (workspace.logoAssetId && workspace.logoAssetId !== asset.id)
      await assetDeleteWorkspaceFileAsset(db, workspace.logoAssetId)
    await db.update(workspaces).set({ logo: '', logoAssetId: asset.id }).where(eq(workspaces.id, asset.workspaceId))
  } else if (entityType === 'PROJECT_COVER' && asset.projectId && asset.workspaceId) {
    const [project] = await db
      .select({ coverImageAssetId: projects.coverImageAssetId })
      .from(projects)
      .where(and(eq(projects.id, asset.projectId), eq(projects.workspaceId, asset.workspaceId)))
      .limit(1)
    if (!project) return
    if (project.coverImageAssetId && project.coverImageAssetId !== asset.id)
      await assetDeleteWorkspaceFileAsset(db, project.coverImageAssetId)
    await db
      .update(projects)
      .set({ coverImage: '', coverImageAssetId: asset.id })
      .where(eq(projects.id, asset.projectId))
  }
}

/** PD-0452 `entity_asset_delete`: unlink the asset when it is the current workspace logo or project cover. */
export async function entityAssetDeleteWorkspaceFileAsset(
  db: LancityDb,
  entityType: string | null,
  asset: FileAssetRow
) {
  if (entityType === 'WORKSPACE_LOGO' && asset.workspaceId)
    await db
      .update(workspaces)
      .set({ logoAssetId: null })
      .where(and(eq(workspaces.id, asset.workspaceId), eq(workspaces.logoAssetId, asset.id)))
  else if (entityType === 'PROJECT_COVER' && asset.projectId && asset.workspaceId)
    await db
      .update(projects)
      .set({ coverImageAssetId: null })
      .where(
        and(
          eq(projects.id, asset.projectId),
          eq(projects.workspaceId, asset.workspaceId),
          eq(projects.coverImageAssetId, asset.id)
        )
      )
}

/** PD-0453 `WorkspaceFileAssetEndpoint.post`: register an upload that may be bound to an entity of the workspace. */
export async function createWorkspaceFileAsset(
  db: LancityDb,
  actor: Actor,
  slug: string,
  raw: unknown
): Promise<CreatedAsset> {
  const ctx = await requireWorkspaceRole(db, actor, slug, ALL_ROLES)
  const input = parseInput(createAssetInputSchema, raw)
  if (input.entity_type === 'WORKSPACE_LOGO' && ctx.workspaceRole !== ROLE.ADMIN)
    throw new ServiceError(403, 'FORBIDDEN', 'Only workspace admins can upload a workspace logo.')
  const binding = getEntityIdField(input.entity_type, input.entity_identifier)
  if (!(await canBindAsset(db, actor.userId, ctx.workspaceId, binding)))
    throw new ServiceError(400, 'INVALID_ENTITY', 'Invalid entity identifier.')
  const name = safeAssetName(input.name)
  const size = sizeFor(input.size)
  const values = {
    attributes: { name, type: input.type, size },
    asset: newAssetKey(ctx.workspaceId, name),
    size,
    workspaceId: ctx.workspaceId,
    createdById: actor.userId,
    updatedById: actor.userId,
    entityType: input.entity_type,
    ...bindingValues(binding)
  }
  // A cover bound to a project at upload time needs a project of this workspace that the caller administers.
  if (values.projectId && !(await canModifyAsset(db, actor.userId, { ...values, projectId: values.projectId })))
    throw forbiddenError()
  const [asset] = await db.insert(fileAssets).values(values).returning()
  return { asset, assetUrl: assetUrl(asset, slug) }
}

async function workspaceAsset(db: LancityDb, actor: Actor, slug: string, assetId: number, includeSoftDeleted = false) {
  const ctx = await requireWorkspaceRole(db, actor, slug, ALL_ROLES)
  const asset = await findAsset(
    db,
    and(eq(fileAssets.id, assetId), eq(fileAssets.workspaceId, ctx.workspaceId)),
    includeSoftDeleted
  )
  return { ctx, asset }
}

/** PD-0454 `WorkspaceFileAssetEndpoint.patch`: confirm the upload and bind a logo or project cover. */
export async function updateWorkspaceFileAsset(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  slug: string,
  assetId: number,
  raw: unknown
) {
  const input = parseInput(updateAssetInputSchema, raw ?? {})
  const { asset } = await workspaceAsset(db, actor, slug, assetId)
  if (!(await isProjectAccessibleTo(db, actor.userId, asset))) throw noAccess()
  if (!(await canModifyAsset(db, actor.userId, asset))) throw forbiddenError()
  await confirmUpload(db, bucket, actor, asset, input.attributes)
  await entityAssetSaveWorkspaceFileAsset(db, asset.entityType, asset)
}

/** PD-0455 `WorkspaceFileAssetEndpoint.delete`. */
export async function deleteWorkspaceFileAsset(db: LancityDb, actor: Actor, slug: string, assetId: number) {
  const { asset } = await workspaceAsset(db, actor, slug, assetId)
  if (!(await isProjectAccessibleTo(db, actor.userId, asset))) throw noAccess()
  if (!(await canModifyAsset(db, actor.userId, asset))) throw forbiddenError()
  await entityAssetDeleteWorkspaceFileAsset(db, asset.entityType, asset)
  await markDeleted(db, asset.id, actor)
}

/** PD-0456 `WorkspaceFileAssetEndpoint.get`. */
export async function getWorkspaceFileAsset(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  slug: string,
  assetId: number
) {
  const { asset } = await workspaceAsset(db, actor, slug, assetId)
  if (!(await isProjectAccessibleTo(db, actor.userId, asset))) throw noAccess()
  if (!asset.isUploaded) throw notFound()
  return { asset, object: await readObject(bucket, asset) }
}

/** PD-0458 `AssetRestoreEndpoint.post`: also restores assets hidden by `deleted_at`. */
export async function createAssetRestore(db: LancityDb, actor: Actor, slug: string, assetId: number) {
  const { asset } = await workspaceAsset(db, actor, slug, assetId, true)
  if (!(await canModifyAsset(db, actor.userId, asset))) throw forbiddenError()
  await db
    .update(fileAssets)
    .set({ isDeleted: false, deletedAt: null, updatedById: actor.userId })
    .where(eq(fileAssets.id, asset.id))
}

/** PD-0466 `AssetCheckEndpoint.get`: existence is reported only for an asset the caller can access. */
export async function getAssetCheck(db: LancityDb, actor: Actor, slug: string, assetId: number) {
  const ctx = await requireWorkspaceRole(db, actor, slug, ALL_ROLES)
  const [asset] = await db
    .select()
    .from(fileAssets)
    .where(and(eq(fileAssets.id, assetId), eq(fileAssets.workspaceId, ctx.workspaceId), isNull(fileAssets.deletedAt)))
    .limit(1)
  return { exists: asset ? await isProjectAccessibleTo(db, actor.userId, asset) : false }
}

/** PD-0469 `WorkspaceAssetDownloadEndpoint.get`. */
export async function getWorkspaceAssetDownload(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  slug: string,
  assetId: number
) {
  return getWorkspaceFileAsset(db, bucket, actor, slug, assetId)
}

// ---------------------------------------------------------------------------------------- project assets

/** PD-0459 `ProjectAssetEndpoint.get_entity_id_field`. */
export const getEntityIdFieldProjectAsset = (entityType: string | null, entityId?: number) =>
  getEntityIdField(entityType, entityId, projectEntityOptions)

/** PD-0467 `DuplicateAssetEndpoint.get_entity_id_field`. */
export const getEntityIdFieldDuplicateAsset = (entityType: string | null, entityId?: number) =>
  getEntityIdField(entityType, entityId)

/**
 * PD-0460 `ProjectAssetEndpoint.post`. The asset always belongs to the URL project. Plane passes `project_id` twice
 * for a project cover (a `TypeError`), so a project cover here is bound to the URL project and needs a project admin.
 */
export async function createProjectAsset(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  raw: unknown
): Promise<CreatedAsset> {
  const ctx = await requireProjectRole(db, actor, slug, projectId, ALL_ROLES)
  const input = parseInput(createAssetInputSchema, raw)
  const binding = getEntityIdField(input.entity_type, input.entity_identifier, projectEntityOptions)
  if (binding?.field === 'project_id') binding.id = undefined
  if (!(await canBindAsset(db, actor.userId, ctx.workspaceId, binding, projectId)))
    throw new ServiceError(400, 'INVALID_ENTITY', 'Invalid entity identifier.')
  const name = safeAssetName(input.name)
  const size = sizeFor(input.size)
  const values = {
    attributes: { name, type: input.type, size },
    asset: newAssetKey(ctx.workspaceId, name),
    size,
    workspaceId: ctx.workspaceId,
    createdById: actor.userId,
    updatedById: actor.userId,
    entityType: input.entity_type,
    ...bindingValues(binding),
    projectId
  }
  if (input.entity_type === 'PROJECT_COVER' && !(await canModifyAsset(db, actor.userId, values))) throw forbiddenError()
  const [asset] = await db.insert(fileAssets).values(values).returning()
  return { asset, assetUrl: assetUrl(asset, slug) }
}

async function projectAsset(db: LancityDb, actor: Actor, slug: string, projectId: number, assetId: number) {
  const ctx = await requireProjectRole(db, actor, slug, projectId, ALL_ROLES)
  const asset = await findAsset(
    db,
    and(eq(fileAssets.id, assetId), eq(fileAssets.workspaceId, ctx.workspaceId), eq(fileAssets.projectId, projectId))
  )
  return { ctx, asset }
}

/** PD-0461 `ProjectAssetEndpoint.patch`: confirm the upload. */
export async function updateProjectAsset(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  slug: string,
  projectId: number,
  assetId: number,
  raw: unknown
) {
  const input = parseInput(updateAssetInputSchema, raw ?? {})
  const { asset } = await projectAsset(db, actor, slug, projectId, assetId)
  if (!(await canModifyAsset(db, actor.userId, asset))) throw forbiddenError()
  await confirmUpload(db, bucket, actor, asset, input.attributes)
}

/** PD-0462 `ProjectAssetEndpoint.delete`. */
export async function deleteProjectAsset(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  assetId: number
) {
  const { asset } = await projectAsset(db, actor, slug, projectId, assetId)
  if (!(await canModifyAsset(db, actor.userId, asset))) throw forbiddenError()
  await markDeleted(db, asset.id, actor)
}

/** PD-0463 `ProjectAssetEndpoint.get` and PD-0470 `ProjectAssetDownloadEndpoint.get`. */
export async function getProjectAsset(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  slug: string,
  projectId: number,
  assetId: number
) {
  const { asset } = await projectAsset(db, actor, slug, projectId, assetId)
  if (!(await isProjectAccessibleTo(db, actor.userId, asset))) throw noAccess()
  if (!asset.isUploaded) throw notFound()
  return { asset, object: await readObject(bucket, asset) }
}
export const getProjectAssetDownload = getProjectAsset

/** PD-0464 `ProjectBulkAssetEndpoint.save_project_cover`. */
export async function saveProjectCoverProjectBulkAsset(db: LancityDb, asset: FileAssetRow, projectId: number) {
  // Only an asset registered as a project cover may become one (an attachment must not be shown as a cover).
  if (asset.entityType !== 'PROJECT_COVER' || asset.isDeleted) return
  await db.update(projects).set({ coverImageAssetId: asset.id }).where(eq(projects.id, projectId))
}

const bulkEntityField: Record<string, string> = {
  ISSUE_DESCRIPTION: 'issue_id',
  COMMENT_DESCRIPTION: 'comment_id',
  PAGE_DESCRIPTION: 'page_id',
  DRAFT_ISSUE_DESCRIPTION: 'draft_issue_id'
}

/**
 * PD-0465 `ProjectBulkAssetEndpoint.post`: attach the caller's fresh uploads to the entity just created. Only the
 * caller's own assets that are unassociated or already in this project are touched. The first asset decides the
 * entity type, as in Plane.
 */
export async function createProjectBulkAsset(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  entityId: number,
  raw: unknown
) {
  const ctx = await requireProjectRole(db, actor, slug, projectId, ALL_ROLES)
  const input = parseInput(bulkAssetInputSchema, raw)
  const rows = await db
    .select()
    .from(fileAssets)
    .where(
      and(
        inArray(fileAssets.id, input.asset_ids),
        eq(fileAssets.workspaceId, ctx.workspaceId),
        eq(fileAssets.createdById, actor.userId),
        isNull(fileAssets.deletedAt),
        or(eq(fileAssets.projectId, projectId), isNull(fileAssets.projectId))
      )
    )
    .orderBy(desc(fileAssets.createdAt), desc(fileAssets.id))
  const asset = rows[0]
  if (!asset) throw notFound()
  const ids = rows.map(row => row.id)
  const type = asset.entityType ?? ''
  if (type === 'PROJECT_COVER') {
    // Check against the project the cover is about to be set on.
    if (!(await canModifyAsset(db, actor.userId, { ...asset, projectId }))) throw forbiddenError()
    const covers = rows.filter(row => row.entityType === 'PROJECT_COVER')
    await db
      .update(fileAssets)
      .set({ projectId })
      .where(
        inArray(
          fileAssets.id,
          covers.map(row => row.id)
        )
      )
    for (const row of covers) await saveProjectCoverProjectBulkAsset(db, row, projectId)
  }
  const field = bulkEntityField[type]
  if (!field) return
  const binding: EntityBinding = { field, id: entityId }
  if (!(await canBindAsset(db, actor.userId, ctx.workspaceId, binding, projectId))) return
  // The bulk call can arrive after the entity is deleted, which breaks the foreign key. Plane ignores that.
  try {
    await db
      .update(fileAssets)
      .set(type === 'ISSUE_DESCRIPTION' ? { ...bindingValues(binding), projectId } : bindingValues(binding))
      .where(inArray(fileAssets.id, ids))
  } catch (error) {
    if (!isIntegrityError(error)) throw error
  }
}

// ------------------------------------------------------------------------------------------- duplicate

/**
 * PD-0468 `DuplicateAssetEndpoint.post`: copy an uploaded asset of the workspace to a new asset bound to another
 * entity. R2 has no server side copy, so the object is streamed to the new key.
 */
export async function duplicateAsset(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  slug: string,
  assetId: number,
  raw: unknown
) {
  const ctx = await requireWorkspaceRole(db, actor, slug, ALL_ROLES)
  const input = parseInput(duplicateAssetInputSchema, raw)
  const store = requireBucket(bucket)
  const [original] = await db
    .select()
    .from(fileAssets)
    .where(
      and(
        eq(fileAssets.id, assetId),
        eq(fileAssets.isUploaded, true),
        eq(fileAssets.workspaceId, ctx.workspaceId),
        isNull(fileAssets.deletedAt)
      )
    )
    .limit(1)
  if (!original) throw new ServiceError(404, 'ASSET_NOT_FOUND', 'Asset not found')
  if (!(await isProjectAccessibleTo(db, actor.userId, original))) throw noAccess()
  // A project cover copy is stored on the project named by entity_id.
  let projectId = input.entity_type === 'PROJECT_COVER' ? input.entity_id : input.project_id
  if (projectId) {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, ctx.workspaceId)))
      .limit(1)
    if (!project) throw new ServiceError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    try {
      await requireProjectRole(db, actor, slug, projectId, ALL_ROLES)
    } catch (error) {
      if (error instanceof ServiceError && error.status === 403)
        throw new ServiceError(403, 'FORBIDDEN', "You don't have access to this project.")
      throw error
    }
  } else projectId = original.projectId ?? undefined
  const binding = getEntityIdField(input.entity_type, input.entity_id)
  if (binding?.field === 'project_id') binding.id = undefined
  if (!(await canBindAsset(db, actor.userId, ctx.workspaceId, binding, projectId)))
    throw new ServiceError(400, 'INVALID_ENTITY', 'Invalid entity type or entity id')
  const { name, type, size } = attributesOf(original)
  const safeName = safeAssetName(name)
  const key = newAssetKey(ctx.workspaceId, safeName)
  const [copy] = await db
    .insert(fileAssets)
    .values({
      attributes: JSON.parse(JSON.stringify({ name, type, size })) as JsonValue,
      asset: key,
      size: original.size,
      workspaceId: ctx.workspaceId,
      createdById: actor.userId,
      updatedById: actor.userId,
      entityType: input.entity_type,
      projectId: projectId ?? null,
      storageMetadata: original.storageMetadata,
      ...bindingValues(binding)
    })
    .returning()
  try {
    if (!(await copyObject(store, original.asset, key))) throw notFound()
    await db.update(fileAssets).set({ isUploaded: true }).where(eq(fileAssets.id, copy.id))
  } catch (error) {
    await db.delete(fileAssets).where(eq(fileAssets.id, copy.id))
    await deleteFiles(store, [key]).catch(() => undefined)
    throw error
  }
  return { asset_id: copy.id, asset_url: assetUrl(copy, slug) }
}

// --------------------------------------------------------------------------------------- upload content

/**
 * Replacement for the presigned POST: the client sends the bytes of a registered asset to the Worker. Only the
 * creator uploads, and only until the upload is confirmed with PATCH. `scope` is empty for user assets.
 */
export async function uploadAssetContent(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  assetId: number,
  request: Request,
  scope: { slug?: string; projectId?: number } = {}
) {
  let asset: FileAssetRow
  if (!scope.slug) asset = await ownAsset(db, actor, assetId)
  else {
    const ctx = scope.projectId
      ? await requireProjectRole(db, actor, scope.slug, scope.projectId, ALL_ROLES)
      : await requireWorkspaceRole(db, actor, scope.slug, ALL_ROLES)
    asset = await findAsset(
      db,
      and(
        eq(fileAssets.id, assetId),
        eq(fileAssets.workspaceId, ctx.workspaceId),
        scope.projectId ? eq(fileAssets.projectId, scope.projectId) : undefined
      )
    )
    if (!(await isProjectAccessibleTo(db, actor.userId, asset))) throw noAccess()
  }
  if (asset.createdById !== actor.userId)
    throw new ServiceError(403, 'FORBIDDEN', 'You are not allowed to upload this asset')
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
  if (
    ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'].includes(type) &&
    !validImage(bytes, type === 'image/jpg' ? 'image/jpeg' : type)
  )
    throw new ServiceError(400, 'INVALID_ASSET', 'Image content does not match its type')
  await requireBucket(bucket).put(asset.asset, bytes, { httpMetadata: { contentType: type } })
  await db
    .update(fileAssets)
    .set({ size: bytes.byteLength, updatedById: actor.userId })
    .where(and(eq(fileAssets.id, asset.id), eq(fileAssets.isUploaded, false)))
  return { id: asset.id, size: bytes.byteLength }
}
