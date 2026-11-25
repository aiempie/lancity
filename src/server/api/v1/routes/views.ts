import { Hono } from 'hono'
import { apiV1Routes } from '@/data/linkto'
import { getDb } from '@/db/client'
import { authenticate, getRequestTimezone } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import { toViewResponse } from '@/server/view/presenters'
import {
  createView,
  deleteView,
  listViews,
  updateView,
  listProjectViews,
  createProjectView,
  updateProjectView,
  deleteProjectView,
  setViewState,
  retrieveWorkspaceView,
  retrieveProjectView,
  listIssueViewFavorites,
  createIssueViewFavorite,
  deleteIssueViewFavorite,
  listWorkspaceViewIssues
} from '@/server/view/service'
import type { ApiEnv } from '@/types/api/schema'
import {
  viewFavoriteInputSchema,
  viewInputSchema,
  viewListQuerySchema,
  viewUpdateSchema
} from '@/types/reporting/p3-view-schema'
import { reportingIdSchema } from '@/types/reporting/schema'

// Paths of the routes added for the Plane port. They move into `apiV1Routes` once `linkto.ts` is updated.
const p3ViewRoutes = {
  viewFavorites: apiV1Routes.viewFavorites,
  viewFavorite: apiV1Routes.viewFavorite,
  workspaceViewIssues: apiV1Routes.workspaceViewIssues
}
const fieldList = (fields: string | undefined) => (fields ?? '').split(',').filter(Boolean)
export const viewsRoutes = new Hono<ApiEnv>()
viewsRoutes.use('*', authenticate)
viewsRoutes.get(apiV1Routes.savedViews, async c => {
  const query = parseInput(viewListQuerySchema, c.req.query())
  const rows = await listViews(getDb(), c.get('actor'), c.req.param('slug')!, query)
  return c.json(rows.map(row => toViewResponse(row, fieldList(query.fields))))
})
viewsRoutes.post(apiV1Routes.savedViews, async c =>
  c.json(await createView(getDb(), c.get('actor'), c.req.param('slug')!, await readJson(c, viewInputSchema)), 201)
)
viewsRoutes.get(apiV1Routes.savedView, async c =>
  c.json(
    await retrieveWorkspaceView(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(reportingIdSchema, c.req.param('viewId'))
    )
  )
)
viewsRoutes.patch(apiV1Routes.savedView, async c =>
  c.json(
    await updateView(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(reportingIdSchema, c.req.param('viewId')),
      await readJson(c, viewUpdateSchema)
    )
  )
)
viewsRoutes.delete(apiV1Routes.savedView, async c => {
  await deleteView(getDb(), c.get('actor'), c.req.param('slug')!, parseInput(reportingIdSchema, c.req.param('viewId')))
  return c.body(null, 204)
})

