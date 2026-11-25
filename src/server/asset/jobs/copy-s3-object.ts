import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { fileAssets, pages } from '@/db/schema/content'
import { issues } from '@/db/schema/issue'
import {
  bindingValues,
  getEntityIdField as entityIdField,
  newAssetKey,
  safeAssetName
} from '@/server/asset/model-rules'
import { convertHtmlDocumentToAllFormats } from '@/server/collaboration/codec'
import { copyObject, requireBucket } from '@/server/asset/storage'
import type { InfraEnv } from '@/server/common/env'
import { logException } from '@/server/common/exception-logger'
import { enqueueJob } from '@/server/common/jobs'
import { isEntityId } from '@/server/common/uuid'
import { stripTags } from '@/server/issue/comment-html'
import { convertDocumentBodySchema } from '@/types/content/p4-live-schema'
import type { LancityDb } from '@/types/database/schema'

export const COPY_S3_OBJECTS = 'asset.copy_s3_objects'
export type CopyEntityName = 'PAGE' | 'ISSUE'
export type CopyS3ObjectsPayload = {
  entityName: CopyEntityName
  entityIdentifier: number
  projectId: number
  userId: number
}
export type DuplicatedAsset = { new_asset_id: number | string; old_asset_id: number | string }

const IMAGE_TAG = 'image-component'

/** Queue the copy of the assets referenced by a duplicated page or issue description. */
export function enqueueCopyS3Objects(env: InfraEnv, payload: CopyS3ObjectsPayload) {
  return enqueueJob(env, { type: COPY_S3_OBJECTS, payload })
}

/**
 * PD-1097 `get_entity_id_field`. Plane also maps WORKSPACE_LOGO to `workspace_id`, which would overwrite the
 * workspace of a copy with an entity id, so it is not mapped here.
 */
export const getEntityIdField = (entityType: string | null | undefined, entityId: number) =>
  entityIdField(entityType, entityId, { draft: true })

const tagPattern = (tag: string) => new RegExp(`<${tag}\\b[^>]*>`, 'gi')
const srcPattern = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i

/** PD-1098 `extract_asset_ids`: the `src` of each `tag` that is an uploaded asset id. External URLs are skipped. */
export function extractAssetIds(html: string, tag: string): number[] {
  const ids: number[] = []
  for (const [element] of html.matchAll(tagPattern(tag))) {
    const match = srcPattern.exec(element)
    const src = match?.[1] ?? match?.[2]
    if (src && isEntityId(src)) ids.push(Number(src))
  }
  return ids
}

/** PD-1099 `replace_asset_ids`: point each `tag` at the duplicated asset. The rest of the HTML is untouched. */
export function replaceAssetIds(html: string, tag: string, duplicated: DuplicatedAsset[]): string {
  const map = new Map(duplicated.map(item => [String(item.old_asset_id), String(item.new_asset_id)]))
  return html.replace(tagPattern(tag), element =>
    element.replace(srcPattern, (whole, double: string | undefined, single: string | undefined) => {
      const next = map.get(double ?? single ?? '')
      return next === undefined ? whole : `src="${next}"`
    })
  )
}

/** PD-1100 `update_description`: save the rewritten HTML and its plain text on the page or issue. */
export async function updateDescription(
  db: LancityDb,
  entityName: CopyEntityName,
  entity: { id: number; descriptionHtml: string },
  duplicated: DuplicatedAsset[],
  tag: string
): Promise<string> {
  const html = replaceAssetIds(entity.descriptionHtml, tag, duplicated)
  const set = { descriptionHtml: html, descriptionStripped: html ? stripTags(html) : null }
  if (entityName === 'PAGE') await db.update(pages).set(set).where(eq(pages.id, entity.id))
  else await db.update(issues).set(set).where(eq(issues.id, entity.id))
  return html
}

/**
 * PD-1101 `sync_with_external_service`: Plane posted the HTML to the live server's `/convert-document/` (without the
 * secret header, so a protected server answered 401 and the result was lost). Here the same conversion runs in the
 * process, with the same body validation as the route, so no HTTP call or secret is involved. Returns `{}` when the
 * HTML cannot be converted; the caller then clears the stale binary state.
 */
export function syncWithExternalService(
  _env: InfraEnv,
  entityName: CopyEntityName,
  descriptionHtml: string
): { description_json?: unknown; description_binary?: string } {
  const parsed = convertDocumentBodySchema.safeParse({ description_html: descriptionHtml, variant: entityName === 'PAGE' ? 'rich' : 'document' })
  if (!parsed.success) {
    logException(new Error(`convert-document validation failed: ${parsed.error.issues.map(issue => issue.message).join('; ')}`), {
      context: { label: COPY_S3_OBJECTS }
    })
    return {}
  }
  try {
    const { description_json, description_binary } = convertHtmlDocumentToAllFormats(parsed.data.description_html)
    return { description_json, description_binary }
  } catch (error) {
    logException(error, { context: { label: COPY_S3_OBJECTS } })
    return {}
  }
}

