import { getDb } from '@/db/client'
import { getActor } from '@/lib/auth/server-session'
import { authorizePage, getLiveUser } from '@/server/collaboration/access'
import { AppError } from '@/server/collaboration/errors'
import { CloseEvents, messages, readAuthToken } from '@/server/collaboration/hocuspocus'
import { liveLog } from '@/server/collaboration/logger'
import { getCollaborationStub, isAllowedOrigin, type LiveEnv } from '@/server/collaboration/runtime'
import { liveConnectionQuerySchema, liveContextHeaders } from '@/types/content/p4-live-schema'

/**
 * A socket that exists only to refuse a client the Hocuspocus way: the provider sends its token first, and the answer is a
 * `PermissionDenied` message followed by a close. Refusing at the HTTP upgrade would send the provider into a reconnect loop.
 */
function denySocket(reason: string, status: { code: number; reason: string } = CloseEvents.Forbidden): Response {
  const pair = new WebSocketPair()
  const [client, server] = [pair[0], pair[1]]
  server.accept()
  server.addEventListener('message', event => {
    const data = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : null
    const auth = data ? readAuthToken(data) : null
    if (auth) server.send(messages.permissionDenied(auth.documentName, reason))
    server.close(status.code, status.reason)
  })
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
