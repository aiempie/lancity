import { ServiceError } from '@/server/common/errors'

/**
 * Plane `schema/pdf-export.ts` tagged errors as `ServiceError` subclasses. The status mapping of
 * `PdfExportController.mapErrorToHttpResponse` is kept by `mapPdfErrorToHttp`.
 */
export class PdfValidationError extends ServiceError {
  constructor(message: string, details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details)
  }
}
export class PdfContentFetchError extends ServiceError {
  constructor(message: string, status = 502) {
    super(status, status === 404 ? 'PAGE_NOT_FOUND' : 'PDF_CONTENT_FETCH_FAILED', message)
  }
}
export class PdfTimeoutError extends ServiceError {
  constructor(
    message: string,
    readonly operation: string
  ) {
    super(504, 'PDF_TIMEOUT', message)
  }
}
export class PdfGenerationError extends ServiceError {
  constructor(message: string, status = 500) {
    super(status, status === 503 ? 'PDF_UNAVAILABLE' : 'PDF_GENERATION_FAILED', message)
  }
}
export class PdfImageProcessingError extends ServiceError {
  constructor(
    message: string,
    readonly assetId: string
  ) {
    super(502, 'PDF_IMAGE_FAILED', message)
  }
}

/** PD-2054 `mapErrorToHttpResponse`: HTTP status and message of any error; unknown errors become a generic 500. */
export function mapPdfErrorToHttp(error: unknown): { status: number; error: string } {
  if (error instanceof ServiceError) return { status: error.status, error: error.message }
  return { status: 500, error: 'Failed to generate PDF' }
}
