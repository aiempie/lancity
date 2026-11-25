import { and, eq, gt, isNull, or } from 'drizzle-orm'
import type { Context, MiddlewareHandler } from 'hono'
import { createMiddleware } from 'hono/factory'
import { linkto } from '@/data/linkto'
import { apiTokens } from '@/db/schema/integration'
import { workspaces } from '@/db/schema/workspace'
import { userSecurity } from '@/db/schema/ext-p1-auth'
import { ServiceError } from '@/server/common/errors'
import { hashApiToken } from '@/server/integration/model-rules'
import type { ApiEnv } from '@/types/api/schema'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

/** Plane `APIKeyAuthentication.auth_header_name`. Header names are case-insensitive. */
export const API_KEY_HEADER = 'x-api-key'
/** `last_used` is refreshed at most once per window, so a busy integration does not write to D1 on every request. */
const LAST_USED_WINDOW_MS = 60_000

/** Plane `APIKeyAuthentication.get_api_token`. */
export function getApiTokenApiKeyAuthentication(headers: Headers): string | null {
  return headers.get(API_KEY_HEADER)?.trim() || null
}

/**
 * Plane `validate_api_token`: the token must exist, be active, not expired, belong to an active user and not be
 * deleted. Stamps `last_used`. Throws 401 "Given API token is not valid" otherwise.
 */
export async function validateApiTokenApiKeyAuthentication(
  db: LancityDb,
  token: string,
  now = new Date()
): Promise<Actor> {
  return (await validateScopedApiToken(db, token, now)).actor
}

export type ScopedApiToken = { actor: Actor; workspaceId: number }

/** Same checks as `validateApiTokenApiKeyAuthentication`, and also returns the workspace the token is bound to. */
export async function validateScopedApiToken(db: LancityDb, token: string, now = new Date()): Promise<ScopedApiToken> {
  const [row] = await db
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      workspaceId: apiTokens.workspaceId,
      lastUsed: apiTokens.lastUsed,
      userActive: userSecurity.isActive
    })
    .from(apiTokens)
    .leftJoin(userSecurity, eq(userSecurity.userId, apiTokens.userId))
    .where(
      and(
        eq(apiTokens.token, await hashApiToken(token)),
        eq(apiTokens.isActive, true),
        isNull(apiTokens.deletedAt),
        or(isNull(apiTokens.expiredAt), gt(apiTokens.expiredAt, now))
      )
    )
    .limit(1)
  // A user without a `user_security` row has never been deactivated.
  if (!row || row.workspaceId === null || row.userActive === false) throw new ServiceError(401, 'INVALID_API_TOKEN', 'Given API token is not valid')
  if (!row.lastUsed || now.getTime() - row.lastUsed.getTime() >= LAST_USED_WINDOW_MS) {
    await db.update(apiTokens).set({ lastUsed: now }).where(eq(apiTokens.id, row.id))
  }
  return { actor: { userId: row.userId }, workspaceId: row.workspaceId }
}

/** Plane `APIKeyAuthentication.authenticate`: no header means "not authenticated" (null), a bad token is a 401. */
export async function authenticateApiKeyAuthentication(db: LancityDb, headers: Headers): Promise<Actor | null> {
  const token = getApiTokenApiKeyAuthentication(headers)
  return token ? validateApiTokenApiKeyAuthentication(db, token) : null
}

/**
 * Hono authenticator for the external API. Use it as the `authenticator` of `externalApiView(...)`. It sets the
 * actor and `apiKeyAuthenticated` (the token logger records only such requests). Without an `X-API-Key` header the
 * request is refused with 401, like DRF's `IsAuthenticated`.
 */
export const apiKeyAuthentication = createMiddleware<ApiEnv>(async (c, next) => {
  const { getDb } = await import('@/db/client')
  const token = getApiTokenApiKeyAuthentication(c.req.raw.headers)
  if (!token) throw new ServiceError(401, 'UNAUTHORIZED', 'Authentication credentials were not provided.')
  await applyApiKey(getDb(), token, c.req.method, c.req.path, c)
  await next()
})

