import { Hono } from 'hono'
import { apiV1Routes } from '@/data/linkto'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput } from '@/server/api/v1/validation'
import { getIssueSearch } from '@/server/search/issue'
import { getGlobalSearch, search, searchProjectIssues, searchWorkspaceIssues } from '@/server/search/service'
import type { ApiEnv } from '@/types/api/schema'
import {
  entitySearchQuerySchema,
  globalSearchQuerySchema,
  issueSearchQuerySchema
} from '@/types/reporting/p3-view-schema'
import { reportingIdSchema, searchQuerySchema } from '@/types/reporting/schema'

// Paths added for the Plane port; `/search` and `/issue-search` keep their original issue-only responses.
const p3SearchRoutes = {
  globalSearch: apiV1Routes.globalSearch,
  entitySearch: apiV1Routes.entitySearch,
  searchIssues: apiV1Routes.searchIssues
}
export const workspaceSearchRoutes = new Hono<ApiEnv>()
export const projectSearchRoutes = new Hono<ApiEnv>()
workspaceSearchRoutes.use('*', authenticate)
projectSearchRoutes.use('*', authenticate)
workspaceSearchRoutes.get(apiV1Routes.workspaceSearch, async c =>
  c.json(
    await searchWorkspaceIssues(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(searchQuerySchema, c.req.query('search'))
    )
  )
)
projectSearchRoutes.get(apiV1Routes.projectSearch, async c =>
  c.json(
    await searchProjectIssues(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(reportingIdSchema, c.req.param('projectId')),
      parseInput(searchQuerySchema, c.req.query('search'))
    )
  )
)

workspaceSearchRoutes.get(p3SearchRoutes.globalSearch, async c =>
  c.json(
    await getGlobalSearch(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(globalSearchQuerySchema, c.req.query())
    )
  )
)
workspaceSearchRoutes.get(p3SearchRoutes.entitySearch, async c =>
  c.json(
    await search(getDb(), c.get('actor'), c.req.param('slug')!, parseInput(entitySearchQuerySchema, c.req.query()))
  )
)
projectSearchRoutes.get(p3SearchRoutes.searchIssues, async c =>
  c.json(
    await getIssueSearch(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(reportingIdSchema, c.req.param('projectId')),
      parseInput(issueSearchQuerySchema, c.req.query())
    )
  )
)
