import { and, eq, inArray, isNull, lt } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { fileAssets } from '@/db/schema/content'
import { deleteFiles } from '@/server/asset/storage'
import { enqueueJob } from '@/server/common/jobs'
import { retentionDays, type InfraEnv } from '@/server/common/env'

export const DELETE_UNUPLOADED_FILE_ASSET = 'asset.delete_unuploaded'

const BATCH = 90
const MAX_BATCHES_PER_RUN = 10
const DAY_MS = 86_400_000

/**
 * PD-1135 `delete_unuploaded_file_asset`: soft delete the assets whose upload was never confirmed within
 * `UNUPLOADED_ASSET_DELETE_DAYS` (default 7), like Plane's soft deleting queryset, and drop any partial R2 object.
 * A run handles a bounded number of rows, then queues itself again, so a large backlog never exceeds the
 * subrequest limit of one invocation. Safe to retry.
 */
export async function deleteUnuploadedFileAsset(env: InfraEnv, now = Date.now()): Promise<number> {
  const db = getDb(env.DB)
  const cutoff = new Date(now - retentionDays(env.UNUPLOADED_ASSET_DELETE_DAYS, 7) * DAY_MS)
  let total = 0
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
    const rows = await db
      .select({ id: fileAssets.id, key: fileAssets.asset })
      .from(fileAssets)
      .where(and(lt(fileAssets.createdAt, cutoff), eq(fileAssets.isUploaded, false), isNull(fileAssets.deletedAt)))
      .limit(BATCH)
    if (!rows.length) return total
    if (env.ASSET_BUCKET)
      await deleteFiles(
        env.ASSET_BUCKET,
        rows.map(row => row.key)
      )
    await db
      .update(fileAssets)
      .set({ deletedAt: new Date(now), isDeleted: true })
      .where(
        inArray(
          fileAssets.id,
          rows.map(row => row.id)
        )
      )
    total += rows.length
  }
  await enqueueJob(env, { type: DELETE_UNUPLOADED_FILE_ASSET, delaySeconds: 60 })
  return total
}
