import vinext from 'vinext/server/fetch-handler'
import { apiV1Routes, linkto } from '@/data/linkto'
import type { InfraEnv } from '@/server/common/env'
import { handleQueueBatch, handleScheduledEvent, type JobMessage } from '@/server/common/jobs'
import { handleCollaborationConnection } from '@/server/collaboration/socket'
import type { LiveEnv } from '@/server/collaboration/runtime'

// Re-export named exports of the Vinext entry (Durable Objects, Workflows) when they exist.
export * from 'vinext/server/fetch-handler'
// Durable Object of the live editor (binding COLLABORATION, see cloudflare.config.ts).
export { CollaborationDO } from '@/server/live/collaboration-do'

const app = vinext as unknown as { fetch(request: Request, env: InfraEnv, ctx: ExecutionContext): Promise<Response> | Response }

const collaborationPath = `${linkto.apiV1}${linkto.apiLive}${apiV1Routes.liveCollaboration}`

/**
 * The WebSocket upgrade bypasses Hono: the API middleware (`privateNoStore`) rewrites response headers after `next()`,
 * which can drop the `webSocket` of a 101 response. The socket authenticates itself (session cookie and page access).
 */
function isCollaborationUpgrade(request: Request): boolean {
  return request.headers.get('Upgrade')?.toLowerCase() === 'websocket' && new URL(request.url).pathname === collaborationPath
}

/** Worker entry: Vinext serves HTTP, Queues and Cron Triggers run background jobs. */
export default {
  fetch: (request, env, ctx) =>
    isCollaborationUpgrade(request) ? handleCollaborationConnection(request, env as LiveEnv) : app.fetch(request, env, ctx),
  queue: (batch, env) => handleQueueBatch(batch, env),
  scheduled: (controller, env, ctx) => handleScheduledEvent(controller, env, ctx)
} satisfies ExportedHandler<InfraEnv, JobMessage>
