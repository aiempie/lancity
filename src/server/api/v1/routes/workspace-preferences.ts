import { Hono } from 'hono'
import { apiV1Routes } from '@/data/linkto'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import {
  createWorkspaceFavorite,
  deleteWorkspaceFavorite,
  listWorkspaceFavorites,
  updateWorkspaceFavorite
} from '@/server/workspace/favorite'
import { getWorkspaceHomePreference, updateWorkspaceHomePreference } from '@/server/workspace/home'
import {
  createQuickLink,
  deleteQuickLink,
  getQuickLink,
  listQuickLinks,
  updateQuickLink
} from '@/server/workspace/quick-link'
import { workspaceApiRoutes as paths } from '@/server/workspace/routes'
import { getWorkspaceUserPreferences, updateWorkspaceUserPreferences } from '@/server/workspace/user-preference'
import type { ApiEnv } from '@/types/api/schema'
import {
  createQuickLinkSchema,
  createWorkspaceFavoriteSchema,
  updateQuickLinkSchema,
  updateWorkspaceFavoriteSchema,
  updateWorkspaceHomePreferenceSchema,
  updateWorkspacePreferencesSchema,
  workspaceMemberIdSchema
} from '@/types/workspace/schema'
export const workspacePreferencesRoutes = new Hono<ApiEnv>()
workspacePreferencesRoutes.use('*', authenticate)
workspacePreferencesRoutes.get(apiV1Routes.workspacePreferences, async c =>
  c.json(await getWorkspaceUserPreferences(getDb(), c.get('actor'), c.req.param('slug')))
)
workspacePreferencesRoutes.patch(apiV1Routes.workspacePreferences, async c =>
  c.json(
    await updateWorkspaceUserPreferences(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      await readJson(c, updateWorkspacePreferencesSchema)
    )
  )
)
workspacePreferencesRoutes.get(apiV1Routes.workspaceQuickLinks, async c =>
  c.json(await listQuickLinks(getDb(), c.get('actor'), c.req.param('slug')))
)
workspacePreferencesRoutes.post(apiV1Routes.workspaceQuickLinks, async c =>
  c.json(
    await createQuickLink(getDb(), c.get('actor'), c.req.param('slug'), await readJson(c, createQuickLinkSchema)),
    201
  )
)
workspacePreferencesRoutes.get(apiV1Routes.workspaceQuickLink, async c =>
  c.json(
    await getQuickLink(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      parseInput(workspaceMemberIdSchema, c.req.param('linkId'))
    )
  )
)
workspacePreferencesRoutes.patch(apiV1Routes.workspaceQuickLink, async c =>
  c.json(
    await updateQuickLink(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      parseInput(workspaceMemberIdSchema, c.req.param('linkId')),
      await readJson(c, updateQuickLinkSchema)
    )
  )
)
workspacePreferencesRoutes.delete(apiV1Routes.workspaceQuickLink, async c => {
  await deleteQuickLink(
    getDb(),
    c.get('actor'),
    c.req.param('slug'),
    parseInput(workspaceMemberIdSchema, c.req.param('linkId'))
  )
  return c.body(null, 204)
})
workspacePreferencesRoutes.get(apiV1Routes.workspaceFavorites, async c =>
  c.json(await listWorkspaceFavorites(getDb(), c.get('actor'), c.req.param('slug')))
)
workspacePreferencesRoutes.post(apiV1Routes.workspaceFavorites, async c =>
  c.json(
    await createWorkspaceFavorite(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      await readJson(c, createWorkspaceFavoriteSchema)
    )
  )
)
workspacePreferencesRoutes.get(apiV1Routes.workspaceFavoriteGroup, async c =>
  c.json(
    await listWorkspaceFavorites(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      parseInput(workspaceMemberIdSchema, c.req.param('favoriteId'))
    )
  )
)
workspacePreferencesRoutes.patch(apiV1Routes.workspaceFavorite, async c =>
  c.json(
    await updateWorkspaceFavorite(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      parseInput(workspaceMemberIdSchema, c.req.param('favoriteId')),
      await readJson(c, updateWorkspaceFavoriteSchema)
    )
  )
)
workspacePreferencesRoutes.delete(apiV1Routes.workspaceFavorite, async c => {
  await deleteWorkspaceFavorite(
    getDb(),
    c.get('actor'),
    c.req.param('slug'),
    parseInput(workspaceMemberIdSchema, c.req.param('favoriteId'))
  )
  return c.body(null, 204)
})
workspacePreferencesRoutes.get(paths.workspaceHomePreferences, async c =>
  c.json(await getWorkspaceHomePreference(getDb(), c.get('actor'), c.req.param('slug')))
)
workspacePreferencesRoutes.patch(paths.workspaceHomePreference, async c =>
  c.json(
    await updateWorkspaceHomePreference(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      c.req.param('key'),
      await readJson(c, updateWorkspaceHomePreferenceSchema)
    )
  )
)
