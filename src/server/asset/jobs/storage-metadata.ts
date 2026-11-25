import { eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { fileAssets } from '@/db/schema/content'
import { getObjectMetadata } from '@/server/asset/storage'
import { logException } from '@/server/common/exception-logger'
import { enqueueJob } from '@/server/common/jobs'
import type { InfraEnv } from '@/server/common/env'

export const GET_ASSET_OBJECT_METADATA = 'asset.storage_metadata'

/** Queue the metadata lookup of an asset (Plane `get_asset_object_metadata.delay`). */
export function enqueueAssetMetadata(env: InfraEnv, assetId: number) {
  return enqueueJob(env, { type: GET_ASSET_OBJECT_METADATA, payload: { assetId } })
}

/**
 * PD-1219 `get_asset_object_metadata`: store the R2 object metadata on the asset. A missing asset or object
 * is expected and ends the job. Other failures are logged and not retried, as in Plane.
 */
export async function getAssetObjectMetadata(env: InfraEnv, assetId: number): Promise<void> {
  try {
    const db = getDb(env.DB)
    const [asset] = await db
      .select({ key: fileAssets.asset })
      .from(fileAssets)
      .where(eq(fileAssets.id, assetId))
      .limit(1)
    if (!asset || !env.ASSET_BUCKET) return
    const metadata = await getObjectMetadata(env.ASSET_BUCKET, asset.key)
    await db.update(fileAssets).set({ storageMetadata: metadata }).where(eq(fileAssets.id, assetId))
  } catch (error) {
    logException(error, { context: { label: GET_ASSET_OBJECT_METADATA, assetId } })
  }
}
