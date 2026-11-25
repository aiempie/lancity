import { and, eq, inArray, isNull } from 'drizzle-orm'
import { fileAssets, type pages } from '@/db/schema/content'
import { user } from '@/db/schema/auth'
import { workspaceMembers } from '@/db/schema/workspace'
import { validImage } from '@/server/asset/service'
import { logJson, type InfraEnv } from '@/server/common/env'
import { ServiceError } from '@/server/common/errors'
import { checkRateLimit, parseRate } from '@/server/common/rate-limit'
import { pinnedFetchFollowingRedirects, readCappedBody } from '@/server/common/url-security'
import { isEntityId } from '@/server/common/uuid'
import { recoverWithDefault, withTimeoutAndRetry } from '@/server/pdf/effect-utils'
import { PdfContentFetchError, PdfImageProcessingError } from '@/server/pdf/errors'
import {
  collectHtmlImageRefs,
  collectHtmlUserMentionIds,
  collectJsonImageRefs,
  collectJsonUserMentionIds
} from '@/server/pdf/html-content'
import { buildHtml, renderPlaneDocToPdfBuffer, type BrowserBinding } from '@/server/pdf/plane-pdf-exporter'
import { requirePageAccess } from '@/server/page/service'
import type { Actor } from '@/types/auth/schema'
import type {
  PdfExportBody,
  PdfExportMetadata,
  PdfRenderOptions,
  PdfUserMention,
  TipTapDocument,
  TipTapNode
} from '@/types/content/p4-pdf-schema'
import type { LancityDb } from '@/types/database/schema'

const IMAGE_CONCURRENCY = 4
const IMAGE_TIMEOUT_MS = 8000
const PDF_RENDER_TIMEOUT_MS = 25_000
/** R2 uploads are capped at 5 MiB by the asset service; the same cap applies to remote images. */
const IMAGE_MAX_BYTES = 5 * 1024 * 1024
/** Everything is inlined into one HTML document sent to the browser (50 MB request limit). */
const TOTAL_IMAGE_MAX_BYTES = 24 * 1024 * 1024
const MAX_IMAGES = 100
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
const EXPORT_RATE = parseRate('20/hour')

type PageRecord = typeof pages.$inferSelect

/** PD-2298 `getDocumentType`: only project pages are exported. */
export const getDocumentType = (): 'project_page' => 'project_page'

export type PageContent = {
  json: TipTapDocument | null
  html: string
  title: string | null
}

export type PdfExportResult = { pdfBuffer: Uint8Array; outputFileName: string; pageId: number }

/**
 * PD-2301 `fetchPageContent` (PD-2302 to PD-2304). Plane decodes the Yjs binary with `@plane/editor`. Lancity keeps
 * the editor JSON in `description_json` and sanitized HTML in `description_html`, so the JSON is used when it is a
 * non-empty document and the HTML otherwise. Binary-only pages need the Live converter to fill `description_json`.
 */
export function fetchPageContent(page: Pick<PageRecord, 'name' | 'descriptionJson' | 'descriptionHtml'>): PageContent {
  const json = page.descriptionJson as { type?: unknown; content?: unknown } | null
  const hasJson =
    !!json && typeof json === 'object' && json.type === 'doc' && Array.isArray(json.content) && json.content.length > 0
  const html = page.descriptionHtml ?? ''
  if (!hasJson && !html.trim()) throw new PdfContentFetchError('Page content not found', 404)
  return { json: hasJson ? (json as TipTapDocument) : null, html, title: page.name || null }
}

/** PD-2305 `fetchUserMentions` (PD-2306 to PD-2309): display names of mentioned users who belong to the workspace. */
export async function fetchUserMentions(db: LancityDb, workspaceId: number, ids: string[]): Promise<PdfUserMention[]> {
  const numeric = [...new Set(ids.filter(isEntityId).map(Number))].slice(0, 80)
  if (!numeric.length) return []
  return recoverWithDefault(async () => {
    const rows = await db
      .select({ id: user.id, name: user.name, username: user.displayUsername, image: user.image })
      .from(user)
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.memberId, user.id),
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.isActive, true),
          isNull(workspaceMembers.deletedAt)
        )
      )
      .where(inArray(user.id, numeric))
    return rows.map(row => ({
      id: String(row.id),
      display_name: row.name || row.username || String(row.id),
      avatar_url: row.image ?? undefined
    }))
  }, [] as PdfUserMention[])
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Return a data URI only for bytes whose magic number matches an allowed raster type (SVG is never inlined). */
function toDataUri(bytes: Uint8Array): string | null {
  const type = IMAGE_TYPES.find(candidate => validImage(bytes, candidate))
  return type ? `data:${type};base64,${toBase64(bytes)}` : null
}

