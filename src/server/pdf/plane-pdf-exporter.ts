import {
  BACKGROUND_COLORS,
  BORDER_COLORS,
  BRAND_COLORS,
  CODE_COLORS,
  LINK_COLORS,
  MENTION_COLORS,
  TEXT_COLORS
} from '@/server/pdf/colors'
import { renderStoredHtml } from '@/server/pdf/html-content'
import { PdfGenerationError } from '@/server/pdf/errors'
import { renderNode } from '@/server/pdf/node-renderers'
import { escapeHtml } from '@/server/issue/comment-html'
import type { PdfExportMetadata, PdfPageSize, PdfRenderOptions, TipTapDocument } from '@/types/content/p4-pdf-schema'

/**
 * Port of Plane `plane-pdf-exporter.tsx`. Runtime decision: Cloudflare Browser Rendering (headless Chromium).
 * `@react-pdf/renderer` was rejected: it needs `fs` font files, `sharp` and a layout engine that runs poorly on
 * Workers, and its standard fonts cannot draw Vietnamese. Chromium prints HTML with real fonts and page breaks.
 * Called through the `BROWSER` binding (`quickAction("pdf")`), so no npm dependency and no API token.
 */

/** The `BROWSER` binding of Browser Rendering (Browser Run). */
export type BrowserBinding = { quickAction(action: 'pdf', body: Record<string, unknown>): Promise<Response> }

const FORMATS: Record<PdfPageSize, string> = {
  A4: 'a4',
  A3: 'a3',
  A2: 'a2',
  LETTER: 'letter',
  LEGAL: 'legal',
  TABLOID: 'tabloid'
}

/** Print stylesheet: the values of Plane's `pdfStyles` (`styles.ts`) as CSS. */
const CSS = `
@page { margin: 40px; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, 'Noto Sans', 'Segoe UI', Roboto, Arial, sans-serif; font-size: 11pt; line-height: 1.6; color: ${TEXT_COLORS.primary}; }
.title { font-size: 24pt; font-weight: 600; margin: 0 0 20px; }
h1 { font-size: 20pt; font-weight: 600; margin: 16px 0 8px; }
h2 { font-size: 16pt; font-weight: 600; margin: 14px 0 6px; }
h3 { font-size: 14pt; font-weight: 600; margin: 12px 0 4px; }
h4 { font-size: 12pt; font-weight: 600; margin: 10px 0 4px; color: ${TEXT_COLORS.secondary}; }
h5 { font-size: 11pt; font-weight: 600; margin: 8px 0 4px; color: ${TEXT_COLORS.secondary}; }
h6 { font-size: 10pt; font-weight: 600; margin: 6px 0 4px; color: ${TEXT_COLORS.tertiary}; }
h1, h2, h3, h4, h5, h6 { break-after: avoid; }
p { margin: 0 0 8px; }
p:empty::after { content: '\\00a0'; }
blockquote { border-left: 3px solid ${BORDER_COLORS.strong}; padding-left: 12px; margin: 8px 0; font-weight: 400; break-inside: avoid; }
blockquote p { margin: 0; }
pre { background: ${BACKGROUND_COLORS.layer1}; padding: 12px; border-radius: 4px; font-family: 'Courier New', Courier, monospace; font-size: 10pt; margin: 8px 0; white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
code { background: ${BACKGROUND_COLORS.layer1}; color: ${CODE_COLORS.text}; padding: 2px 4px; border-radius: 2px; font-family: 'Courier New', Courier, monospace; font-size: 10pt; }
pre code { background: none; color: inherit; padding: 0; }
ul, ol { margin: 8px 0; padding-left: 22px; }
li { margin-bottom: 4px; break-inside: avoid; }
li > p { margin: 0; }
ul.task-list { list-style: none; padding-left: 0; }
.task-item { display: flex; gap: 6px; align-items: flex-start; }
.task-box { width: 12px; height: 12px; margin-top: 4px; border: 1px solid ${BORDER_COLORS.strong}; border-radius: 2px; display: inline-flex; align-items: center; justify-content: center; flex: none; }
.task-box.checked { background: ${BRAND_COLORS.default}; border-color: ${BRAND_COLORS.default}; }
.task-content { flex: 1; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; border: 1px solid ${BORDER_COLORS.subtle1}; }
tr { break-inside: avoid; border-bottom: 1px solid ${BORDER_COLORS.subtle1}; }
tr.header-row { background: ${BACKGROUND_COLORS.surface2}; }
th, td { padding: 8px; border-right: 1px solid ${BORDER_COLORS.subtle1}; vertical-align: top; text-align: left; }
th { font-weight: bold; }
td > p:last-child, th > p:last-child { margin-bottom: 0; }
hr { border: 0; border-bottom: 1px solid ${BORDER_COLORS.subtle1}; margin: 16px 0; }
.img-block { display: flex; width: 100%; margin: 8px 0; }
.img-block img { max-width: 100%; }
.img-placeholder { background: ${BACKGROUND_COLORS.layer1}; border: 1px dashed ${BORDER_COLORS.subtle}; border-radius: 4px; padding: 16px; margin: 8px 0; text-align: center; color: ${TEXT_COLORS.tertiary}; font-size: 10pt; }
.callout { display: flex; align-items: flex-start; padding: 12px; border-radius: 6px; margin: 8px 0; break-inside: avoid; }
.callout-icon { margin: 2px 10px 0 0; }
.callout-content { flex: 1; color: ${TEXT_COLORS.primary}; }
.mention { background: ${MENTION_COLORS.background}; color: ${MENTION_COLORS.text}; padding: 2px 4px; border-radius: 2px; }
a { color: ${LINK_COLORS.primary}; text-decoration: underline; }
`

