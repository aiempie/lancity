import { Hono } from 'hono'
import { apiV1Routes } from '@/data/linkto'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import { enqueueWorkspaceSeed } from '@/server/workspace/jobs'
import {
  createWorkspaceMemberUserViews,
  getWorkspaceMember,
  getWorkspaceMemberUser,
  getWorkspaceProjectMember,
  leaveWorkspaceMember,
  listWorkspaceMembers,
  listWorkspaceMembersLite,
  removeWorkspaceMember,
  updateWorkspaceMember
} from '@/server/workspace/member'
import { createRecentVisit, listUserRecentVisits } from '@/server/workspace/recent-visit'
import { workspaceApiRoutes as paths } from '@/server/workspace/routes'
import { createWorkspaceWithSeed } from '@/server/workspace/seed'
import {
  createWorkspaceTheme,
  deleteWorkspace,
  deleteWorkspaceTheme,
  getWorkspace,
  getWorkspaceTheme,
  listUserWorkspaces,
  listWorkspaces,
  listWorkspaceThemes,
  updateWorkspace,
  updateWorkspaceTheme
} from '@/server/workspace/service'
import {
  exportWorkspaceUserActivity,
  getUserActivityGraph,
  getUserIssueCompletedGraph,
  getUserLastProjectWithWorkspace,
  getUserWorkspaceDashboard,
  getWorkspaceUserActivity,
  getWorkspaceUserProfile,
  getWorkspaceUserProfileIssues,
  getWorkspaceUserProfileStats,
  getWorkspaceUserProperties,
  updateWorkspaceUserProperties
} from '@/server/workspace/user'
import type { ApiEnv } from '@/types/api/schema'
import {
  createWorkspaceInputSchema,
  createWorkspaceThemeSchema,
  monthQuerySchema,
  recentVisitQuerySchema,
  recordRecentVisitSchema,
  updateWorkspaceInputSchema,
  updateWorkspaceMemberInputSchema,
  updateWorkspaceThemeSchema,
  updateWorkspaceUserPropertiesSchema,
  workspaceActivityExportSchema,
  workspaceFieldsQuerySchema,
  workspaceListQuerySchema,
  workspaceMemberIdSchema,
  workspaceMemberListQuerySchema,
  workspaceMemberViewsSchema,
  workspaceUserActivityQuerySchema,
  workspaceUserIssuesQuerySchema,
  workspaceUserStatsQuerySchema
} from '@/types/workspace/schema'

const num = (value: string) => parseInput(workspaceMemberIdSchema, value)

export const workspacesRoutes = new Hono<ApiEnv>()
workspacesRoutes.use('*', authenticate)
workspacesRoutes.get(apiV1Routes.workspacesRoot, async c =>
  c.json(await listWorkspaces(getDb(), c.get('actor'), parseInput(workspaceListQuerySchema, c.req.query())))
)
workspacesRoutes.post(apiV1Routes.workspacesRoot, async c =>
  c.json(
    await createWorkspaceWithSeed(getDb(), c.get('actor'), await readJson(c, createWorkspaceInputSchema), workspaceId =>
      enqueueWorkspaceSeed(workspaceId)
    ),
    201
  )
)
// Registered before the `:slug` routes so they are not captured as a slug.
workspacesRoutes.post(paths.workspaceMemberLeave, async c => {
  await leaveWorkspaceMember(getDb(), c.get('actor'), c.req.param('slug'))
  return c.body(null, 204)
})
workspacesRoutes.get(apiV1Routes.workspace, async c =>
  c.json(await getWorkspace(getDb(), c.get('actor'), c.req.param('slug')))
)
// PUT and PATCH share one handler (WorkSpaceViewSet.update and partial_update).
workspacesRoutes.on(['PATCH', 'PUT'], apiV1Routes.workspace, async c =>
  c.json(
    await updateWorkspace(getDb(), c.get('actor'), c.req.param('slug'), await readJson(c, updateWorkspaceInputSchema))
  )
)
workspacesRoutes.delete(apiV1Routes.workspace, async c => {
  await deleteWorkspace(getDb(), c.get('actor'), c.req.param('slug'))
  return c.body(null, 204)
})

workspacesRoutes.get(apiV1Routes.workspaceMembers, async c => {
  const query = parseInput(workspaceMemberListQuerySchema, c.req.query())
  return c.json(await listWorkspaceMembers(getDb(), c.get('actor'), c.req.param('slug'), query.search))
})
workspacesRoutes.get(paths.workspaceMembersLite, async c =>
  c.json(
    await listWorkspaceMembersLite(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      parseInput(workspaceMemberListQuerySchema, c.req.query())
    )
  )
)
workspacesRoutes.get(paths.workspaceMemberMe, async c =>
  c.json(await getWorkspaceMemberUser(getDb(), c.get('actor'), c.req.param('slug')))
)
workspacesRoutes.post(paths.workspaceMemberViews, async c => {
  const input = await readJson(c, workspaceMemberViewsSchema)
  await createWorkspaceMemberUserViews(getDb(), c.get('actor'), c.req.param('slug'), input.view_props)
  return c.body(null, 204)
})
workspacesRoutes.get(paths.workspaceProjectMembers, async c =>
  c.json(await getWorkspaceProjectMember(getDb(), c.get('actor'), c.req.param('slug')))
)
workspacesRoutes.get(apiV1Routes.workspaceMember, async c =>
  c.json(await getWorkspaceMember(getDb(), c.get('actor'), c.req.param('slug'), num(c.req.param('memberId'))))
)
workspacesRoutes.patch(apiV1Routes.workspaceMember, async c => {
  const input = await readJson(c, updateWorkspaceMemberInputSchema)
  return c.json(
    await updateWorkspaceMember(getDb(), c.get('actor'), c.req.param('slug'), num(c.req.param('memberId')), input.role)
  )
})
workspacesRoutes.delete(apiV1Routes.workspaceMember, async c => {
  await removeWorkspaceMember(getDb(), c.get('actor'), c.req.param('slug'), num(c.req.param('memberId')))
  return c.body(null, 204)
})