/**
 * PD-2281 `resolveImageAssetUrl` (PD-2282): an asset id resolves to the R2 bytes of an uploaded asset of the same
 * workspace. Plane returns a presigned URL; R2 has none, so the bytes are read directly.
 */
export async function resolveImageAsset(
  db: LancityDb,
  bucket: R2Bucket,
  workspaceId: number,
  assetId: string
): Promise<Uint8Array | null> {
  if (!isEntityId(assetId)) return null
  const [asset] = await db
    .select({ key: fileAssets.asset, size: fileAssets.size })
    .from(fileAssets)
    .where(
      and(
        eq(fileAssets.id, Number(assetId)),
        eq(fileAssets.workspaceId, workspaceId),
        eq(fileAssets.isUploaded, true),
        eq(fileAssets.isDeleted, false),
        isNull(fileAssets.deletedAt)
      )
    )
    .limit(1)
  if (!asset || asset.size > IMAGE_MAX_BYTES) return null
  const object = await bucket.get(asset.key)
  return object ? new Uint8Array(await object.arrayBuffer()) : null
}

/** Remote `http(s)` images go through the SSRF-safe fetch of p1-platform, with a size cap. */
async function fetchRemoteImage(url: string): Promise<Uint8Array | null> {
  const { response } = await pinnedFetchFollowingRedirects('GET', url, { timeout: 8, maxRedirects: 3 })
  if (!response.ok) {
    await response.body?.cancel()
    return null
  }
  const { content, truncated } = await readCappedBody(response, IMAGE_MAX_BYTES, 8)
  return truncated ? null : content
}

/**
 * PD-2310 `processImages` (PD-2311 to PD-2324): resolve every image reference to a `data:` URI with bounded
 * concurrency. A failing image is logged and skipped, so the PDF still renders with a placeholder.
 * Plane re-encodes with `sharp` (rotate, flatten, 1200 px JPEG). Workers has no `sharp`; raster bytes are inlined
 * as they are and the print engine scales them with CSS.
 */
export async function processImages(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  workspaceId: number,
  refs: string[]
): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  let total = 0
  const queue = refs.slice(0, MAX_IMAGES)

  // PD-2314 `processSingleImage`
  const processSingleImage = async (ref: string) => {
    try {
      const bytes = await withTimeoutAndRetry(
        `process image ${ref}`,
        async () => {
          if (/^https?:\/\//i.test(ref)) return fetchRemoteImage(ref)
          return bucket ? resolveImageAsset(db, bucket, workspaceId, ref) : null
        },
        { timeoutMs: IMAGE_TIMEOUT_MS, maxRetries: 1 }
      )
      if (!bytes) throw new PdfImageProcessingError('Image not found or too large', ref)
      if (total + bytes.length > TOTAL_IMAGE_MAX_BYTES) throw new PdfImageProcessingError('Image budget exceeded', ref)
      const uri = toDataUri(bytes)
      if (!uri) throw new PdfImageProcessingError('Unsupported image type', ref)
      total += bytes.length
      result[ref] = uri
    } catch (error) {
      logJson('warn', 'PDF_EXPORT: Image processing failed', { assetId: ref.slice(0, 100), error: String(error) })
    }
  }

  // Fixed-size worker pool (Effect `forEach` with `concurrency`).
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(IMAGE_CONCURRENCY, queue.length) }, async () => {
      while (next < queue.length) await processSingleImage(queue[next++])
    })
  )
  return result
}

