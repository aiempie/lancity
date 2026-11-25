import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { getDb } from '@/db/client'
import { parseInput, readJson } from '@/server/api/v1/validation'
import { getEnv } from '@/server/common/env'
import { startPdfExport } from '@/server/pdf/async-export'
import { mapPdfErrorToHttp } from '@/server/pdf/errors'
import { buildPrintHtml, exportPagePdf, loadPageForPrint } from '@/server/pdf/pdf-export.service'
import type { ApiEnv } from '@/types/api/schema'
import { contentIdSchema } from '@/types/content/schema'
import { pdfExportBodySchema, type PdfExportBody } from '@/types/content/p4-pdf-schema'

type PdfContext = Context<ApiEnv>

/**
 * PD-2051 `parseRequest` (PD-2052, PD-2053): the session comes from the `authenticate` middleware instead of a
 * forwarded cookie, and slug, project and page come from the URL. The body is validated with Zod.
 */
export async function parseRequest(c: PdfContext) {
  const body = await readJson(c, pdfExportBodySchema)
  return {
    slug: c.req.param('slug')!,
    projectId: parseInput(contentIdSchema, c.req.param('projectId')),
    pageId: parseInput(contentIdSchema, c.req.param('pageId')),
    body
  }
}

/** `Content-Disposition` without header injection: no quotes, backslashes or control characters, ASCII fallback. */
export function contentDisposition(fileName: string): string {
  const safe = fileName.replaceAll(/["\\\r\n]/g, '').replaceAll(/[^\x20-\x7E]/g, '_')
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

/** PD-2055 `exportToPdf` (PD-2056 to PD-2059): `POST .../pages/:pageId/pdf-export`. */
export async function exportToPdfController(c: PdfContext): Promise<Response> {
  try {
    const { slug, projectId, pageId, body } = await parseRequest(c)
    const { async: asyncMode, ...input }: PdfExportBody = body
    const env = getEnv()
    const db = getDb()
    const actor = c.get('actor')
    if (asyncMode) return c.json(await startPdfExport(db, env, actor, slug, projectId, pageId, input), 202)
    const { pdfBuffer, outputFileName } = await exportPagePdf(db, env, actor, slug, projectId, pageId, input)
    return new Response(pdfBuffer as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': contentDisposition(outputFileName),
        'Content-Length': String(pdfBuffer.length),
        'Cache-Control': 'private, no-store'
      }
    })
  } catch (error) {
    const { status, error: message } = mapPdfErrorToHttp(error)
    // Unknown failures are logged once and hidden behind a generic message (PD-2058).
    if (status === 500)
      console.error(JSON.stringify({ level: 'error', label: 'PDF_EXPORT: Export failed', message: String(error) }))
    return c.json({ message }, status as ContentfulStatusCode)
  }
}

/** `GET .../pages/:pageId/pdf-export/preview`: the print HTML, for debugging and for browsers without the binding. */
export async function printHtmlController(c: PdfContext): Promise<Response> {
  try {
    const projectId = parseInput(contentIdSchema, c.req.param('projectId'))
    const pageId = parseInput(contentIdSchema, c.req.param('pageId'))
    const db = getDb()
    const page = await loadPageForPrint(db, c.get('actor'), c.req.param('slug')!, projectId, pageId)
    const html = await buildPrintHtml(db, getEnv(), page, { pageId })
    return c.html(html, 200, { 'Cache-Control': 'private, no-store' })
  } catch (error) {
    const { status, error: message } = mapPdfErrorToHttp(error)
    return c.json({ message }, status as ContentfulStatusCode)
  }
}