// ---------------------------------------------------------------- API key scope

/**
 * Routes an API key can never reach. Plane serves its API-key API from a separate router, so account, instance
 * admin, token management, auth and live-editor routes only accept a session there. Paths are relative to /api/v1.
 */
export function isApiKeyForbiddenPath(method: string, relativePath: string): boolean {
  const path = relativePath.replace(/\/+$/, '') || '/'
  const under = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`)
  if (under(linkto.apiInstances) || under(linkto.apiAuthExtra) || under(linkto.apiLive)) return true
  if (under(`${linkto.users}/api-tokens`)) return true
  if (under(`${linkto.users}/me/accounts`) || under(`${linkto.users}/me/email`)) return true
  return method.toUpperCase() === 'DELETE' && path === `${linkto.users}/me`
}

/**
 * Workspace bound tokens (`api_tokens.workspace_id`) may only call `/workspaces/:slug/...` of their own workspace.
 * Plane stores the binding but does not enforce it; Lancity does, so a leaked integration key cannot read other workspaces.
 */
export async function assertTokenWorkspaceScope(
  db: LancityDb,
  workspaceId: number | null,
  relativePath: string
): Promise<void> {
  if (workspaceId === null) throw new ServiceError(401, 'INVALID_API_TOKEN', 'Given API token is not valid')
  const match = new RegExp(`^${linkto.workspaces}/([^/]+)(?:/|$)`).exec(relativePath)
  const slug = match ? decodeURIComponent(match[1]) : null
  if (slug) {
    const [row] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug)).limit(1)
    if (row?.id === workspaceId) return
  }
  throw new ServiceError(403, 'API_TOKEN_WORKSPACE_SCOPE', 'This API token cannot access this resource')
}

function relativeApiPath(path: string): string {
  return path.startsWith(linkto.apiV1) ? path.slice(linkto.apiV1.length) || '/' : path
}

async function applyApiKey(
  db: LancityDb,
  token: string,
  method: string,
  path: string,
  c: Context<ApiEnv>
): Promise<void> {
  const relative = relativeApiPath(path)
  const scoped = await validateScopedApiToken(db, token)
  if (isApiKeyForbiddenPath(method, relative)) {
    throw new ServiceError(403, 'API_KEY_NOT_ALLOWED', 'This route does not accept API keys')
  }
  await assertTokenWorkspaceScope(db, scoped.workspaceId, relative)
  c.set('actor', scoped.actor)
  c.set('apiKeyAuthenticated', true)
}

export type AuthenticateOptions = {
  getDatabase: () => LancityDb | Promise<LancityDb>
  /** Resolves the Better Auth session actor (throws 401). */
  sessionActor: (headers: Headers) => Promise<Actor>
}

/**
 * Authenticator for /api/v1: a valid `X-API-Key` header or else the session cookie. A request that sends the header
 * is judged by the key only, so a bad key is a 401 even when a valid cookie is present.
 */
export function createAuthenticate(options: AuthenticateOptions): MiddlewareHandler<ApiEnv> {
  return createMiddleware<ApiEnv>(async (c, next) => {
    if (!c.get('actor')) {
      const token = getApiTokenApiKeyAuthentication(c.req.raw.headers)
      if (token) await applyApiKey(await options.getDatabase(), token, c.req.method, c.req.path, c)
      else c.set('actor', await options.sessionActor(c.req.raw.headers))
    }
    await next()
  })
}

/** An API key when the header is present, otherwise the Better Auth session. For routes open to both clients. */
export const apiKeyOrSessionAuthentication = createMiddleware<ApiEnv>(async (c, next) => {
  if (c.req.raw.headers.has(API_KEY_HEADER)) return apiKeyAuthentication(c, next)
  const { authenticate } = await import('@/server/api/v1/middleware')
  return authenticate(c, next)
})
