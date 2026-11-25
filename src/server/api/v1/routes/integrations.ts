import { Hono } from 'hono'
import { apiV1Routes } from '@/data/linkto'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import { getEnv } from '@/server/common/env'
import { allowPermission, ROLE } from '@/server/common/permissions'
import {
  createGptIntegration,
  createWorkspaceGPTIntegration,
  getUnsplash,
  listWorkspaceIntegrations
} from '@/server/integration/service'
import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  listWebhookLogs,
  listWebhooks,
  rotateWebhookSecret,
  updateWebhook
} from '@/server/webhook/service'
import type { ApiEnv } from '@/types/api/schema'
import { webhookIdSchema, webhookInputSchema } from '@/types/integration/schema'
import {
  aiAssistantSchema,
  unsplashQuerySchema,
  webhookLogQuerySchema,
  webhookPatchSchema
} from '@/types/integration/p3-integration-schema'

/**
 * Paths that have no key in `apiV1Routes` yet. Move them there (see the p3-integrations handoff) and import them
 * from `@/data/linkto`.
 */
const p3Paths = {
  aiAssistant: apiV1Routes.aiAssistant,
  projectAiAssistant: apiV1Routes.projectAiAssistant,
  unsplash: apiV1Routes.unsplash
} as const

const requestHost = (url: string) => new URL(url).hostname

/** Mount at `linkto.apiWorkspace`. */
export const integrationsRoutes = new Hono<ApiEnv>()
integrationsRoutes.use('*', authenticate)
integrationsRoutes.get(apiV1Routes.integrations, async c =>
  c.json(await listWorkspaceIntegrations(getDb(), c.get('actor'), c.req.param('slug')!))
)
integrationsRoutes.get(apiV1Routes.webhooks, async c =>
  c.json(await listWebhooks(getDb(), c.get('actor'), c.req.param('slug')!))
)
integrationsRoutes.post(apiV1Routes.webhooks, async c =>
  c.json(
    await createWebhook(getDb(), c.get('actor'), c.req.param('slug')!, await readJson(c, webhookInputSchema), {
      env: getEnv(),
      requestHost: requestHost(c.req.url)
    }),
    201
  )
)
integrationsRoutes.get(apiV1Routes.webhook, async c =>
  c.json(
    await getWebhook(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(webhookIdSchema, c.req.param('webhookId'))
    )
  )
)
integrationsRoutes.patch(apiV1Routes.webhook, async c =>
  c.json(
    await updateWebhook(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(webhookIdSchema, c.req.param('webhookId')),
      await readJson(c, webhookPatchSchema),
      { env: getEnv(), requestHost: requestHost(c.req.url) }
    )
  )
)
integrationsRoutes.delete(apiV1Routes.webhook, async c => {
  await deleteWebhook(
    getDb(),
    c.get('actor'),
    c.req.param('slug')!,
    parseInput(webhookIdSchema, c.req.param('webhookId'))
  )
  return c.body(null, 204)
})
integrationsRoutes.post(apiV1Routes.webhookSecret, async c =>
  c.json(
    await rotateWebhookSecret(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(webhookIdSchema, c.req.param('webhookId'))
    )
  )
)
integrationsRoutes.get(apiV1Routes.webhookLogs, async c =>
  c.json(
    await listWebhookLogs(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(webhookIdSchema, c.req.param('webhookId')),
      parseInput(webhookLogQuerySchema, c.req.query())
    )
  )
)
// Plane `WorkspaceGPTIntegrationEndpoint`
integrationsRoutes.post(p3Paths.aiAssistant, async c =>
  c.json(
    await createWorkspaceGPTIntegration(
      getDb(),
      c.get('actor'),
      getEnv(),
      c.req.param('slug')!,
      await readJson(c, aiAssistantSchema)
    )
  )
)

/** Mount at `linkto.apiProject`. Plane `GPTIntegrationEndpoint`: project admins and members. */
export const projectIntegrationsRoutes = new Hono<ApiEnv>()
projectIntegrationsRoutes.post(
  p3Paths.projectAiAssistant,
  authenticate,
  allowPermission([ROLE.ADMIN, ROLE.MEMBER]),
  async c =>
    c.json(
      await createGptIntegration(
        getDb(),
        c.get('actor'),
        getEnv(),
        c.req.param('slug')!,
        Number(c.req.param('projectId')),
        await readJson(c, aiAssistantSchema)
      )
    )
)

/**
 * Mount at the API root (`/api/v1/unsplash`). Authentication is per route on purpose: a `use('*')` here would
 * also cover every route registered after this router on the root app.
 */
export const externalToolsRoutes = new Hono<ApiEnv>()
externalToolsRoutes.get(p3Paths.unsplash, authenticate, async c => {
  const { status, body } = await getUnsplash(getDb(), getEnv(), parseInput(unsplashQuerySchema, c.req.query()))
  return c.json(body as never, status as never)
})

export default integrationsRoutes
