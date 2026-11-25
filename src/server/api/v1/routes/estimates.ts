import { Hono } from 'hono'
import { apiV1Routes } from '@/data/linkto'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import {
  bulkCreateEstimate,
  bulkUpdateEstimate,
  createEstimatePoint,
  createEstimatePoints,
  deleteEstimate,
  deleteEstimatePoint,
  getEstimate,
  getProjectEstimatePoints,
  getWorkspaceEstimates,
  listEstimates,
  updateEstimate,
  updateEstimatePoint
} from '@/server/estimate/service'
import { ServiceError } from '@/server/common/errors'
import type { ApiEnv } from '@/types/api/schema'
import {
  bulkCreateEstimateInputSchema,
  createEstimatePointsInputSchema,
  deleteEstimatePointInputSchema,
  patchEstimateInputSchema
} from '@/types/planning/p2-estimate-schema'
import { estimatePointsInputSchema, planningIdSchema, updateEstimatePointInputSchema } from '@/types/planning/schema'

// TODO(integrator): move to `apiV1Routes` in src/data/linkto.ts (see handoff p2-estimate).
const estimateRoutes = { projectEstimates: apiV1Routes.projectEstimates, workspaceEstimates: apiV1Routes.workspaceEstimates } as const

/** Mounted at `apiWorkspace`. Plane `WorkspaceEstimatesEndpoint` (PD-0891). */
export const workspaceEstimatesRoutes = new Hono<ApiEnv>()
workspaceEstimatesRoutes.use('*', authenticate)
workspaceEstimatesRoutes.get(estimateRoutes.workspaceEstimates, async c =>
  c.json(await getWorkspaceEstimates(getDb(), c.get('actor'), c.req.param('slug')!))
)

/** Mounted at `apiProject`. */
export const estimatesRoutes = new Hono<ApiEnv>()
estimatesRoutes.use('*', authenticate)
estimatesRoutes.get(apiV1Routes.estimates, async c =>
  c.json(
    await listEstimates(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(planningIdSchema, c.req.param('projectId'))
    )
  )
)
estimatesRoutes.get(estimateRoutes.projectEstimates, async c =>
  c.json(
    await getProjectEstimatePoints(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(planningIdSchema, c.req.param('projectId'))
    )
  )
)
estimatesRoutes.post(apiV1Routes.estimates, async c =>
  c.json(
    await bulkCreateEstimate(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(planningIdSchema, c.req.param('projectId')),
      await readJson(c, bulkCreateEstimateInputSchema)
    ),
    201
  )
)
estimatesRoutes.get(apiV1Routes.estimate, async c =>
  c.json(
    await getEstimate(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(planningIdSchema, c.req.param('projectId')),
      parseInput(planningIdSchema, c.req.param('estimateId'))
    )
  )
)
estimatesRoutes.patch(apiV1Routes.estimate, async c => {
  const [db, actor, slug] = [getDb(), c.get('actor'), c.req.param('slug')!]
  const projectId = parseInput(planningIdSchema, c.req.param('projectId'))
  const estimateId = parseInput(planningIdSchema, c.req.param('estimateId'))
  const body = await readJson(c, patchEstimateInputSchema)
  // Plane sends points to the bulk form; name/description only go to the plain form.
  return c.json(
    'estimate_points' in body
      ? await bulkUpdateEstimate(db, actor, slug, projectId, estimateId, body)
      : await updateEstimate(db, actor, slug, projectId, estimateId, body)
  )
})
estimatesRoutes.delete(apiV1Routes.estimate, async c => {
  await deleteEstimate(
    getDb(),
    c.get('actor'),
    c.req.param('slug')!,
    parseInput(planningIdSchema, c.req.param('projectId')),
    parseInput(planningIdSchema, c.req.param('estimateId'))
  )
  return c.body(null, 204)
})

estimatesRoutes.get(apiV1Routes.estimatePoints, async c => {
  const result = await getEstimate(
    getDb(),
    c.get('actor'),
    c.req.param('slug')!,
    parseInput(planningIdSchema, c.req.param('projectId')),
    parseInput(planningIdSchema, c.req.param('estimateId'))
  )
  return c.json(result.points)
})
estimatesRoutes.post(apiV1Routes.estimatePoints, async c => {
  const [db, actor, slug] = [getDb(), c.get('actor'), c.req.param('slug')!]
  const projectId = parseInput(planningIdSchema, c.req.param('projectId'))
  const estimateId = parseInput(planningIdSchema, c.req.param('estimateId'))
  const body = await readJson(c, createEstimatePointsInputSchema)
  if ('key' in body && !Array.isArray(body)) return c.json(await createEstimatePoint(db, actor, slug, projectId, estimateId, body), 201)
  const points = parseInput(estimatePointsInputSchema, body)
  return c.json(await createEstimatePoints(db, actor, slug, projectId, estimateId, points), 201)
})
estimatesRoutes.patch(apiV1Routes.estimatePoint, async c =>
  c.json(
    await updateEstimatePoint(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(planningIdSchema, c.req.param('projectId')),
      parseInput(planningIdSchema, c.req.param('estimateId')),
      parseInput(planningIdSchema, c.req.param('pointId')),
      await readJson(c, updateEstimatePointInputSchema)
    )
  )
)
estimatesRoutes.delete(apiV1Routes.estimatePoint, async c => {
  const text = await c.req.text()
  let json: unknown = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new ServiceError(400, 'INVALID_JSON', 'Request body must be valid JSON')
  }
  const input = parseInput(deleteEstimatePointInputSchema, json)
  return c.json(
    await deleteEstimatePoint(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(planningIdSchema, c.req.param('projectId')),
      parseInput(planningIdSchema, c.req.param('estimateId')),
      parseInput(planningIdSchema, c.req.param('pointId')),
      input.new_estimate_id
    )
  )
})
