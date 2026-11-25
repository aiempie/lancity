import { Hono } from 'hono'
import { apiV1Routes } from '@/data/linkto'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import { getEnv } from '@/server/common/env'
import { downloadExport, exportIssues, exportProjectIssuesCsv, listExports } from '@/server/export/service'
import type { ApiEnv } from '@/types/api/schema'
import { exportIssuesInputSchema } from '@/types/reporting/p3-export-schema'
import { reportingIdSchema } from '@/types/reporting/schema'
export const exportsRoutes = new Hono<ApiEnv>()
exportsRoutes.use('*', authenticate)
exportsRoutes.get(apiV1Routes.projectExport, async c =>
  c.body(
    await exportProjectIssuesCsv(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(reportingIdSchema, c.req.param('projectId'))
    ),
    200,
    { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="issues.csv"' }
  )
)

// Workspace level issue exports (PD-0532, PD-0533). Mount at `linkto.apiWorkspace`; the route above stays at `linkto.apiProject`.
const paths = { exportIssues: apiV1Routes.exportIssues, download: apiV1Routes.exportIssueDownload }

export const workspaceExportsRoutes = new Hono<ApiEnv>()
workspaceExportsRoutes.use('*', authenticate)
workspaceExportsRoutes.post(paths.exportIssues, async c =>
  c.json(await exportIssues(getDb(), c.get('actor'), c.req.param('slug')!, await readJson(c, exportIssuesInputSchema)))
)
workspaceExportsRoutes.get(paths.exportIssues, async c =>
  c.json(await listExports(getDb(), c.get('actor'), c.req.param('slug')!, new URL(c.req.url).searchParams))
)
workspaceExportsRoutes.get(paths.download, async c =>
  downloadExport(
    getDb(),
    c.get('actor'),
    c.req.param('slug')!,
    parseInput(reportingIdSchema, c.req.param('exportId')),
    getEnv().ASSET_BUCKET
  )
)

export default workspaceExportsRoutes