/** PD-2325 `renderPdf` (PD-2326 to PD-2328). */
export async function renderPdf(
  browser: BrowserBinding | undefined,
  content: PageContent,
  metadata: PdfExportMetadata,
  options: PdfRenderOptions
): Promise<Uint8Array> {
  const source = content.json ?? { html: content.html }
  const pdf = await withTimeoutAndRetry(
    'render PDF',
    () => renderPlaneDocToPdfBuffer(browser, source, { ...options, metadata }),
    { timeoutMs: PDF_RENDER_TIMEOUT_MS, maxRetries: 0 }
  )
  logJson('info', 'PDF_EXPORT: PDF rendered successfully', { size: pdf.length })
  return pdf
}

/** Everything the pipeline needs after the access check. */
export type PdfExportInput = Omit<PdfExportBody, 'async'> & { pageId: number }

/** Build the HTML that would be printed. Same pipeline as `exportToPdf` without the browser step. */
export async function buildPrintHtml(
  db: LancityDb,
  env: Pick<InfraEnv, 'ASSET_BUCKET'>,
  page: PageRecord,
  input: PdfExportInput
): Promise<string> {
  const { content, metadata, options } = await preparePage(db, env, page, input)
  return buildHtml(content.json ?? { html: content.html }, options, metadata)
}

async function preparePage(
  db: LancityDb,
  env: Pick<InfraEnv, 'ASSET_BUCKET'>,
  page: PageRecord,
  input: PdfExportInput
) {
  const content = fetchPageContent(page)
  const imageRefs = content.json ? collectJsonImageRefs(content.json as TipTapNode) : collectHtmlImageRefs(content.html)
  const mentionIds = content.json
    ? collectJsonUserMentionIds(content.json as TipTapNode)
    : collectHtmlUserMentionIds(content.html)
  const metadata: PdfExportMetadata = { userMentions: await fetchUserMentions(db, page.workspaceId, mentionIds) }
  if (!input.noAssets && imageRefs.length)
    metadata.resolvedImageUrls = await processImages(db, env.ASSET_BUCKET, page.workspaceId, imageRefs)
  logJson('info', 'PDF_EXPORT: Metadata prepared', {
    userMentions: metadata.userMentions?.length ?? 0,
    resolvedImages: Object.keys(metadata.resolvedImageUrls ?? {}).length
  })
  const options: PdfRenderOptions = {
    title: input.title || content.title || undefined,
    author: input.author,
    subject: input.subject,
    pageSize: input.pageSize,
    pageOrientation: input.pageOrientation,
    noAssets: input.noAssets
  }
  return { content, metadata, options }
}

/** PD-2329 `exportToPdf` (PD-2330): load content, resolve mentions and images, render. The caller checked access. */
export async function exportToPdf(
  db: LancityDb,
  env: Partial<Pick<InfraEnv, 'ASSET_BUCKET' | 'BROWSER'>>,
  page: PageRecord,
  input: PdfExportInput
): Promise<PdfExportResult> {
  const { content, metadata, options } = await preparePage(db, env, page, input)
  const pdfBuffer = await renderPdf(env.BROWSER as BrowserBinding | undefined, content, metadata, options)
  return { pdfBuffer, outputFileName: input.fileName || `page-${page.id}.pdf`, pageId: page.id }
}

/** Authorize (PD-0731 style read access of the page) then export. Used by the synchronous route. */
export async function exportPagePdf(
  db: LancityDb,
  env: Partial<Pick<InfraEnv, 'ASSET_BUCKET' | 'BROWSER'>>,
  actor: Actor,
  slug: string,
  projectId: number,
  pageId: number,
  input: Omit<PdfExportBody, 'async'>
): Promise<PdfExportResult> {
  const { page } = await requirePageAccess(db, actor, slug, projectId, pageId, 'read')
  await enforceExportRate(db, actor)
  return exportToPdf(db, env, page, { ...input, pageId })
}

export async function loadPageForPrint(db: LancityDb, actor: Actor, slug: string, projectId: number, pageId: number) {
  return (await requirePageAccess(db, actor, slug, projectId, pageId, 'read')).page
}

export async function enforceExportRate(db: LancityDb, actor: Actor): Promise<void> {
  const limit = await checkRateLimit(db, `pdf-export:${actor.userId}`, EXPORT_RATE)
  if (!limit.allowed)
    throw new ServiceError(429, 'RATE_LIMITED', 'Too many PDF exports, try again later', {
      retry_after: limit.retryAfter
    })
}
