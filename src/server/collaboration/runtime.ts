import { z } from 'zod'
import { CloseCode, ForceCloseReason } from '@/server/collaboration/admin-commands'
import type { LiveInstance } from '@/server/collaboration/broadcast-message'
import type { InfraEnv } from '@/server/common/env'

/**
 * Runtime of the Live server on Cloudflare (PD-2060, PD-2079 to PD-2086, PD-2128 to PD-2141, PD-2217 to PD-2257,
 * PD-2337 to PD-2341).
 *
 * Plane ran an Express server with Hocuspocus and Redis. Here:
 * - the Express server, CORS, 404 and start/stop code are the Worker route `routes/live.ts`;
 * - a Hocuspocus instance with its Redis lock, pub/sub and admin channel is one `CollaborationDO` per page;
 * - Redis connection management (`RedisManager`, `waitForRedisReady`, retry strategy) is not needed: the Durable Object
 *   holds the only copy of a page, so there is nothing to synchronize between replicas.
 */
export type LiveEnv = InfraEnv & {
  COLLABORATION?: DurableObjectNamespace
  LIVE_SERVER_SECRET_KEY?: string
  LIVE_CORS_ALLOWED_ORIGINS?: string
  APP_VERSION?: string
}

/** Plane `envSchema`, reduced to what a Worker needs. Values come from bindings, not `process.env`. */
const envSchema = z.object({
  APP_VERSION: z.string().default('1.0.0'),
  LIVE_CORS_ALLOWED_ORIGINS: z.string().default(''),
  LIVE_SERVER_SECRET_KEY: z.string().min(16).optional()
})

/** PD-2060: validated settings. Invalid optional values fall back to defaults instead of stopping the Worker. */
export function validateEnv(env: Partial<LiveEnv>) {
  const result = envSchema.safeParse({
    APP_VERSION: env.APP_VERSION || undefined,
    LIVE_CORS_ALLOWED_ORIGINS: env.LIVE_CORS_ALLOWED_ORIGINS || undefined,
    LIVE_SERVER_SECRET_KEY: env.LIVE_SERVER_SECRET_KEY || undefined
  })
  return result.success
    ? { ok: true as const, ...result.data }
    : { ok: false as const, errors: result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`), ...envSchema.parse({}) }
}

/** PD-2247: origins that may open a socket or call the API from a browser (the app itself plus the configured list). */
export function allowedOrigins(env: Partial<LiveEnv>): string[] {
  const origins = (env.LIVE_CORS_ALLOWED_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean)
  if (env.BETTER_AUTH_URL) {
    try {
      origins.push(new URL(env.BETTER_AUTH_URL).origin)
    } catch {
      // An invalid URL adds nothing.
    }
  }
  return [...new Set(origins)]
}

/**
 * PD-2246: cookie-authenticated sockets must come from an allowed origin, or any site could open the socket with the
 * visitor's session. A request without an `Origin` header (a native client) is not a browser and is accepted.
 */
export function isAllowedOrigin(origin: string | null | undefined, env: Partial<LiveEnv>): boolean {
  return !origin || allowedOrigins(env).includes(origin)
}

/** PD-2050 body: the probe answer. */
export function healthStatus(env: Partial<LiveEnv>) {
  return { status: 'OK', timestamp: new Date().toISOString(), version: validateEnv(env).APP_VERSION }
}

// ------------------------------------------------------------------ Durable Object access

const INTERNAL_ORIGIN = 'https://live.internal'

/** One Durable Object per page: the page id is the document name. */
export function getCollaborationStub(env: Partial<LiveEnv>, pageId: number): DurableObjectStub {
  if (!env.COLLABORATION) throw new Error('The COLLABORATION Durable Object binding is not configured')
  return env.COLLABORATION.get(env.COLLABORATION.idFromName(String(pageId)))
}

/** PD-2070 from outside the object: close every client of a page. Used by services that remove or lock a page. */
export async function forceCloseLivePage(
  env: Partial<LiveEnv>,
  pageId: number,
  reason: ForceCloseReason = ForceCloseReason.ADMIN_REQUEST,
  code: CloseCode = CloseCode.FORCE_CLOSE
): Promise<void> {
  await getCollaborationStub(env, pageId).fetch(`${INTERNAL_ORIGIN}/force-close`, {
    method: 'POST',
    body: JSON.stringify({ page_id: pageId, reason, code })
  })
}

/** PD-2347 from outside the object: send an event (already wrapped by `createRealtimeEvent`) to every client of a page. */
export async function broadcastToLivePage(env: Partial<LiveEnv>, pageId: number, event: unknown): Promise<boolean> {
  const response = await getCollaborationStub(env, pageId).fetch(`${INTERNAL_ORIGIN}/broadcast`, {
    method: 'POST',
    body: JSON.stringify(event)
  })
  return response.ok
}

// ------------------------------------------------------------------ shutdown

export interface DrainTarget extends LiveInstance {
  /** Save the document to the database now. */
  persist(): Promise<void>
  unload(): Promise<void>
  closeAllConnections(code: number, reason: string): void
}

/**
 * PD-2128 to PD-2137: close the clients, save the document and unload it, all before the deadline. A Worker is not told
 * when it is replaced, so this runs from the admin endpoint and before a planned deploy.
 */
export async function drainCollaborationServer(target: DrainTarget, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const timeoutMessage = 'Collaboration shutdown timed out while waiting for document persistence'
  const beforeDeadline = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(timeoutMessage)), Math.max(0, deadline - Date.now()))
        })
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  if (!target.document) return
  target.closeAllConnections(CloseCode.GOING_AWAY, ForceCloseReason.SERVER_SHUTDOWN)
  await beforeDeadline(target.persist())
  await beforeDeadline(target.unload())
}

/** PD-2138 to PD-2141: run an operation that must finish within the shutdown deadline. */
export async function withinShutdownDeadline<T>(operation: (remainingMs: () => number) => Promise<T>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation(() => Math.max(1, deadline - Date.now())),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Collaboration shutdown timed out')), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
