import { Hono, type Context } from 'hono'
import { apiV1Routes } from '@/data/linkto'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import { listArchivedCycles, setCycleArchived } from '@/server/cycle/archive'
import { transferCycleIssues } from '@/server/cycle/cycle-transfer-issues'
import { getCycleIssue, listCycleIssuesPage } from '@/server/cycle/issue'
import { listCycleSnapshots } from '@/server/cycle/snapshot'
import {
  assignCycleIssues,
  checkCycleDates,
  createCycle,
  createCycleFavorite,
  deleteCycle,
  deleteCycleFavorite,
  getCycleAnalytics,
  getCycleProgress,
  getCycleUserProperties,
  getWorkspaceCycles,
  listCycleFavorites,
  listCycleIssues,
  listCycles,
  listCyclesLite,
  listCyclesPaginated,
  removeCycleIssue,
  retrieveCycle,
  updateCycle,
  updateCycleUserProperties
} from '@/server/cycle/service'
import type { ApiEnv } from '@/types/api/schema'
import {
  createCycleApiInputSchema,
  cycleAnalyticsQuerySchema,
  cycleDateCheckInputSchema,
  cycleFavoriteInputSchema,
  cycleListQuerySchema,
  cycleUserPropertiesInputSchema,
  updateCycleApiInputSchema
} from '@/types/planning/p2-cycle-schema'
import { planningIdSchema, planningIssuesInputSchema, transferCycleIssuesInputSchema } from '@/types/planning/schema'

const paths = {
  cyclesLite: apiV1Routes.cyclesLite,
  dateCheck: apiV1Routes.cycleDateCheck,
  progress: apiV1Routes.cycleProgress,
  analytics: apiV1Routes.cycleAnalytics,
  snapshots: apiV1Routes.cycleSnapshots,
  userProperties: apiV1Routes.cycleUserProperties,
  favorites: apiV1Routes.favoriteCycles,
  favorite: apiV1Routes.favoriteCycle
}

type C = Context<ApiEnv>
const scope = (c: C) =>
  [getDb(), c.get('actor'), c.req.param('slug')!, parseInput(planningIdSchema, c.req.param('projectId'))] as const
const cycleId = (c: C) => parseInput(planningIdSchema, c.req.param('cycleId'))
const searchParams = (c: C) => new URL(c.req.url).searchParams

export const cyclesRoutes = new Hono<ApiEnv>()
cyclesRoutes.use('*', authenticate)

// With `per_page` or `cursor` the list answers Plane's API envelope (PD-0081); otherwise it is the app list (PD-0495).
cyclesRoutes.get(apiV1Routes.cycles, async c => {
  const params = searchParams(c)
  if (params.has('per_page') || params.has('cursor')) return c.json(await listCyclesPaginated(...scope(c), params))
  return c.json(await listCycles(...scope(c), cycleListQuerySchema.parse(Object.fromEntries(params))))
})
cyclesRoutes.get(paths.cyclesLite, async c => c.json(await listCyclesLite(...scope(c), searchParams(c))))
cyclesRoutes.post(apiV1Routes.cycles, async c => {
  const cycle = await createCycle(...scope(c), await readJson(c, createCycleApiInputSchema))
  return c.json(await retrieveCycle(...scope(c), cycle.id), 201)
})
cyclesRoutes.post(paths.dateCheck, async c =>
  c.json(await checkCycleDates(...scope(c), await readJson(c, cycleDateCheckInputSchema)))
)
cyclesRoutes.get(paths.favorites, async c => c.json(await listCycleFavorites(...scope(c))))
cyclesRoutes.post(paths.favorites, async c => {
  const input = await readJson(c, cycleFavoriteInputSchema)
  await createCycleFavorite(...scope(c), input.cycle)
  return c.body(null, 204)
})
cyclesRoutes.delete(paths.favorite, async c => {
  await deleteCycleFavorite(...scope(c), cycleId(c))
  return c.body(null, 204)
})
cyclesRoutes.get(apiV1Routes.cycle, async c => c.json(await retrieveCycle(...scope(c), cycleId(c))))
// PUT is the DRF `update` adapter (PD-0493). Plane's serializer is read-only there, so it shares the PATCH rules.
const update = async (c: C) => {
  await updateCycle(...scope(c), cycleId(c), await readJson(c, updateCycleApiInputSchema))
  return c.json(await retrieveCycle(...scope(c), cycleId(c)))
}
cyclesRoutes.patch(apiV1Routes.cycle, update)
cyclesRoutes.put(apiV1Routes.cycle, update)
cyclesRoutes.delete(apiV1Routes.cycle, async c => {
  await deleteCycle(...scope(c), cycleId(c))
  return c.body(null, 204)
})
cyclesRoutes.get(paths.progress, async c => c.json(await getCycleProgress(...scope(c), cycleId(c))))
cyclesRoutes.get(paths.analytics, async c =>
  c.json(
    await getCycleAnalytics(
      ...scope(c),
      cycleId(c),
      cycleAnalyticsQuerySchema.parse(Object.fromEntries(searchParams(c))).type
    )
  )
)
cyclesRoutes.get(paths.snapshots, async c => c.json(await listCycleSnapshots(...scope(c), cycleId(c))))
cyclesRoutes.get(paths.userProperties, async c => c.json(await getCycleUserProperties(...scope(c), cycleId(c))))
cyclesRoutes.patch(paths.userProperties, async c =>
  c.json(
    await updateCycleUserProperties(...scope(c), cycleId(c), await readJson(c, cycleUserPropertiesInputSchema)),
    201
  )
)

