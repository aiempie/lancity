import { Hono, type Context } from 'hono'
import { apiV1Routes } from '@/data/linkto'
import { getDb } from '@/db/client'
import { getAdvanceAnalytics, getAdvanceAnalyticsChart, getAdvanceAnalyticsStats } from '@/server/analytics/advance'
import {
  getProjectAdvanceAnalytics,
  getProjectAdvanceAnalyticsChart,
  getProjectAdvanceAnalyticsStats
} from '@/server/analytics/project-analytics'
import {
  createAnalyticView,
  deleteAnalyticView,
  exportAnalytics,
  getAnalyticExport,
  getAnalytics,
  getAnalyticView,
  getDefaultAnalytics,
  getProjectStats,
  getSavedAnalytic,
  listAnalyticViews,
  projectIssueMetrics,
  updateAnalyticView
} from '@/server/analytics/service'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import { requireBucket } from '@/server/asset/storage'
import { getEnv } from '@/server/common/env'
import { notFoundError } from '@/server/common/errors'
import type { FilterParams } from '@/server/issue/filter'
import type { ApiEnv } from '@/types/api/schema'
import {
  advanceAnalyticsQuerySchema,
  analyticsIdSchema,
  analyticViewInputSchema,
  analyticViewUpdateSchema,
  exportAnalyticsInputSchema,
  projectStatsQuerySchema
} from '@/types/reporting/p3-analytics-schema'
import { reportingIdSchema } from '@/types/reporting/schema'

const paths = {
  advance: apiV1Routes.advanceAnalytics,
  advanceStats: apiV1Routes.advanceAnalyticsStats,
  advanceCharts: apiV1Routes.advanceAnalyticsCharts,
  analytics: apiV1Routes.workspaceAnalytics,
  views: apiV1Routes.analyticViews,
  view: apiV1Routes.analyticView,
  saved: apiV1Routes.savedAnalytic,
  exportAnalytics: apiV1Routes.exportAnalytics,
  exportDownload: apiV1Routes.exportAnalyticsDownload,
  defaultAnalytics: apiV1Routes.defaultAnalytics,
  projectStats: apiV1Routes.projectStats
}

type C = Context<ApiEnv>
const slugOf = (c: C) => c.req.param('slug')!
const projectOf = (c: C) => parseInput(reportingIdSchema, c.req.param('projectId'))

/** Query string as issue filter parameters: a repeated key becomes a list. */
function filterParams(c: C): FilterParams {
  const params: FilterParams = {}
  for (const [key, value] of new URL(c.req.url).searchParams) {
    const previous = params[key]
    params[key] = previous === undefined ? value : [...(Array.isArray(previous) ? previous : [previous]), value]
  }
  return params
}
const advanceQuery = (c: C) =>
  parseInput(advanceAnalyticsQuerySchema, Object.fromEntries(new URL(c.req.url).searchParams))

/** Project level routes, mounted at `linkto.apiProject`. */
export const analyticsRoutes = new Hono<ApiEnv>()
analyticsRoutes.use('*', authenticate)
analyticsRoutes.get(apiV1Routes.projectAnalytics, async c =>
  c.json(await projectIssueMetrics(getDb(), c.get('actor'), slugOf(c), projectOf(c)))
)
// PD-0424, PD-0427, PD-0429.
analyticsRoutes.get(paths.advance, async c =>
  c.json(await getProjectAdvanceAnalytics(getDb(), c.get('actor'), slugOf(c), projectOf(c), advanceQuery(c)))
)
analyticsRoutes.get(paths.advanceStats, async c =>
  c.json(await getProjectAdvanceAnalyticsStats(getDb(), c.get('actor'), slugOf(c), projectOf(c), advanceQuery(c)))
)
analyticsRoutes.get(paths.advanceCharts, async c =>
  c.json(await getProjectAdvanceAnalyticsChart(getDb(), c.get('actor'), slugOf(c), projectOf(c), advanceQuery(c)))
)

