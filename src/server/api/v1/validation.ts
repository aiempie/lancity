import type { Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { createMiddleware } from 'hono/factory'
import type { z } from 'zod'
import { ServiceError } from '@/server/common/errors'

/** Largest accepted JSON body (Plane `DATA_UPLOAD_MAX_MEMORY_SIZE`, default 5 MiB). */
export const MAX_JSON_BODY_BYTES = 5 * 1024 * 1024

function tooLarge(): never {
  throw new ServiceError(413, 'BODY_TOO_LARGE', 'JSON request body exceeds 5 MiB')
}

const limitJsonBody = bodyLimit({ maxSize: MAX_JSON_BODY_BYTES, onError: tooLarge })

/**
 * Plane `RequestBodySizeLimitMiddleware`: answer 413 `BODY_TOO_LARGE` before a handler reads an oversized
 * body. Mount on routes that accept JSON.
 */
export const requestBodySizeLimit = createMiddleware(async (c, next) => {
  const method = c.req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next()
  return limitJsonBody(c, next)
})

export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid request input', result.error.issues)
  }
  return result.data
}

export async function readJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let body: unknown
  await limitJsonBody(c, async () => {
    try {
      body = await c.req.json()
    } catch {
      throw new ServiceError(400, 'INVALID_JSON', 'Request body must be valid JSON')
    }
  })
  return parseInput(schema, body)
}

/**
 * Plane `BaseAPIView.initial` body check: POST, PUT and PATCH bodies that parse as JSON must be an object or
 * an array. Scalars and `null` get 400 `PARSE_ERROR`. Bodies that are empty or not JSON are left to the handler.
 */
export const requireContainerBody = createMiddleware(async (c, next) => {
  const method = c.req.method.toUpperCase()
  if (['POST', 'PUT', 'PATCH'].includes(method) && (c.req.header('content-type') ?? '').includes('json')) {
    let body: unknown
    let parsed = false
    await limitJsonBody(c, async () => {
      try {
        body = await c.req.json()
        parsed = true
      } catch {
        // Empty or malformed JSON is reported by `readJson`.
      }
    })
    if (parsed && (typeof body !== 'object' || body === null)) {
      throw new ServiceError(400, 'PARSE_ERROR', 'Request body must be a JSON object or array.')
    }
  }
  await next()
})
