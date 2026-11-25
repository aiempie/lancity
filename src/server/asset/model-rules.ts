import { linkto } from '@/data/linkto'
import type { fileAssets } from '@/db/schema/content'
import { getEnv } from '@/server/common/env'
import { ServiceError } from '@/server/common/errors'
import { sanitizeFilename } from '@/server/common/path-validator'
import type { AssetEntityType } from '@/types/content/p2-asset-schema'

export type FileAssetRow = typeof fileAssets.$inferSelect
export type EntityBinding = { field: string; id?: number }

const DEFAULT_FILE_SIZE_LIMIT = 5 * 1024 * 1024
const STATIC_ENTITIES: readonly string[] = ['WORKSPACE_LOGO', 'USER_AVATAR', 'USER_COVER', 'PROJECT_COVER']

/** Plane `settings.FILE_SIZE_LIMIT`: 5 MiB unless the `FILE_SIZE_LIMIT` variable overrides it. */
export function fileSizeLimit(raw: unknown = getEnv().FILE_SIZE_LIMIT): number {
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_FILE_SIZE_LIMIT
}

/** Plane `sanitize_filename(name) or "unnamed"`, shortened so the R2 key stays well under 1024 bytes. */
export function safeAssetName(name: unknown, fallback = 'unnamed'): string {
  return (sanitizeFilename(name) ?? fallback).slice(0, 200)
}

/** New R2 key: `<workspace id>/<uuid>-<name>`, or `<uuid>-<name>` for user level assets. */
export function newAssetKey(workspaceId: number | null | undefined, name: string, prefix = ''): string {
  const id = `${prefix}${crypto.randomUUID().replaceAll('-', '')}-${name}`
  return workspaceId == null ? id : `${workspaceId}/${id}`
}

/** PD-1372 `get_upload_path`: key of a file stored by a multipart route. */
export function getUploadPath(workspaceId: number | null | undefined, filename: unknown): string {
  const name = sanitizeFilename(filename) ?? crypto.randomUUID().replaceAll('-', '')
  return workspaceId != null ? newAssetKey(workspaceId, name) : newAssetKey(null, name, 'user-')
}

/** PD-1373 `file_size`: reject a file larger than the limit (Plane `ValidationError`). */
export function fileSize(size: number, limit = fileSizeLimit()): void {
  if (size > limit)
    throw new ServiceError(413, 'FILE_TOO_LARGE', `File too large. Size should not exceed ${limit} bytes.`)
}

/** PD-1375 `FileAsset.asset_url`: the API path a client uses to read the asset, or null. */
export function assetUrl(
  asset: Pick<FileAssetRow, 'id' | 'entityType' | 'projectId' | 'issueId'>,
  slug: string
): string | null {
  const type = asset.entityType
  if (type && STATIC_ENTITIES.includes(type)) return `${linkto.apiV1}/assets/static/${asset.id}`
  if (type === 'ISSUE_ATTACHMENT')
    return `${linkto.apiV1}/workspaces/${slug}/projects/${asset.projectId}/issues/${asset.issueId}/attachments/${asset.id}`
  if (
    type &&
    ['ISSUE_DESCRIPTION', 'COMMENT_DESCRIPTION', 'PAGE_DESCRIPTION', 'DRAFT_ISSUE_DESCRIPTION'].includes(type)
  )
    return `${linkto.apiV1}/workspaces/${slug}/projects/${asset.projectId}/entity-assets/${asset.id}`
  return null
}

/**
 * PD-0449, 0459, 0467 and 1097 `get_entity_id_field`: the column an entity type binds to.
 * `draft` adds the draft issue description (project endpoints only); `workspace` adds the workspace logo
 * (background copy only). A project cover binds to a project, so the field is `project_id`.
 */
export function getEntityIdField(
  entityType: AssetEntityType | string | null | undefined,
  entityId: number | undefined,
  options: { draft?: boolean; workspace?: boolean } = {}
): EntityBinding | null {
  switch (entityType) {
    case 'WORKSPACE_LOGO':
      return options.workspace ? { field: 'workspace_id', id: entityId } : null
    case 'PROJECT_COVER':
      return { field: 'project_id', id: entityId }
    case 'USER_AVATAR':
    case 'USER_COVER':
      return { field: 'user_id', id: entityId }
    case 'ISSUE_ATTACHMENT':
    case 'ISSUE_DESCRIPTION':
      return { field: 'issue_id', id: entityId }
    case 'PAGE_DESCRIPTION':
      return { field: 'page_id', id: entityId }
    case 'COMMENT_DESCRIPTION':
      return { field: 'comment_id', id: entityId }
    case 'DRAFT_ISSUE_DESCRIPTION':
      return options.draft ? { field: 'draft_issue_id', id: entityId } : null
    default:
      return null
  }
}

/** Column values for `fileAssets` insert and update that bind an asset to its entity. */
export function bindingValues(binding: EntityBinding | null): Partial<FileAssetRow> {
  if (!binding?.id) return {}
  const columns: Record<string, keyof FileAssetRow> = {
    workspace_id: 'workspaceId',
    project_id: 'projectId',
    user_id: 'userId',
    issue_id: 'issueId',
    page_id: 'pageId',
    comment_id: 'commentId',
    draft_issue_id: 'draftIssueId'
  }
  const column = columns[binding.field]
  return column ? { [column]: binding.id } : {}
}

export function attributesOf(asset: { attributes: unknown }): { name?: string; type?: string; size?: number } {
  return asset.attributes && typeof asset.attributes === 'object' ? (asset.attributes as Record<string, never>) : {}
}