/** No script, no network: everything the page needs is inlined, so the browser may not load anything else. */
const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"

/** PD-2212 `createPdfDocument` (PD-2213 `renderedContent`): a complete HTML document for the print engine. */
export function createPdfDocument(
  content: TipTapDocument | { html: string },
  options: PdfRenderOptions & { metadata?: PdfExportMetadata } = {}
): string {
  return buildHtml(content, options, { ...options.metadata, noAssets: options.noAssets })
}

export function buildHtml(
  content: TipTapDocument | { html: string },
  options: PdfRenderOptions,
  metadata: PdfExportMetadata
): string {
  const body =
    'html' in content
      ? renderStoredHtml(content.html, metadata)
      : (content.content ?? []).map(node => renderNode(node, metadata)).join('')
  const title = options.title ? `<h1 class="title">${escapeHtml(options.title)}</h1>` : ''
  return (
    `<!doctype html><html><head><meta charset="utf-8"/>` +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}"/>` +
    `<title>${escapeHtml(options.title ?? '')}</title><style>${CSS}</style></head><body>${title}${body}</body></html>`
  )
}

/** Render HTML with Browser Rendering and return the PDF bytes. */
export async function renderHtmlToPdf(
  browser: BrowserBinding | undefined,
  html: string,
  options: PdfRenderOptions = {}
): Promise<Uint8Array> {
  if (!browser?.quickAction) throw new PdfGenerationError('PDF rendering is not configured (BROWSER binding)', 503)
  const response = await browser.quickAction('pdf', {
    html,
    gotoOptions: { waitUntil: 'load' },
    pdfOptions: {
      format: FORMATS[options.pageSize ?? 'A4'],
      landscape: options.pageOrientation === 'landscape',
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: '40px', right: '40px', bottom: '40px', left: '40px' }
    }
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new PdfGenerationError(
      `Failed to render PDF (browser returned ${response.status})`,
      response.status === 429 ? 503 : 502
    )
  }
  return new Uint8Array(await response.arrayBuffer())
}

/** PD-2214 `renderPlaneDocToPdfBuffer`. */
export async function renderPlaneDocToPdfBuffer(
  browser: BrowserBinding | undefined,
  content: TipTapDocument | { html: string },
  options: PdfRenderOptions & { metadata?: PdfExportMetadata } = {}
): Promise<Uint8Array> {
  const metadata = { ...options.metadata, noAssets: options.noAssets }
  return renderHtmlToPdf(browser, buildHtml(content, options, metadata), options)
}

/** PD-2215 `renderPlaneDocToPdfBlob`. */
export async function renderPlaneDocToPdfBlob(
  browser: BrowserBinding | undefined,
  content: TipTapDocument | { html: string },
  options: PdfRenderOptions & { metadata?: PdfExportMetadata } = {}
): Promise<Blob> {
  const bytes = await renderPlaneDocToPdfBuffer(browser, content, options)
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
}
