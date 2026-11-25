import { eq } from 'drizzle-orm'
import type { Context, MiddlewareHandler } from 'hono'
import { createMiddleware } from 'hono/factory'
import { linkto } from '@/data/linkto'
import { getDb } from '@/db/client'
import { apiActivityLogs } from '@/db/schema/integration'
import { profiles } from '@/db/schema/identity'
import { redactedHeaders, safeDecodeBody } from '@/server/api/v1/request-security'
import { requireContainerBody } from '@/server/api/v1/validation'
import { createAuthenticate } from '@/server/api-token/authentication'
import { requireActor } from '@/lib/auth/server-session'
import { getEnv, logJson, runInBackground } from '@/server/common/env'
import { logException } from '@/server/common/exception-logger'
import { getClientIp } from '@/server/common/ip-address'
import { apiKeyRateLimit } from '@/server/common/rate-limit'
import { assertTimeZone } from '@/server/common/timezone-converter'
import type { ApiEnv } from '@/types/api/schema'

export const authenticate = createAuthenticate({
  getDatabase: () => getDb(),
  sessionActor: headers => requireActor(headers)
})

export { privateNoStore, protectCookieWrites, redactedHeaders, safeDecodeBody } from './request-security'
export { requestBodySizeLimit, requireContainerBody } from './validation'

// ------------------------------------------------------------------ request identity helpers

/** Plane `BaseAPIView.workspace_slug`. */
export function getWorkspaceSlug(c: Context): string | undefined {
  return c.req.param('slug')
}

/**
 * Plane `BaseAPIView.project_id`: the `:projectId` route parameter as a number. Project detail routes pass
 * their own id parameter as `fallbackParam`, like Plane's `resolve(...).url_name == "project"` branch.
 */
export function getProjectId(c: Context, fallbackParam?: string): number | undefined {
  const raw = c.req.param('projectId') ?? (fallbackParam ? c.req.param(fallbackParam) : undefined)
  return raw !== undefined && /^[1-9]\d{0,15}$/.test(raw) ? Number(raw) : undefined
}

/**
 * Plane `TimezoneMixin.initial`: the caller's IANA timezone from the profile (UTC when unset, unknown or
 * anonymous). The first call loads it once per request.
 */
export async function getRequestTimezone(c: Context<ApiEnv>): Promise<string> {
  const cached = c.get('timezone')
  if (cached) return cached
  let timezone = 'UTC'
  const actor = c.get('actor')
  if (actor) {
    const [row] = await getDb()
      .select({ timezone: profiles.userTimezone })
      .from(profiles)
      .where(eq(profiles.userId, actor.userId))
      .limit(1)
    if (row?.timezone) {
      try {
        assertTimeZone(row.timezone)
        timezone = row.timezone
      } catch {
        // An unknown stored zone falls back to UTC instead of failing every request.
      }
    }
  }
  c.set('timezone', timezone)
  return timezone
}

// ------------------------------------------------------------------ request logging

/** Plane `RequestLoggerMiddleware._should_log_route`: health probes are not logged. */
export function shouldLogRoute(method: string, path: string): boolean {
  const root = linkto.apiV1
  return !(
    method.toUpperCase() === 'GET' &&
    (path === '/' || path === root || path === `${root}/` || path === `${root}/health`)
  )
}

/** Plane `RequestLoggerMiddleware`: one JSON log line per request with status, duration, IP, agent and user. */
export const requestLogger = createMiddleware<ApiEnv>(async (c, next) => {
  const start = Date.now()
  await next()
  if (!shouldLogRoute(c.req.method, c.req.path)) return
  const url = new URL(c.req.url)
  logJson('info', 'api.request', {
    message: `${c.req.method} ${url.pathname}${url.search} ${c.res.status}`,
    path: url.pathname,
    method: c.req.method,
    status_code: c.res.status,
    duration_ms: Date.now() - start,
    remote_addr: getClientIp(c.req.raw),
    user_agent: c.req.header('user-agent') ?? '',
    user_id: c.get('actor')?.userId ?? null
  })
})

/** Keyed HMAC-SHA256 of the API key: a stable, non-reversible identifier to correlate log rows with a token. */
async function tokenIdentifier(apiKey: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(apiKey)))
  return Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Plane `APITokenLogMiddleware`: store a row in `api_activity_logs` for every request authenticated with an API
 * key (the authenticator sets `apiKeyAuthenticated`). Writes run in `waitUntil` and failures are only logged.
 */
export const apiTokenLog = createMiddleware<ApiEnv>(async (c, next) => {
  const apiKey = c.req.header('x-api-key')
  const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method.toUpperCase())
  const requestBody = apiKey && hasBody ? new Uint8Array(await c.req.arrayBuffer()) : null
  await next()
  if (!apiKey || !c.get('apiKeyAuthenticated')) return
  const response = c.res.clone()
  const request = c.req.raw
  const url = new URL(c.req.url)
  const actorId = c.get('actor')?.userId
  runInBackground(
    (async () => {
      try {
        const secret = getEnv().BETTER_AUTH_SECRET as string | undefined
        if (!secret) return
        await getDb()
          .insert(apiActivityLogs)
          .values({
            tokenIdentifier: await tokenIdentifier(apiKey, secret),
            path: url.pathname,
            method: request.method,
            queryParams: url.search.replace(/^\?/, ''),
            headers: redactedHeaders(request.headers),
            body: safeDecodeBody(requestBody),
            responseCode: response.status,
            responseBody: safeDecodeBody(new Uint8Array(await response.arrayBuffer())),
            ipAddress: getClientIp(request),
            userAgent: request.headers.get('user-agent'),
            createdById: actorId,
            updatedById: actorId
          })
      } catch (error) {
        logException(error, { context: { label: 'api-token-log' } })
      }
    })(),
    'api-token-log'
  )
})

// ------------------------------------------------------------------ composed "base views"

/**
 * Plane `app` `BaseViewSet`/`BaseAPIView` for web and mobile session routes: authenticated actor and a JSON
 * container body. Use as `routes.use('*', ...baseApiView())`. Per-route role checks use `allowPermission`.
 */
export function baseApiView(): MiddlewareHandler<ApiEnv>[] {
  return [authenticate, requireContainerBody]
}

/**
 * Plane `api` (external) `BaseAPIView`: API key throttle first (`ApiKeyRateThrottle`, `get_throttles`), then
 * the supplied authenticator (the API key authentication of the integration group), the body check and the
 * activity log.
 */
export function externalApiView(authenticator: MiddlewareHandler<ApiEnv>, rate?: string): MiddlewareHandler<ApiEnv>[] {
  return [apiKeyRateLimit(rate), authenticator, requireContainerBody, apiTokenLog]
}
