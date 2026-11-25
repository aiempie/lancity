import { cors } from 'hono/cors'
import { createMiddleware } from 'hono/factory'
import { ServiceError } from '@/server/common/errors'
import { urlparse } from '@/server/common/url'

/** Prevent cross-origin browser requests from carrying cookie credentials on writes. */
export const protectCookieWrites = createProtectCookieWrites()

/** `trustedOrigins` returns the browser origins (CORS_ALLOWED_ORIGINS) that may send cookie writes besides the app's own. */
export function createProtectCookieWrites(trustedOrigins: () => string[] = () => []) {
  return createMiddleware(async (c, next) => {
    const method = c.req.method.toUpperCase()
    const origin = c.req.header('origin')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && c.req.header('cookie') && origin) {
      let sameOrigin = false
      try {
        sameOrigin = origin === new URL(c.req.url).origin || trustedOrigins().includes(origin)
      } catch {
        // An invalid URL or origin cannot be trusted.
      }
      if (!sameOrigin) throw new ServiceError(403, 'INVALID_ORIGIN', 'Cross-origin request denied')
    }
    await next()
  })
}

/** API responses can contain private user data. */
export const privateNoStore = createMiddleware(async (c, next) => {
  await next()
  c.header('Cache-Control', 'private, no-store')
})

export type CorsSettings = { allowedOrigins: string[]; allowAllOrigins: boolean; allowCredentials: boolean }

/**
 * Plane `_cors_settings`. Configured origins are used as given. Without any, the origins of the base URLs that
 * are set and valid are allowed. With neither, every origin is allowed but credentials are not.
 */
export function corsSettings(corsAllowedOrigins: string[], baseUrls: (string | null | undefined)[]): CorsSettings {
  const origins = [...corsAllowedOrigins]
  if (!origins.length) {
    for (const baseUrl of baseUrls) {
      const { scheme, netloc } = urlparse((baseUrl ?? '').trim())
      const origin = `${scheme}://${netloc}`.toLowerCase()
      if (scheme && netloc && !origins.includes(origin)) origins.push(origin)
    }
  }
  return { allowedOrigins: origins, allowAllOrigins: origins.length === 0, allowCredentials: origins.length > 0 }
}

/**
 * Plane `_cookies_secure`: cookies are Secure when the app is served over https, or when every configured
 * CORS origin is https. Plain http installs keep non-Secure cookies.
 */
export function cookiesSecure(
  webUrl?: string | null,
  corsAllowedOrigins: string[] = [],
  appBaseUrl?: string | null
): boolean {
  if ((webUrl || appBaseUrl || '').trim().toLowerCase().startsWith('https://')) return true
  return corsAllowedOrigins.length > 0 && !corsAllowedOrigins.some(origin => origin.includes('http:'))
}

export type CorsEnv = {
  CORS_ALLOWED_ORIGINS?: string
  WEB_URL?: string
  APP_BASE_URL?: string
  ADMIN_BASE_URL?: string
  SPACE_BASE_URL?: string
  LIVE_BASE_URL?: string
  BETTER_AUTH_URL?: string
}

/**
 * CORS middleware from the environment (Plane `CORS_ALLOWED_ORIGINS` handling). The app itself is same origin,
 * so mount this only when browsers on other origins call the API. `X-API-Key` is always an allowed header.
 */
export function createCorsMiddleware(env: CorsEnv) {
  const configured = (env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
  const settings = corsSettings(configured, [
    env.WEB_URL,
    env.APP_BASE_URL,
    env.ADMIN_BASE_URL,
    env.SPACE_BASE_URL,
    env.LIVE_BASE_URL,
    env.BETTER_AUTH_URL
  ])
  return cors({
    origin: settings.allowAllOrigins ? '*' : settings.allowedOrigins,
    credentials: settings.allowCredentials,
    allowHeaders: [
      'Accept',
      'Authorization',
      'Content-Type',
      'User-Agent',
      'X-CSRFToken',
      'X-Requested-With',
      'X-API-Key',
      'Origin',
      'DNT'
    ]
  })
}

/**
 * CORS for /api/v1 that reads the environment on each request (Workers bindings are not available at import time).
 * Credentials are only sent with explicit origins; without any configured origin it falls back to `*` and no credentials.
 */
export function createApiCors(getEnvironment: () => CorsEnv) {
  return createMiddleware(async (c, next) => createCorsMiddleware(getEnvironment())(c, next))
}

/** Origins allowed to send cookie-authenticated writes. Empty when CORS falls back to `*`. */
export function corsTrustedOrigins(env: CorsEnv): string[] {
  const configured = (env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
  return configured
}

const MAX_LOGGED_BODY_LENGTH = 10 * 1024
const TRUNCATION_MARKER = '... [truncated]'
const SENSITIVE_HEADERS = new Set(['x-api-key', 'authorization', 'cookie'])

const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((byte, i) => bytes[i] === byte)

/** Plane `_safe_decode_body`: null for empty bodies, a marker for binary or undecodable ones, truncated text otherwise. */
export function safeDecodeBody(content: Uint8Array | null | undefined): string | null {
  if (!content || content.length === 0) return null
  const PNG = [0x89, 0x50, 0x4e, 0x47]
  const JPEG = [0xff, 0xd8, 0xff]
  const PDF = [0x25, 0x50, 0x44, 0x46]
  if (startsWith(content, PNG) || startsWith(content, JPEG) || startsWith(content, PDF)) return '[Binary Content]'
  let decoded: string
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(content)
  } catch {
    return '[Could not decode content]'
  }
  return decoded.length > MAX_LOGGED_BODY_LENGTH
    ? decoded.slice(0, MAX_LOGGED_BODY_LENGTH) + TRUNCATION_MARKER
    : decoded
}

/** Plane `_redacted_headers`: header map as text with credential values replaced, so keys are never stored. */
export function redactedHeaders(headers: Headers): string {
  const redacted: Record<string, string> = {}
  headers.forEach((value, key) => {
    redacted[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '[REDACTED]' : value
  })
  return JSON.stringify(redacted)
}