// Without query parameters the list keeps its original shape (assignments with their issue).
cyclesRoutes.get(apiV1Routes.cycleIssues, async c => {
  const params = searchParams(c)
  if (Array.from(params.keys()).length)
    return c.json(await listCycleIssuesPage(...scope(c), cycleId(c), Object.fromEntries(params)))
  return c.json(await listCycleIssues(...scope(c), cycleId(c)))
})
cyclesRoutes.post(apiV1Routes.cycleIssues, async c => {
  const input = await readJson(c, planningIssuesInputSchema)
  await assignCycleIssues(...scope(c), cycleId(c), input.issues)
  return c.body(null, 204)
})
cyclesRoutes.get(apiV1Routes.cycleIssue, async c =>
  c.json(await getCycleIssue(...scope(c), cycleId(c), parseInput(planningIdSchema, c.req.param('issueId'))))
)
cyclesRoutes.delete(apiV1Routes.cycleIssue, async c => {
  await removeCycleIssue(...scope(c), cycleId(c), parseInput(planningIdSchema, c.req.param('issueId')))
  return c.body(null, 204)
})

cyclesRoutes.get(apiV1Routes.archivedCycles, async c => c.json(await listArchivedCycles(...scope(c))))
cyclesRoutes.get(apiV1Routes.archivedCycle, async c => c.json(await listArchivedCycles(...scope(c), cycleId(c))))
const archive = async (c: C) => {
  const result = await setCycleArchived(...scope(c), cycleId(c), true)
  return c.json({ archived_at: result.archivedAt })
}
const unarchive = async (c: C) => {
  await setCycleArchived(...scope(c), cycleId(c), false)
  return c.body(null, 204)
}
cyclesRoutes.post(apiV1Routes.cycleArchive, archive)
cyclesRoutes.delete(apiV1Routes.cycleArchive, unarchive)
cyclesRoutes.delete(apiV1Routes.archivedCycleRestore, unarchive)
cyclesRoutes.post(apiV1Routes.archivedCycle, archive)
cyclesRoutes.delete(apiV1Routes.archivedCycle, unarchive)
cyclesRoutes.post(apiV1Routes.cycleTransferIssues, async c => {
  const input = await readJson(c, transferCycleIssuesInputSchema)
  return c.json(await transferCycleIssues(...scope(c), cycleId(c), input.new_cycle_id))
})

/** Workspace-wide cycle list (PD-0881). Mount it under the workspace path (`linkto.apiWorkspace`), not the project path. */
export const workspaceCyclesRoutes = new Hono<ApiEnv>()
workspaceCyclesRoutes.use('*', authenticate)
workspaceCyclesRoutes.get(apiV1Routes.cycles, async c =>
  c.json(await getWorkspaceCycles(getDb(), c.get('actor'), c.req.param('slug')!, searchParams(c).get('order_by')))
)

export default cyclesRoutes
