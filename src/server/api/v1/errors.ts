import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'
import { isIntegrityError, ServiceError } from '@/server/common/errors'
import { logException } from '@/server/common/exception-logger'

/** Every API error has this shape: `{ error: { code, message, details? } }`. */
export type ErrorBody = { error: { code: string; message: string; details?: unknown } }

export function errorBody(code: string, message: string, details?: unknown): ErrorBody {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } }
}

/**
 * Hono `onError` handler (Plane `handle_exception` of every BaseAPIView/BaseViewSet).
 *
 * - `ServiceError`: its own status, code and message.
 * - `HTTPException`: status of the exception.
 * - `ZodError` (Django `ValidationError`): 400 `VALIDATION_ERROR` with the issues.
 * - constraint failures (Django `IntegrityError`): 400 `INTEGRITY_ERROR`, "The payload is not valid".
 * - anything else: logged with its stack, answered with a generic 500 that never leaks internals.
 */
export function handleApiError(error: Error, c: Context): Response {
  if (error instanceof ServiceError) {
    return c.json(errorBody(error.code, error.message, error.details), error.status as never)
  }
  if (error instanceof HTTPException) {
    return c.json(errorBody('HTTP_ERROR', error.message), error.status)
  }
  if (error instanceof ZodError) {
    return c.json(errorBody('VALIDATION_ERROR', 'Please provide valid detail', error.issues), 400)
  }
  if (isIntegrityError(error)) {
    logException(error, { warning: true, context: { path: c.req.path, method: c.req.method } })
    return c.json(errorBody('INTEGRITY_ERROR', 'The payload is not valid'), 400)
  }
  logException(error, { context: { path: c.req.path, method: c.req.method } })
  return c.json(errorBody('INTERNAL_ERROR', 'Internal server error'), 500)
}

/** Plane `custom_404_view` for the API: JSON 404 for unknown routes. Register with `app.notFound`. */
export function handleNotFound(c: Context): Response {
  return c.json(errorBody('NOT_FOUND', 'Route not found'), 404)
}