workspacesRoutes.get(paths.workspaceThemes, async c =>
  c.json(await listWorkspaceThemes(getDb(), c.get('actor'), c.req.param('slug')))
)
workspacesRoutes.post(paths.workspaceThemes, async c =>
  c.json(
    await createWorkspaceTheme(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      await readJson(c, createWorkspaceThemeSchema)
    ),
    201
  )
)
workspacesRoutes.get(paths.workspaceTheme, async c =>
  c.json(await getWorkspaceTheme(getDb(), c.get('actor'), c.req.param('slug'), num(c.req.param('themeId'))))
)
workspacesRoutes.patch(paths.workspaceTheme, async c =>
  c.json(
    await updateWorkspaceTheme(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      num(c.req.param('themeId')),
      await readJson(c, updateWorkspaceThemeSchema)
    )
  )
)
workspacesRoutes.delete(paths.workspaceTheme, async c => {
  await deleteWorkspaceTheme(getDb(), c.get('actor'), c.req.param('slug'), num(c.req.param('themeId')))
  return c.body(null, 204)
})

workspacesRoutes.get(paths.workspaceRecentVisits, async c =>
  c.json(
    await listUserRecentVisits(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      parseInput(recentVisitQuerySchema, c.req.query()).entity_name
    )
  )
)
workspacesRoutes.post(paths.workspaceRecentVisits, async c =>
  c.json(
    await createRecentVisit(getDb(), c.get('actor'), c.req.param('slug'), await readJson(c, recordRecentVisitSchema))
  )
)

workspacesRoutes.get(paths.workspaceUserProperties, async c =>
  c.json(await getWorkspaceUserProperties(getDb(), c.get('actor'), c.req.param('slug')))
)
workspacesRoutes.patch(paths.workspaceUserProperties, async c =>
  c.json(
    await updateWorkspaceUserProperties(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      await readJson(c, updateWorkspaceUserPropertiesSchema)
    )
  )
)
workspacesRoutes.get(paths.workspaceUserProfile, async c =>
  c.json(await getWorkspaceUserProfile(getDb(), c.get('actor'), c.req.param('slug'), num(c.req.param('userId'))))
)
workspacesRoutes.get(paths.workspaceUserIssues, async c =>
  c.json(
    await getWorkspaceUserProfileIssues(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      num(c.req.param('userId')),
      parseInput(workspaceUserIssuesQuerySchema, c.req.query())
    )
  )
)
workspacesRoutes.get(paths.workspaceUserStats, async c =>
  c.json(
    await getWorkspaceUserProfileStats(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      num(c.req.param('userId')),
      parseInput(workspaceUserStatsQuerySchema, c.req.query())
    )
  )
)
workspacesRoutes.get(paths.workspaceUserActivity, async c =>
  c.json(
    await getWorkspaceUserActivity(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      num(c.req.param('userId')),
      parseInput(workspaceUserActivityQuerySchema, c.req.query())
    )
  )
)
workspacesRoutes.post(paths.workspaceUserActivityExport, async c => {
  const { date } = await readJson(c, workspaceActivityExportSchema)
  const csv = await exportWorkspaceUserActivity(
    getDb(),
    c.get('actor'),
    c.req.param('slug'),
    num(c.req.param('userId')),
    date
  )
  return c.body(csv, 200, {
    'Content-Type': 'text/csv',
    'Content-Disposition': 'attachment; filename="workspace-user-activity.csv"'
  })
})

/** Routes mounted at linkto.users: /users/me/workspaces and /users/last-visited-workspace. */
export const workspaceUserRoutes = new Hono<ApiEnv>({ strict: false })
workspaceUserRoutes.get(paths.userWorkspaces, authenticate, async c => {
  const { fields } = parseInput(workspaceFieldsQuerySchema, c.req.query())
  return c.json(
    await listUserWorkspaces(getDb(), c.get('actor'), parseInput(workspaceListQuerySchema, c.req.query()), fields)
  )
})
workspaceUserRoutes.get(paths.userWorkspaceDashboard, authenticate, async c =>
  c.json(
    await getUserWorkspaceDashboard(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      parseInput(monthQuerySchema, c.req.query()).month
    )
  )
)
workspaceUserRoutes.get(paths.userActivityGraph, authenticate, async c =>
  c.json(await getUserActivityGraph(getDb(), c.get('actor'), c.req.param('slug')))
)
workspaceUserRoutes.get(paths.userIssuesCompletedGraph, authenticate, async c =>
  c.json(
    await getUserIssueCompletedGraph(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      parseInput(monthQuerySchema, c.req.query()).month
    )
  )
)
workspaceUserRoutes.get(paths.lastVisitedWorkspace, authenticate, async c =>
  c.json(await getUserLastProjectWithWorkspace(getDb(), c.get('actor')))
)
