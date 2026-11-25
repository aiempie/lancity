import { Hono } from 'hono'
import { apiV1Routes } from '@/data/linkto'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import {
  createDraft,
  createDraftToIssue,
  createWorkspaceDraftIssue,
  deleteDraft,
  deleteWorkspaceDraftIssue,
  getDraft,
  getWorkspaceDraftIssue,
  listDrafts,
  listWorkspaceDraftIssues,
  updateDraft,
  updateWorkspaceDraftIssue
} from '@/server/draft/service'
import type { ApiEnv } from '@/types/api/schema'
import { createDraftInputSchema, planningIdSchema, updateDraftInputSchema } from '@/types/planning/schema'
import type { Context } from 'hono'
import { z } from 'zod'
export const draftsRoutes = new Hono<ApiEnv>()
draftsRoutes.use('*', authenticate)
draftsRoutes.get(apiV1Routes.drafts, async c =>
  c.json(
    await listDrafts(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(planningIdSchema, c.req.param('projectId'))
    )
  )
)
draftsRoutes.post(apiV1Routes.drafts, async c =>
  c.json(
    await createDraft(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(planningIdSchema, c.req.param('projectId')),
      await readJson(c, createDraftInputSchema)
    ),
    201
  )
)
draftsRoutes.get(apiV1Routes.draft, async c =>
  c.json(
    await getDraft(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(planningIdSchema, c.req.param('projectId')),
      parseInput(planningIdSchema, c.req.param('draftId'))
    )
  )
)
draftsRoutes.patch(apiV1Routes.draft, async c =>
  c.json(
    await updateDraft(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(planningIdSchema, c.req.param('projectId')),
      parseInput(planningIdSchema, c.req.param('draftId')),
      await readJson(c, updateDraftInputSchema)
    )
  )
)
draftsRoutes.delete(apiV1Routes.draft, async c => {
  await deleteDraft(
    getDb(),
    c.get('actor'),
    c.req.param('slug')!,
    parseInput(planningIdSchema, c.req.param('projectId')),
    parseInput(planningIdSchema, c.req.param('draftId'))
  )
  return c.body(null, 204)
})

/**
 * Workspace level drafts of Plane (`/workspaces/:slug/draft-issues`). Mount `draftsWorkspaceRoutes` at
 * `linkto.apiWorkspace`. Paths belong in `apiV1Routes` (src/data/linkto.ts); local until the integrator adds them.
 */
const draftRoutes = {
  draftIssues: apiV1Routes.draftIssues,
  draftIssue: apiV1Routes.draftIssue,
  draftToIssue: apiV1Routes.draftToIssue
} as const

export const draftsWorkspaceRoutes = new Hono<ApiEnv>()
draftsWorkspaceRoutes.use('*', authenticate)
const body = z.record(z.string(), z.unknown())
const workspaceScope = (c: Context<ApiEnv>) => [getDb(), c.get('actor'), c.req.param('slug')!] as const
const draftIdOf = (c: Context<ApiEnv>) => parseInput(planningIdSchema, c.req.param('draftId'))

draftsWorkspaceRoutes.get(draftRoutes.draftIssues, async c =>
  c.json(await listWorkspaceDraftIssues(...workspaceScope(c), c.req.query()))
)
draftsWorkspaceRoutes.post(draftRoutes.draftIssues, async c =>
  c.json(await createWorkspaceDraftIssue(...workspaceScope(c), await readJson(c, body)), 201)
)
draftsWorkspaceRoutes.get(draftRoutes.draftIssue, async c =>
  c.json(await getWorkspaceDraftIssue(...workspaceScope(c), draftIdOf(c)))
)
draftsWorkspaceRoutes.patch(draftRoutes.draftIssue, async c => {
  await updateWorkspaceDraftIssue(...workspaceScope(c), draftIdOf(c), await readJson(c, body))
  return c.body(null, 204)
})
draftsWorkspaceRoutes.delete(draftRoutes.draftIssue, async c => {
  await deleteWorkspaceDraftIssue(...workspaceScope(c), draftIdOf(c))
  return c.body(null, 204)
})
draftsWorkspaceRoutes.post(draftRoutes.draftToIssue, async c =>
  c.json(await createDraftToIssue(...workspaceScope(c), draftIdOf(c), await readJson(c, body)), 201)
)

export default draftsWorkspaceRoutes
