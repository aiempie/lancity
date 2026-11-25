import { apiV1Routes } from '@/data/linkto'
import { Hono } from 'hono'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import { createApiToken, deleteApiToken, getApiToken, listApiTokens, updateApiToken } from '@/server/integration/api'
import type { ApiEnv } from '@/types/api/schema'
import { apiTokenCreateSchema, apiTokenIdSchema, apiTokenUpdateSchema } from '@/types/integration/p3-integration-schema'

/** Paths relative to the mount point `linkto.users`. Move them to `apiV1Routes` (see the p3-integrations handoff). */
const p3Paths = { apiTokens: apiV1Routes.apiTokens, apiToken: apiV1Routes.apiToken } as const

/** Plane `ApiTokenEndpoint`. Mount at `linkto.users`: `/api/v1/users/api-tokens`. */
export const apiTokensRoutes = new Hono<ApiEnv>()
apiTokensRoutes.use(`${p3Paths.apiTokens}/*`, authenticate)
apiTokensRoutes.use(p3Paths.apiTokens, authenticate)
apiTokensRoutes.get(p3Paths.apiTokens, async c => c.json(await listApiTokens(getDb(), c.get('actor'))))
apiTokensRoutes.post(p3Paths.apiTokens, async c => {
  const input = await readJson(c, apiTokenCreateSchema)
  return c.json(await createApiToken(getDb(), c.get('actor'), input), 201)
})
apiTokensRoutes.get(p3Paths.apiToken, async c =>
  c.json(await getApiToken(getDb(), c.get('actor'), parseInput(apiTokenIdSchema, c.req.param('tokenId'))))
)
apiTokensRoutes.patch(p3Paths.apiToken, async c =>
  c.json(
    await updateApiToken(
      getDb(),
      c.get('actor'),
      parseInput(apiTokenIdSchema, c.req.param('tokenId')),
      await readJson(c, apiTokenUpdateSchema)
    )
  )
)
apiTokensRoutes.delete(p3Paths.apiToken, async c => {
  await deleteApiToken(getDb(), c.get('actor'), parseInput(apiTokenIdSchema, c.req.param('tokenId')))
  return c.body(null, 204)
})

export default apiTokensRoutes