export const projectViewsRoutes = new Hono<ApiEnv>()
projectViewsRoutes.use('*', authenticate)
projectViewsRoutes.get(apiV1Routes.savedViews, async c => {
  const query = parseInput(viewListQuerySchema, c.req.query())
  const rows = await listProjectViews(
    getDb(),
    c.get('actor'),
    c.req.param('slug')!,
    parseInput(reportingIdSchema, c.req.param('projectId'))
  )
  return c.json(rows.map(row => toViewResponse(row, fieldList(query.fields))))
})
projectViewsRoutes.post(apiV1Routes.savedViews, async c =>
  c.json(
    await createProjectView(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(reportingIdSchema, c.req.param('projectId')),
      await readJson(c, viewInputSchema)
    ),
    201
  )
)
projectViewsRoutes.get(apiV1Routes.savedView, async c =>
  c.json(
    await retrieveProjectView(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(reportingIdSchema, c.req.param('projectId')),
      parseInput(reportingIdSchema, c.req.param('viewId'))
    )
  )
)
projectViewsRoutes.patch(apiV1Routes.savedView, async c =>
  c.json(
    await updateProjectView(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(reportingIdSchema, c.req.param('projectId')),
      parseInput(reportingIdSchema, c.req.param('viewId')),
      await readJson(c, viewUpdateSchema)
    )
  )
)
projectViewsRoutes.delete(apiV1Routes.savedView, async c => {
  await deleteProjectView(
    getDb(),
    c.get('actor'),
    c.req.param('slug')!,
    parseInput(reportingIdSchema, c.req.param('projectId')),
    parseInput(reportingIdSchema, c.req.param('viewId'))
  )
  return c.body(null, 204)
})
viewsRoutes.post(apiV1Routes.viewLock, async c =>
  c.json(
    await setViewState(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      null,
      parseInput(reportingIdSchema, c.req.param('viewId')),
      'lock',
      true
    )
  )
)
viewsRoutes.delete(apiV1Routes.viewLock, async c =>
  c.json(
    await setViewState(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      null,
      parseInput(reportingIdSchema, c.req.param('viewId')),
      'lock',
      false
    )
  )
)
viewsRoutes.post(apiV1Routes.viewArchive, async c =>
  c.json(
    await setViewState(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      null,
      parseInput(reportingIdSchema, c.req.param('viewId')),
      'archive',
      true
    )
  )
)
viewsRoutes.delete(apiV1Routes.viewArchive, async c =>
  c.json(
    await setViewState(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      null,
      parseInput(reportingIdSchema, c.req.param('viewId')),
      'archive',
      false
    )
  )
)
projectViewsRoutes.post(apiV1Routes.viewLock, async c =>
  c.json(
    await setViewState(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(reportingIdSchema, c.req.param('projectId')),
      parseInput(reportingIdSchema, c.req.param('viewId')),
      'lock',
      true
    )
  )
)
projectViewsRoutes.delete(apiV1Routes.viewLock, async c =>
  c.json(
    await setViewState(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(reportingIdSchema, c.req.param('projectId')),
      parseInput(reportingIdSchema, c.req.param('viewId')),
      'lock',
      false
    )
  )
)
projectViewsRoutes.post(apiV1Routes.viewArchive, async c =>
  c.json(
    await setViewState(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(reportingIdSchema, c.req.param('projectId')),
      parseInput(reportingIdSchema, c.req.param('viewId')),
      'archive',
      true
    )
  )
)
projectViewsRoutes.delete(apiV1Routes.viewArchive, async c =>
  c.json(
    await setViewState(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(reportingIdSchema, c.req.param('projectId')),
      parseInput(reportingIdSchema, c.req.param('viewId')),
      'archive',
      false
    )
  )
)

projectViewsRoutes.get(p3ViewRoutes.viewFavorites, async c =>
  c.json(
    await listIssueViewFavorites(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(reportingIdSchema, c.req.param('projectId'))
    )
  )
)
projectViewsRoutes.post(p3ViewRoutes.viewFavorites, async c => {
  await createIssueViewFavorite(
    getDb(),
    c.get('actor'),
    c.req.param('slug')!,
    parseInput(reportingIdSchema, c.req.param('projectId')),
    (await readJson(c, viewFavoriteInputSchema)).view
  )
  return c.body(null, 204)
})
projectViewsRoutes.delete(p3ViewRoutes.viewFavorite, async c => {
  await deleteIssueViewFavorite(
    getDb(),
    c.get('actor'),
    c.req.param('slug')!,
    parseInput(reportingIdSchema, c.req.param('projectId')),
    parseInput(reportingIdSchema, c.req.param('viewId'))
  )
  return c.body(null, 204)
})

/** `GET /workspaces/:slug/issues`: issues across projects, filtered like a saved view (`WorkspaceViewIssuesViewSet`). */
export const workspaceViewIssuesRoutes = new Hono<ApiEnv>()
workspaceViewIssuesRoutes.use('*', authenticate)
workspaceViewIssuesRoutes.get(p3ViewRoutes.workspaceViewIssues, async c =>
  c.json(
    await listWorkspaceViewIssues(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      new URL(c.req.url).searchParams,
      await getRequestTimezone(c)
    )
  )
)
