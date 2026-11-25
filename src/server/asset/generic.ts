import { and, eq, isNull } from 'drizzle-orm'
import { fileAssets } from '@/db/schema/content'
import { projectMembers, projects } from '@/db/schema/workspace'
import { parseInput } from '@/server/api/v1/validation'
import { canModifyAsset, isProjectAccessibleTo } from '@/server/asset/access'
import { assetUrl, attributesOf, fileSizeLimit, newAssetKey, safeAssetName } from '@/server/asset/model-rules'
import { requireBucket } from '@/server/asset/storage'
import { linkto } from '@/data/linkto'
import { forbiddenError, ServiceError } from '@/server/common/errors'
import { ROLE, requireWorkspaceRole } from '@/server/common/permissions'
import type { Actor } from '@/types/auth/schema'
import { createGenericAssetInputSchema } from '@/types/content/p2-asset-schema'
import type { LancityDb } from '@/types/database/schema'

const ALL_ROLES = [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST]

/**
 * PD-0059 `GenericAssetEndpoint.post`: register an issue attachment upload for a project, optionally keyed by an
 * external id and source so an integration does not upload the same file twice (409 with the existing asset).
 */
export async function createGenericAsset(db: LancityDb, actor: Actor, slug: string, raw: unknown) {
  const ctx = await requireWorkspaceRole(db, actor, slug, ALL_ROLES)
  const input = parseInput(createGenericAssetInputSchema, raw)
  const name = safeAssetName(input.name, '')
  if (!name) throw new ServiceError(400, 'VALIDATION_ERROR', 'Name and size are required fields.')
  const limit = fileSizeLimit()
  const size = Math.min(input.size ?? limit, limit)
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, input.project_id), eq(projects.workspaceId, ctx.workspaceId)))
    .limit(1)
  if (!project) throw new ServiceError(404, 'PROJECT_NOT_FOUND', 'Project not found.')
  const [member] = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.memberId, actor.userId),
        eq(projectMembers.workspaceId, ctx.workspaceId),
        eq(projectMembers.projectId, project.id),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt)
      )
    )
    .limit(1)
  if (!member) throw new ServiceError(403, 'FORBIDDEN', "You don't have access to this project.")
  if (input.external_id && input.external_source) {
    const [existing] = await db
      .select()
      .from(fileAssets)
      .where(
        and(
          eq(fileAssets.workspaceId, ctx.workspaceId),
          eq(fileAssets.projectId, project.id),
          eq(fileAssets.externalSource, input.external_source),
          eq(fileAssets.externalId, input.external_id),
          eq(fileAssets.isDeleted, false),
          isNull(fileAssets.deletedAt)
        )
      )
      .limit(1)
    if (existing)
      throw new ServiceError(409, 'ASSET_EXTERNAL_CONFLICT', 'Asset with same external id and source already exists', {
        asset_id: existing.id,
        asset_url: assetUrl(existing, slug)
      })
  }
  const [asset] = await db
    .insert(fileAssets)
    .values({
      attributes: { name, type: input.type, size },
      asset: newAssetKey(ctx.workspaceId, name),
      size,
      workspaceId: ctx.workspaceId,
      projectId: project.id,
      createdById: actor.userId,
      updatedById: actor.userId,
      externalId: input.external_id ?? null,
      externalSource: input.external_source ?? null,
      // Bound to an issue later, as an issue attachment.
      entityType: 'ISSUE_ATTACHMENT'
    })
    .returning()
  return { asset, assetUrl: assetUrl(asset, slug) }
}

async function genericAsset(db: LancityDb, actor: Actor, slug: string, assetId: number) {
  const ctx = await requireWorkspaceRole(db, actor, slug, ALL_ROLES)
  const [asset] = await db
    .select()
    .from(fileAssets)
    .where(
      and(
        eq(fileAssets.id, assetId),
        eq(fileAssets.workspaceId, ctx.workspaceId),
        eq(fileAssets.isDeleted, false),
        isNull(fileAssets.deletedAt)
      )
    )
    .limit(1)
  if (!asset) throw new ServiceError(404, 'ASSET_NOT_FOUND', 'Asset not found')
  // A project-bound asset requires active membership of its project.
  if (!(await isProjectAccessibleTo(db, actor.userId, asset)))
    throw new ServiceError(403, 'FORBIDDEN', "You don't have access to this asset.")
  return asset
}

/** PD-0058 `GenericAssetEndpoint.get`: the asset and the URL that serves it (inline for allow-listed images). */
export async function getGenericAsset(db: LancityDb, actor: Actor, slug: string, assetId: number) {
  const asset = await genericAsset(db, actor, slug, assetId)
  if (!asset.isUploaded) throw new ServiceError(400, 'ASSET_NOT_UPLOADED', 'Asset not yet uploaded')
  const { name, type } = attributesOf(asset)
  return {
    asset_id: asset.id,
    asset_url: `${linkto.apiV1}/workspaces/${slug}/assets/${asset.id}?disposition=inline`,
    asset_name: name ?? '',
    asset_type: type ?? ''
  }
}

/** PD-0060 `GenericAssetEndpoint.patch`: confirming an upload only ever marks the asset as uploaded. */
export async function updateGenericAsset(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  slug: string,
  assetId: number
) {
  const asset = await genericAsset(db, actor, slug, assetId)
  if (!(await canModifyAsset(db, actor.userId, asset))) throw forbiddenError()
  const head = await requireBucket(bucket).head(asset.asset)
  if (!head) throw new ServiceError(400, 'ASSET_NOT_UPLOADED', 'The asset is not uploaded.')
  await db
    .update(fileAssets)
    .set({ isUploaded: true, size: head.size, updatedById: actor.userId })
    .where(eq(fileAssets.id, asset.id))
}