/** PD-1102 `copy_assets`: duplicate each referenced asset of the project and bind the copy to the entity. */
export async function copyAssets(
  db: LancityDb,
  bucket: R2Bucket,
  entity: { workspaceId: number },
  entityIdentifier: number,
  projectId: number,
  assetIds: number[],
  userId: number
): Promise<DuplicatedAsset[]> {
  const duplicated: DuplicatedAsset[] = []
  if (!assetIds.length) return duplicated
  const originals = await db
    .select()
    .from(fileAssets)
    .where(
      and(
        eq(fileAssets.workspaceId, entity.workspaceId),
        eq(fileAssets.projectId, projectId),
        inArray(fileAssets.id, [...new Set(assetIds)].slice(0, 80)),
        eq(fileAssets.isUploaded, true),
        isNull(fileAssets.deletedAt)
      )
    )
  for (const original of originals) {
    const attributes = (original.attributes ?? {}) as { name?: string; type?: string; size?: number }
    const key = newAssetKey(entity.workspaceId, safeAssetName(attributes.name))
    const [copy] = await db
      .insert(fileAssets)
      .values({
        attributes: { name: attributes.name, type: attributes.type, size: attributes.size } as never,
        asset: key,
        size: original.size,
        workspaceId: entity.workspaceId,
        createdById: userId,
        updatedById: userId,
        entityType: original.entityType,
        projectId,
        storageMetadata: original.storageMetadata,
        ...bindingValues(getEntityIdField(original.entityType, entityIdentifier))
      })
      .returning({ id: fileAssets.id })
    if (await copyObject(bucket, original.asset, key)) {
      await db.update(fileAssets).set({ isUploaded: true }).where(eq(fileAssets.id, copy.id))
      duplicated.push({ new_asset_id: copy.id, old_asset_id: original.id })
    } else await db.delete(fileAssets).where(eq(fileAssets.id, copy.id))
  }
  return duplicated
}

/**
 * PD-1103 `copy_s3_objects_of_description_and_assets`: copy the assets used by the description of a duplicated page or
 * issue, rewrite the description to the copies and refresh its JSON and binary form from the live server. Errors are
 * logged and the job ends, as in Plane.
 */
export async function copyS3ObjectsOfDescriptionAndAssets(env: InfraEnv, payload: CopyS3ObjectsPayload): Promise<void> {
  try {
    const { entityName, entityIdentifier, projectId, userId } = payload
    if (entityName !== 'PAGE' && entityName !== 'ISSUE') throw new Error(`Unsupported entity_name: ${entityName}`)
    const db = getDb(env.DB)
    const columns = (t: typeof pages | typeof issues) => ({
      id: t.id,
      workspaceId: t.workspaceId,
      descriptionHtml: t.descriptionHtml
    })
    const [entity] =
      entityName === 'PAGE'
        ? await db.select(columns(pages)).from(pages).where(eq(pages.id, entityIdentifier)).limit(1)
        : await db.select(columns(issues)).from(issues).where(eq(issues.id, entityIdentifier)).limit(1)
    if (!entity) throw new Error(`${entityName} ${entityIdentifier} does not exist`)
    const assetIds = extractAssetIds(entity.descriptionHtml, IMAGE_TAG)
    const duplicated = await copyAssets(
      db,
      requireBucket(env.ASSET_BUCKET),
      entity,
      entityIdentifier,
      projectId,
      assetIds,
      userId
    )
    const html = await updateDescription(db, entityName, entity, duplicated, IMAGE_TAG)
    const external = syncWithExternalService(env, entityName, html)
    if (external.description_json && external.description_binary) {
      const set = {
        descriptionJson: external.description_json as never,
        descriptionBinary: Buffer.from(external.description_binary, 'base64')
      }
      if (entityName === 'PAGE') await db.update(pages).set(set).where(eq(pages.id, entity.id))
      else await db.update(issues).set(set).where(eq(issues.id, entity.id))
    } else if (duplicated.length) {
      // The copied binary state still points at the original assets. Drop it so the editor rebuilds from the rewritten HTML.
      const stale = { descriptionBinary: null }
      if (entityName === 'PAGE') await db.update(pages).set(stale).where(eq(pages.id, entity.id))
      else await db.update(issues).set(stale).where(eq(issues.id, entity.id))
    }
  } catch (error) {
    logException(error, { context: { label: COPY_S3_OBJECTS } })
  }
}
