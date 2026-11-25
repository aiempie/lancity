import { apiV1Routes } from '@/data/linkto'
import { Hono } from 'hono'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput } from '@/server/api/v1/validation'
import { getEnv } from '@/server/common/env'
import { downloadPdfExport, getPdfExportStatus } from '@/server/pdf/async-export'
import { contentDisposition, exportToPdfController, printHtmlController } from '@/server/pdf/pdf-export.controller'
import { mapPdfErrorToHttp } from '@/server/pdf/errors'
import type { ApiEnv } from '@/types/api/schema'
import { pdfTokenSchema } from '@/types/content/p4-pdf-schema'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/**
 * PDF export of a page (Plane `POST /live/pdf-export/`). Mount at `linkto.apiProject`, which supplies `:slug` and
 * `:projectId`. Paths are relative to that mount, like `exports.ts`.
 */
const paths = {
  export: apiV1Routes.pagePdfExport,
  preview: apiV1Routes.pagePdfPreview,
  status: apiV1Routes.pdfExportStatus,
  download: apiV1Routes.pdfExportDownload
}

export const pdfRoutes = new Hono<ApiEnv>()
pdfRoutes.use('*', authenticate)
pdfRoutes.post(paths.export, c => exportToPdfController(c))
pdfRoutes.get(paths.preview, c => printHtmlController(c))
pdfRoutes.get(paths.status, async c => {
  try {
    return c.json(await getPdfExportStatus(getEnv(), c.get('actor'), parseInput(pdfTokenSchema, c.req.param('token'))))
  } catch (error) {
    const { status, error: message } = mapPdfErrorToHttp(error)
    return c.json({ message }, status as ContentfulStatusCode)
  }
})
pdfRoutes.get(paths.download, async c => {
  try {
    const file = await downloadPdfExport(getEnv(), c.get('actor'), parseInput(pdfTokenSchema, c.req.param('token')))
    return new Response(file.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': contentDisposition(file.fileName),
        'Content-Length': String(file.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    })
  } catch (error) {
    const { status, error: message } = mapPdfErrorToHttp(error)
    return c.json({ message }, status as ContentfulStatusCode)
  }
})

export default pdfRoutes
