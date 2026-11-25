import { Hono } from 'hono'
import { apiV1Routes } from '@/data/linkto'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import {
  createIntake,
  createIntakeIssue,
  createIntakeIssueApi,
  deleteIntake,
  deleteIntakeIssue,
  deleteIntakeIssueApi,
  getIntake,
  getIntakeIssue,
  getIntakeIssueApi,
  getIntakeWorkItemDescriptionVersion,
  getProjectIntake,
  listIntakeIssues,
  listIntakeIssuesApi,
  listIntakes,
  listIntakeWorkItemDescriptionVersions,
  updateIntake,
  updateIntakeIssue,
  updateIntakeIssueApi
} from '@/server/intake/service'
import type { ApiEnv } from '@/types/api/schema'
import { createIntakeInputSchema, planningIdSchema, updateIntakeInputSchema } from '@/types/planning/schema'
import type { Context } from 'hono'
import { z } from 'zod'
export const intakesRoutes = new Hono<ApiEnv>()
intakesRoutes.use('*', authenticate)
intakesRoutes.get(apiV1Routes.intakes, async c =>
  c.json(
    await listIntakes(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(planningIdSchema, c.req.param('projectId'))
    )
  )
)
intakesRoutes.post(apiV1Routes.intakes, async c =>
  c.json(
    await createIntake(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(planningIdSchema, c.req.param('projectId')),
      await readJson(c, createIntakeInputSchema)
    ),
    201
  )
)
intakesRoutes.get(apiV1Routes.intake, async c =>
  c.json(
    await getIntake(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(planningIdSchema, c.req.param('projectId')),
      parseInput(planningIdSchema, c.req.param('intakeId'))
    )
  )
)
intakesRoutes.patch(apiV1Routes.intake, async c =>
  c.json(
    await updateIntake(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(planningIdSchema, c.req.param('projectId')),
      parseInput(planningIdSchema, c.req.param('intakeId')),
      await readJson(c, updateIntakeInputSchema)
    )
  )
)
intakesRoutes.delete(apiV1Routes.intake, async c => {
  await deleteIntake(
    getDb(),
    c.get('actor'),
    c.req.param('slug')!,
    parseInput(planningIdSchema, c.req.param('projectId')),
    parseInput(planningIdSchema, c.req.param('intakeId'))
  )
  return c.body(null, 204)
})

/**
 * Plane-compatible paths relative to the project mount. They belong in `apiV1Routes` (src/data/linkto.ts); kept here
 * until the integrator adds the keys (see the p2-intake-draft handoff).
 * `inbox-*` follow the app API (status filter, guest rules); `intake-issues` follow the public API (`intake_view`).
 */
const intakeRoutes = {
  inboxes: apiV1Routes.inboxes,
  inbox: apiV1Routes.inbox,
  inboxIssues: apiV1Routes.inboxIssues,
  inboxIssue: apiV1Routes.inboxIssue,
  intakeIssues: apiV1Routes.intakeIssues,
  intakeIssue: apiV1Routes.intakeIssue,
  descriptionVersions: apiV1Routes.intakeDescriptionVersions,
  descriptionVersion: apiV1Routes.intakeDescriptionVersion
} as const

const body = z.record(z.string(), z.unknown())
const scope = (c: Context<ApiEnv>) =>
  [getDb(), c.get('actor'), c.req.param('slug')!, parseInput(planningIdSchema, c.req.param('projectId'))] as const
const idOf = (c: Context<ApiEnv>, name: string) => parseInput(planningIdSchema, c.req.param(name))

// Intake containers (PD-0541 to PD-0547). `GET` answers with the first intake, like Plane's `IntakeViewSet.list`.
intakesRoutes.get(intakeRoutes.inboxes, async c => c.json(await getProjectIntake(...scope(c))))
intakesRoutes.post(intakeRoutes.inboxes, async c =>
  c.json(await createIntake(...scope(c), await readJson(c, createIntakeInputSchema)), 201)
)
intakesRoutes.get(intakeRoutes.inbox, async c => c.json(await getIntake(...scope(c), idOf(c, 'intakeId'))))
intakesRoutes.patch(intakeRoutes.inbox, async c =>
  c.json(await updateIntake(...scope(c), idOf(c, 'intakeId'), await readJson(c, updateIntakeInputSchema)))
)
intakesRoutes.delete(intakeRoutes.inbox, async c => {
  await deleteIntake(...scope(c), idOf(c, 'intakeId'))
  return c.body(null, 204)
})

// App intake work items (PD-0549 to PD-0554).
intakesRoutes.get(intakeRoutes.inboxIssues, async c => c.json(await listIntakeIssues(...scope(c), c.req.query())))
intakesRoutes.post(intakeRoutes.inboxIssues, async c =>
  c.json(await createIntakeIssue(...scope(c), await readJson(c, body)))
)
intakesRoutes.get(intakeRoutes.inboxIssue, async c => c.json(await getIntakeIssue(...scope(c), idOf(c, 'issueId'))))
intakesRoutes.patch(intakeRoutes.inboxIssue, async c =>
  c.json(await updateIntakeIssue(...scope(c), idOf(c, 'issueId'), await readJson(c, body)))
)
intakesRoutes.delete(intakeRoutes.inboxIssue, async c => {
  await deleteIntakeIssue(...scope(c), idOf(c, 'issueId'))
  return c.body(null, 204)
})

// Public API intake work items (PD-0119 to PD-0125).
intakesRoutes.get(intakeRoutes.intakeIssues, async c => c.json(await listIntakeIssuesApi(...scope(c), c.req.query())))
intakesRoutes.post(intakeRoutes.intakeIssues, async c =>
  c.json(await createIntakeIssueApi(...scope(c), await readJson(c, body), c.req.query()), 201)
)
intakesRoutes.get(intakeRoutes.intakeIssue, async c =>
  c.json(await getIntakeIssueApi(...scope(c), idOf(c, 'issueId'), c.req.query()))
)
intakesRoutes.patch(intakeRoutes.intakeIssue, async c =>
  c.json(await updateIntakeIssueApi(...scope(c), idOf(c, 'issueId'), await readJson(c, body), c.req.query()))
)
intakesRoutes.delete(intakeRoutes.intakeIssue, async c => {
  await deleteIntakeIssueApi(...scope(c), idOf(c, 'issueId'))
  return c.body(null, 204)
})

// Description versions of an intake work item (PD-0556, PD-0557).
intakesRoutes.get(intakeRoutes.descriptionVersions, async c =>
  c.json(await listIntakeWorkItemDescriptionVersions(...scope(c), idOf(c, 'workItemId'), c.req.query()))
)
intakesRoutes.get(intakeRoutes.descriptionVersion, async c =>
  c.json(await getIntakeWorkItemDescriptionVersion(...scope(c), idOf(c, 'workItemId'), idOf(c, 'versionId')))
)

export default intakesRoutes
