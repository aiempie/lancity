import { apiV1Routes } from '@/data/linkto'
import { Hono, type Context } from 'hono'
import { parseInput } from '@/server/api/v1/validation'
import { verifySecretKey } from '@/server/collaboration/access'
import { ForceCloseReason, CloseCode } from '@/server/collaboration/admin-commands'
import { convertDocument } from '@/server/collaboration/document'
import { forceCloseLivePage, healthStatus, type LiveEnv } from '@/server/collaboration/runtime'
import { handleCollaborationConnection } from '@/server/collaboration/socket'
import { getEnv } from '@/server/common/env'
import { ServiceError } from '@/server/common/errors'
import type { ApiEnv } from '@/types/api/schema'
import { forceCloseBodySchema } from '@/types/content/p4-live-schema'

/**
 * Connection contract of the Lancity web and mobile clients (not the Plane client):
 *
 * - `GET /live/collaboration` upgrades to a WebSocket. Query parameters, all required:
 *   - `workspaceSlug`: slug of the workspace that owns the page;
 *   - `documentType`: must be `project_page`;
 *   - `pageId`: numeric page id (`documentName` is accepted as an alias for Hocuspocus providers, where it is the page id).
 *   Unknown query parameters are rejected. The project is never taken from the client; it comes from the page.
 * - Authentication is the Better Auth session cookie of the upgrade request. A request with an `Origin` header must come
 *   from an allowed origin (`LIVE_CORS_ALLOWED_ORIGINS` or `BETTER_AUTH_URL`); native clients send none.
 * - The first message must be a Hocuspocus auth message for document name `<pageId>` whose token carries the user `id`.
 *   Refusals are answered with a `PermissionDenied` message and a close, never with an HTTP error on the upgrade.
 * - `POST /live/convert-document` and `POST /live/force-close` are server to server and need the
 *   `live-server-secret-key` header.
 */

/**
 * Paths relative to the mount point (`/live` under the API prefix). Proposed as `apiV1Routes` keys in the p4-live handoff.
 * Plane served them under `LIVE_BASE_PATH` (`/live`).
 */
export const livePaths = {
  health: apiV1Routes.liveHealth,
  collaboration: apiV1Routes.liveCollaboration,
  convertDocument: apiV1Routes.liveConvertDocument,
  forceClose: apiV1Routes.liveForceClose
}

/** Largest accepted body of the server-to-server endpoints (HTML up to the 10 MB page limit plus the envelope). */
const MAX_BODY_BYTES = 12 * 1024 * 1024

/** PD-2124 `requireSecretKey`: the `live-server-secret-key` header must match `LIVE_SERVER_SECRET_KEY`. */
async function requireSecretKey(c: Context) {
  const env = getEnv() as LiveEnv
  if (!(await verifySecretKey(c.req.header('live-server-secret-key'), env.LIVE_SERVER_SECRET_KEY)))
    throw new ServiceError(401, 'UNAUTHORIZED', 'Unauthorized')
}

async function readBody(c: Context): Promise<unknown> {
  if (Number(c.req.header('content-length') ?? 0) > MAX_BODY_BYTES) throw new ServiceError(413, 'PAYLOAD_TOO_LARGE', 'Body too large')
  return c.req.json().catch(() => null)
}

export const liveRoutes = new Hono<ApiEnv>({ strict: false })

/** PD-2050: probe. The platform probe (PD-2041) answers for the API; this one keeps the Live path of Plane working. */
liveRoutes.get(livePaths.health, c => c.json(healthStatus(getEnv() as LiveEnv)))

/** PD-2044: `WS /live/collaboration`. Authentication is by session cookie and page access, see `socket.ts`. */
liveRoutes.get(livePaths.collaboration, c => handleCollaborationConnection(c.req.raw, getEnv() as LiveEnv))

/** PD-2048: `POST /live/convert-document/`. Server to server: Plane's asset copy task sends the HTML here. */
liveRoutes.post(livePaths.convertDocument, async c => {
  await requireSecretKey(c)
  const result = convertDocument(await readBody(c))
  return c.json(result.body, result.status)
})

/** Replaces the Redis admin channel: close every client of a page. Server to server. */
liveRoutes.post(livePaths.forceClose, async c => {
  await requireSecretKey(c)
  const body = parseInput(forceCloseBodySchema, await readBody(c))
  await forceCloseLivePage(getEnv() as LiveEnv, body.page_id, body.reason as ForceCloseReason, body.code as CloseCode)
  return c.body(null, 204)
})

export default liveRoutes
