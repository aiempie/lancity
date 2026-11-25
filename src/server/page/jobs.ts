import { registerJobHandler } from '@/server/common/jobs'
import { PAGE_JOB } from '@/server/page/events'
import { pageTransaction } from '@/server/page/jobs/page-transaction'
import { pageVersionTask } from '@/server/page/jobs/page-version'
import { pageTransactionJobSchema, pageVersionJobSchema } from '@/types/content/p2-page-schema'

/** Called once by `job-registry.ts`. Both handlers are idempotent because Queues deliver at least once. */
export function register(): void {
  registerJobHandler(PAGE_JOB.transaction, (payload, env) => {
    const parsed = pageTransactionJobSchema.safeParse(payload)
    // A malformed payload can never succeed, so drop it instead of retrying.
    if (!parsed.success)
      return void console.error(
        JSON.stringify({ level: 'error', label: 'job:page.transaction', message: 'Invalid payload' })
      )
    return pageTransaction(env, parsed.data)
  })
  registerJobHandler(PAGE_JOB.version, (payload, env) => {
    const parsed = pageVersionJobSchema.safeParse(payload)
    if (!parsed.success)
      return void console.error(
        JSON.stringify({ level: 'error', label: 'job:page.version', message: 'Invalid payload' })
      )
    return pageVersionTask(env, parsed.data)
  })
}