/** Workspace level routes, mounted at `linkto.apiWorkspace`. */
export const workspaceAnalyticsRoutes = new Hono<ApiEnv>()
workspaceAnalyticsRoutes.use('*', authenticate)
// PD-0401, PD-0404, PD-0407.
workspaceAnalyticsRoutes.get(paths.advance, async c =>
  c.json(await getAdvanceAnalytics(getDb(), c.get('actor'), slugOf(c), advanceQuery(c)))
)
workspaceAnalyticsRoutes.get(paths.advanceStats, async c =>
  c.json(await getAdvanceAnalyticsStats(getDb(), c.get('actor'), slugOf(c), advanceQuery(c)))
)
workspaceAnalyticsRoutes.get(paths.advanceCharts, async c =>
  c.json(await getAdvanceAnalyticsChart(getDb(), c.get('actor'), slugOf(c), advanceQuery(c)))
)
// PD-0408, PD-0418, PD-0419.
workspaceAnalyticsRoutes.get(paths.analytics, async c =>
  c.json(await getAnalytics(getDb(), c.get('actor'), slugOf(c), filterParams(c)))
)
workspaceAnalyticsRoutes.get(paths.defaultAnalytics, async c =>
  c.json(await getDefaultAnalytics(getDb(), c.get('actor'), slugOf(c), filterParams(c)))
)
workspaceAnalyticsRoutes.get(paths.projectStats, async c =>
  c.json(
    await getProjectStats(
      getDb(),
      c.get('actor'),
      slugOf(c),
      parseInput(projectStatsQuerySchema, Object.fromEntries(new URL(c.req.url).searchParams))
    )
  )
)
// PD-0409 to PD-0413: the saved analytic view CRUD. PUT is not routed, as in Plane.
const viewId = (c: C) => parseInput(analyticsIdSchema, c.req.param('viewId'))
workspaceAnalyticsRoutes.get(paths.views, async c =>
  c.json(await listAnalyticViews(getDb(), c.get('actor'), slugOf(c)))
)
workspaceAnalyticsRoutes.post(paths.views, async c =>
  c.json(await createAnalyticView(getDb(), c.get('actor'), slugOf(c), await readJson(c, analyticViewInputSchema)), 201)
)
workspaceAnalyticsRoutes.get(paths.view, async c =>
  c.json(await getAnalyticView(getDb(), c.get('actor'), slugOf(c), viewId(c)))
)
workspaceAnalyticsRoutes.patch(paths.view, async c =>
  c.json(
    await updateAnalyticView(getDb(), c.get('actor'), slugOf(c), viewId(c), await readJson(c, analyticViewUpdateSchema))
  )
)
workspaceAnalyticsRoutes.delete(paths.view, async c => {
  await deleteAnalyticView(getDb(), c.get('actor'), slugOf(c), viewId(c))
  return c.body(null, 204)
})
// PD-0416.
workspaceAnalyticsRoutes.get(paths.saved, async c =>
  c.json(
    await getSavedAnalytic(
      getDb(),
      c.get('actor'),
      slugOf(c),
      parseInput(analyticsIdSchema, c.req.param('analyticId')),
      filterParams(c)
    )
  )
)
// PD-0417 and the download of the finished file.
workspaceAnalyticsRoutes.post(paths.exportAnalytics, async c =>
  c.json(
    await exportAnalytics(getDb(), c.get('actor'), slugOf(c), await readJson(c, exportAnalyticsInputSchema), getEnv())
  )
)
workspaceAnalyticsRoutes.get(paths.exportDownload, async c => {
  const row = await getAnalyticExport(
    getDb(),
    c.get('actor'),
    slugOf(c),
    parseInput(analyticsIdSchema, c.req.param('exportId'))
  )
  const object = await requireBucket(getEnv().ASSET_BUCKET).get(row.objectKey!)
  if (!object) throw notFoundError('The export is not available.')
  return new Response(object.body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slugOf(c)}-analytics.csv"`,
      'Content-Length': String(object.size),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store'
    }
  })
})

export default workspaceAnalyticsRoutes
