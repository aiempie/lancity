import type { JobMessage } from '@/server/common/jobs'

/** Job types handled by `src/server/page/jobs.ts`. Payloads carry ids only; handlers read the page from D1. */
export const PAGE_JOB = {
  transaction: 'page.transaction',
  version: 'page.version',
  /** Consumed by the asset domain (copy_s3_objects_of_description_and_assets). Unknown types are acknowledged and dropped. */
  copyAssets: 'asset.copy_s3_objects'
} as const

/**
 * Push a page job. Best effort: a missing Queue binding, or running outside a Worker (unit tests),
 * never fails the mutation that triggered it.
 */
export async function emitPageJob(type: string, payload: Record<string, unknown>): Promise<void> {
  let infra: [typeof import('@/server/common/env'), typeof import('@/server/common/jobs')]
  try {
    infra = await Promise.all([import('@/server/common/env'), import('@/server/common/jobs')])
  } catch {
    return
  }
  try {
    const message: JobMessage = { type, payload }
    await infra[1].enqueueJob(infra[0].getEnv(), message)
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'warn',
        label: 'page.event',
        message: error instanceof Error ? error.message : String(error)
      })
    )
  }
}
