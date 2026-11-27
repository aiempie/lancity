import { getDb } from '@/db/client'
import { getActor } from '@/lib/auth/server-session'
import { authorizePage, getLiveUser } from '@/server/collaboration/access'
import { AppError } from '@/server/collaboration/errors'
import { CloseEvents, messages, readAuthToken } from '@/server/collaboration/hocuspocus'
import { liveLog } from '@/server/collaboration/logger'
import { getCollaborationStub, isAllowedOrigin, type LiveEnv } from '@/server/collaboration/runtime'
import { liveConnectionQuerySchema, liveContextHeaders } from '@/types/content/p4-live-schema'

/** How long a refused socket stays open when the client does not close it after the `PermissionDenied` message. */
const DENIED_SOCKET_TTL_MS = 5 * 60_000

/**
 * A socket that exists only to refuse a client the Hocuspocus way: the provider sends its token first, and the answer is a
 * `PermissionDenied` message. Refusing at the HTTP upgrade would send the provider into a reconnect loop.
 *
 * Lancity: binary frames arrive as `Blob` from compatibility date 2026-03-17 (`websocket_standard_binary_type`), so the
 * socket asks for `ArrayBuffer` before `accept()`; otherwise the token is never read and the client gets no refusal.
 * Like the Hocuspocus server, the socket also stays open after the refusal instead of closing at once, which made the
 * provider reconnect every second. The client closes it after `onAuthenticationFailed`; otherwise it closes after a while.
 */
function denySocket(reason: string, status: { code: number; reason: string } = CloseEvents.Forbidden): Response {
  const pair = new WebSocketPair()
  const [client, server] = [pair[0], pair[1]]
  server.binaryType = 'arraybuffer'
  server.accept()
  let timer: ReturnType<typeof setTimeout> | undefined
  const close = () => {
    clearTimeout(timer)
    try {
      server.close(status.code, status.reason)
    } catch {
      // Already closed.
    }
  }
  let refused = false
  server.addEventListener('message', event => {
    // The provider sends its sync and awareness messages right after the token: ignore them once refused.
    if (refused) return
    const data = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : null
    const auth = data ? readAuthToken(data) : null
    if (!auth) return close()
    refused = true
    server.send(messages.permissionDenied(auth.documentName, reason))
    timer = setTimeout(close, DENIED_SOCKET_TTL_MS)
  })
  server.addEventListener('close', close)
  return new Response(null, { status: 101, webSocket: client })
}

/**
 * PD-2044, PD-2045, PD-2125 to PD-2127, PD-2335: take a `WS /live/collaboration` request. The session is resolved from the
 * upgrade request cookies, the page access is checked on every connection (a Durable Object serves later clients from
 * memory, so each one must prove its own access), and only then is the socket handed to the page's Durable Object together
 * with trusted context headers. The project always comes from the checked page, never from the client.
 */
export async function handleCollaborationConnection(request: Request, env: LiveEnv): Promise<Response> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket upgrade', { status: 426 })
  if (!isAllowedOrigin(request.headers.get('origin'), env)) return new Response('Origin not allowed', { status: 403 })

  const url = new URL(request.url)
  const query = liveConnectionQuerySchema.safeParse({
    workspaceSlug: url.searchParams.get('workspaceSlug'),
    documentType: url.searchParams.get('documentType'),
    pageId: url.searchParams.get('pageId') ?? url.searchParams.get('documentName')
  })
  if (!query.success) return denySocket('AUTH_INVALID_DOCUMENT_TYPE')
  const { workspaceSlug, pageId } = query.data

  try {
    const actor = await getActor(request.headers)
    if (!actor) return denySocket('AUTH_MISSING_CREDENTIALS', CloseEvents.Unauthorized)
    const db = getDb()
    const [access, user] = await Promise.all([authorizePage(db, actor, workspaceSlug, pageId), getLiveUser(db, actor)])

    const headers = new Headers(request.headers)
    for (const name of Object.values(liveContextHeaders)) headers.delete(name)
    headers.set(liveContextHeaders.userId, String(actor.userId))
    headers.set(liveContextHeaders.userName, encodeURIComponent(user.display_name))
    headers.set(liveContextHeaders.workspaceSlug, encodeURIComponent(workspaceSlug))
    headers.set(liveContextHeaders.projectId, String(access.projectId))
    headers.set(liveContextHeaders.pageId, String(pageId))
    headers.set(liveContextHeaders.readOnly, access.readOnly ? '1' : '0')
    return await getCollaborationStub(env, pageId).fetch(new Request('https://live.internal/socket', { headers }))
  } catch (error) {
    const appError = AppError.from(error, { context: { operation: 'handleCollaborationConnection' } })
    liveLog('connection_refused', { code: appError.code, message: appError.message }, 'warn')
    return denySocket(appError.code ?? 'AUTH_FAILED')
  }
}
