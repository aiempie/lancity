import { registerJobHandler, registerScheduled } from '@/server/common/jobs'
import { copyS3ObjectsOfDescriptionAndAssets, COPY_S3_OBJECTS, type CopyS3ObjectsPayload } from './copy-s3-object'
import { deleteUnuploadedFileAsset, DELETE_UNUPLOADED_FILE_ASSET } from './file-asset'
import { getAssetObjectMetadata, GET_ASSET_OBJECT_METADATA } from './storage-metadata'

/** Asset background jobs, loaded by the job registry. */
export function register(): void {
  registerJobHandler<CopyS3ObjectsPayload>(COPY_S3_OBJECTS, (payload, env) =>
    copyS3ObjectsOfDescriptionAndAssets(env, payload)
  )
  registerJobHandler<{ assetId: number }>(GET_ASSET_OBJECT_METADATA, (payload, env) =>
    getAssetObjectMetadata(env, payload.assetId)
  )
  const cleanup = async (env: Parameters<typeof deleteUnuploadedFileAsset>[0]) => {
    await deleteUnuploadedFileAsset(env)
  }
  registerJobHandler(DELETE_UNUPLOADED_FILE_ASSET, (_payload, env) => cleanup(env))
  // Plane beat: every day at 02:00 UTC.
  registerScheduled('0 2 * * *', cleanup, DELETE_UNUPLOADED_FILE_ASSET)
}
