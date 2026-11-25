import { CloseCode, ForceCloseReason } from '@/server/collaboration/admin-commands'
import { broadcastError } from '@/server/collaboration/broadcast-error'
import { getAllDocumentFormatsFromBinary, getBinaryDataFromHtml } from '@/server/collaboration/codec'
import type { PageDocumentService } from '@/server/collaboration/document'
import { AppError } from '@/server/collaboration/errors'
import type { ForceCloseTarget } from '@/server/collaboration/force-close-handler'
import { liveLog } from '@/server/collaboration/logger'
import type { LiveConnectionContext } from '@/types/content/p4-live-schema'

/** The page validator rejects states above this size (`validateBinaryData`). Plane answers 413 for it. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

type Writer = Pick<LiveConnectionContext, 'userId' | 'workspaceSlug'>

/**
 * PD-2061: load the Yjs state of a page. A page without a stored binary state is built from its HTML and the name,
 * and the converted state is saved so the next load is direct.
 */
export async function fetchDocument(
  service: PageDocumentService,
  instance: ForceCloseTarget,
  pageId: number,
  writer: Writer
): Promise<Uint8Array> {
  try {
    const stored = await service.fetchDescriptionBinary(pageId)
    if (stored.byteLength > 0) return stored
    const details = await service.fetchDetails(pageId)
    const converted = getBinaryDataFromHtml(details.description_html ?? '<p></p>', details.name)
    try {
      const { contentBinaryEncoded, contentHTML, contentJSON } = getAllDocumentFormatsFromBinary(converted, true)
      await service.updateDescriptionBinary(pageId, {
        description_binary: contentBinaryEncoded,
        description_html: contentHTML,
        description_json: contentJSON
      })
    } catch (error) {
      liveLog('save_after_html_conversion_failed', { pageId, message: AppError.from(error).message }, 'error')
    }
    return converted
  } catch (error) {
    const appError = AppError.from(error, { context: { pageId } })
    liveLog('fetch_document_failed', { pageId, message: appError.message }, 'error')
    await broadcastError(instance, String(pageId), 'Unable to load the page. Please try refreshing.', 'fetch', writer)
    throw appError
  }
}

/**
 * PD-2062: save the Yjs state with its HTML and JSON. When the content is too large the clients are told, closed and
 * the failure is propagated so the stored state remains available for retry.
 */
export async function storeDocument(
  service: PageDocumentService,
  instance: ForceCloseTarget,
  pageId: number,
  state: Uint8Array,
  writer: Writer
): Promise<void> {
  try {
    if (state.byteLength > MAX_DOCUMENT_BYTES) throw new AppError('Document is too large to save', { statusCode: 413 })
    const { contentBinaryEncoded, contentHTML, contentJSON } = getAllDocumentFormatsFromBinary(state, true)
    await service.updateDescriptionBinary(pageId, {
      description_binary: contentBinaryEncoded,
      description_html: contentHTML,
      description_json: contentJSON
    })
  } catch (error) {
    const appError = AppError.from(error, { context: { pageId } })
    liveLog('store_document_failed', { pageId, message: appError.message, status: appError.statusCode }, 'error')
    const tooLarge = appError.statusCode === 413
    await broadcastError(
      instance,
      String(pageId),
      tooLarge ? 'Document is too large to save. Please reduce the content size.' : 'Unable to save the page. Please try again.',
      'store',
      writer,
      tooLarge ? 'content_too_large' : undefined,
      tooLarge
    )
    if (tooLarge) {
      instance.document?.closeConnections(CloseCode.DOCUMENT_TOO_LARGE, ForceCloseReason.DOCUMENT_TOO_LARGE)
    }
    throw appError
  }
}
