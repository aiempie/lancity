import { assetUrl, type FileAssetRow } from '@/server/asset/model-rules'

/** PD-1374 `FileAsset.__str__`: the stored key. */
export function formatFileAsset(asset: Pick<FileAssetRow, 'asset'>): string {
  return asset.asset
}

/** Plane `FileAssetSerializer` (`fields = "__all__"`) plus `asset_url`. */
export function presentFileAsset(asset: FileAssetRow, slug = '') {
  return {
    id: asset.id,
    created_at: asset.createdAt,
    updated_at: asset.updatedAt,
    created_by: asset.createdById,
    updated_by: asset.updatedById,
    deleted_at: asset.deletedAt,
    attributes: asset.attributes,
    asset: asset.asset,
    user: asset.userId,
    workspace: asset.workspaceId,
    draft_issue: asset.draftIssueId,
    project: asset.projectId,
    issue: asset.issueId,
    comment: asset.commentId,
    page: asset.pageId,
    entity_type: asset.entityType,
    entity_identifier: asset.entityIdentifier,
    is_deleted: asset.isDeleted,
    is_archived: asset.isArchived,
    external_id: asset.externalId,
    external_source: asset.externalSource,
    size: asset.size,
    is_uploaded: asset.isUploaded,
    storage_metadata: asset.storageMetadata,
    asset_url: assetUrl(asset, slug)
  }
}
