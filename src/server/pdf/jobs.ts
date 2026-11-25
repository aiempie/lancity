import { registerJobHandler, registerScheduled } from '@/server/common/jobs'
import { deleteOldPdfExports, runPdfExportJob } from '@/server/pdf/async-export'
import { PDF_JOB } from '@/server/pdf/events'
import { pdfExportJobSchema } from '@/types/content/p4-pdf-schema'

export { PDF_JOB }

/** Called once by `job-registry.ts`. */
export function register(): void {
  registerJobHandler(PDF_JOB.export, (payload, env) => {
    const parsed = pdfExportJobSchema.safeParse(payload)
    // A malformed payload can never succeed, so drop it instead of retrying.
    if (!parsed.success)
      return void console.error(JSON.stringify({ level: 'error', label: 'job:pdf.export', message: 'Invalid payload' }))
    return runPdfExportJob(env, parsed.data)
  })
  registerJobHandler(PDF_JOB.cleanup, async (_payload, env) => {
    await deleteOldPdfExports(env)
  })
  registerScheduled(
    '45 2 * * *',
    async env => {
      await deleteOldPdfExports(env)
    },
    PDF_JOB.cleanup
  )
}
