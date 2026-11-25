import { Hono } from 'hono'
import { methodNotAllowed } from 'hono/method-not-allowed'
import { apiV1Routes, linkto } from '@/data/linkto'
import { getDb } from '@/db/client'
import { handleApiError, handleNotFound } from '@/server/api/v1/errors'
import { authenticate, privateNoStore, requestLogger } from '@/server/api/v1/middleware'
import {
  type CorsEnv,
  corsTrustedOrigins,
  createApiCors,
  createProtectCookieWrites
} from '@/server/api/v1/request-security'
import { analyticsRoutes, workspaceAnalyticsRoutes } from '@/server/api/v1/routes/analytics'
import { apiTokensRoutes } from '@/server/api/v1/routes/api-tokens'
import { assetsRoutes, userAssetsRoutes } from '@/server/api/v1/routes/assets'
import { authExtraRoutes } from '@/server/api/v1/routes/auth-extra'
import { cyclesRoutes, workspaceCyclesRoutes } from '@/server/api/v1/routes/cycles'
import { draftsRoutes, draftsWorkspaceRoutes } from '@/server/api/v1/routes/drafts'
import { estimatesRoutes, workspaceEstimatesRoutes } from '@/server/api/v1/routes/estimates'
import { exportsRoutes, workspaceExportsRoutes } from '@/server/api/v1/routes/exports'
import { importsRoutes } from '@/server/api/v1/routes/imports'
import { instancesRoutes } from '@/server/api/v1/routes/instances'
import { externalToolsRoutes, integrationsRoutes, projectIntegrationsRoutes } from '@/server/api/v1/routes/integrations'
import { intakesRoutes } from '@/server/api/v1/routes/intakes'
import { issueCollabRoutes } from '@/server/api/v1/routes/issue-collab'
import { issuesRoutes, issuesWorkspaceRoutes } from '@/server/api/v1/routes/issues'
import { liveRoutes } from '@/server/api/v1/routes/live'
import { maintenanceRoutes } from '@/server/api/v1/routes/maintenance'
import { modulesRoutes, workspaceModulesRoutes } from '@/server/api/v1/routes/modules'
import { notificationPreferencesRoutes, notificationsRoutes } from '@/server/api/v1/routes/notifications'
import { pagesRoutes } from '@/server/api/v1/routes/pages'
import { pdfRoutes } from '@/server/api/v1/routes/pdf'
import { projectJoinPublicRoutes, projectsRoutes, projectUserRoutes } from '@/server/api/v1/routes/projects'
import { projectPublicationRoutes, publicRoutes } from '@/server/api/v1/routes/public'
import { projectSearchRoutes, workspaceSearchRoutes } from '@/server/api/v1/routes/search'
import { stickiesRoutes } from '@/server/api/v1/routes/stickies'
import { usersRoutes } from '@/server/api/v1/routes/users'
import { projectViewsRoutes, viewsRoutes, workspaceViewIssuesRoutes } from '@/server/api/v1/routes/views'
import {
  userWorkspaceInvitationsRoutes,
  workspaceInvitationsRoutes,
  workspaceJoinRoutes
} from '@/server/api/v1/routes/workspace-invitations'
import { workspacePreferencesRoutes } from '@/server/api/v1/routes/workspace-preferences'
import { workspacesRoutes, workspaceUserRoutes } from '@/server/api/v1/routes/workspaces'
import { getTimezones } from '@/server/api/v1/timezones'
import { getEnv } from '@/server/common/env'
import { anonRateLimit, apiKeyRateLimit } from '@/server/common/rate-limit'
import { readReplicaRouting } from '@/server/common/request-scope'
import { checkWorkspaceSlug } from '@/server/workspace/service'
import type { ApiEnv } from '@/types/api/schema'

export const app = new Hono<ApiEnv>({ strict: false }).basePath(linkto.apiV1)

app.onError(handleApiError)
const corsEnv = () => getEnv() as CorsEnv
// CORS goes first so preflight requests are answered before any other middleware. `X-API-Key` throttling (Plane
// ApiKeyRateThrottle) runs before authentication, so invalid keys are throttled too.
app.use(
  '*',
  createApiCors(corsEnv),
  requestLogger,
  readReplicaRouting,
  privateNoStore,
  createProtectCookieWrites(() => corsTrustedOrigins(corsEnv())),
  apiKeyRateLimit()
)
app.use(
  methodNotAllowed({
    app,
    onMethodNotAllowed: (context, methods) => {
      const headers = { Allow: [...methods, 'OPTIONS'].join(', ') }
      if (context.req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
      return Response.json(
        { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } },
        {
          status: 405,
          headers
        }
      )
    }
  })
)
app.notFound(handleNotFound)

// Anonymous endpoints that create sessions: Plane AnonRateThrottle (30/minute per IP). The auth-extra routes and the
// public board routes carry their own limiters (AUTHENTICATION_RATE_LIMIT, PUBLIC_ANON_RATE_LIMIT).
app.use(`${linkto.apiInstances}${apiV1Routes.instanceAdminSignIn}`, anonRateLimit())
app.use(`${linkto.apiInstances}${apiV1Routes.instanceAdminSignUp}`, anonRateLimit())

app.get(apiV1Routes.root, c => c.json({ status: 'OK' }))
app.get(apiV1Routes.health, c => c.json({ status: 'OK' }))
app.get(apiV1Routes.timezones, c => c.json(getTimezones()))
app.get(apiV1Routes.workspaceSlugCheck, authenticate, async c =>
  c.json(await checkWorkspaceSlug(getDb(), c.req.query('slug')))
)

// ---- Routers without a session requirement. Mount them before any router that calls `use('*', authenticate)`
// on an overlapping prefix: Hono runs middleware in registration order, so a later public route would get a 401.
app.route(linkto.apiAuthExtra, authExtraRoutes) // /auth/*: config, email-check, magic link, password flows
// Live: the socket authenticates itself and the server-to-server routes use the `live-server-secret-key` header.
app.route(linkto.apiLive, liveRoutes) // /live/health, /collaboration, /convert-document, /force-close
app.route(linkto.apiAssets, userAssetsRoutes) // /assets/static/:assetId is public, other routes authenticate per route
app.route(linkto.workspaces, workspaceJoinRoutes) // GET /:slug/invitations/:invitationId/join (public)
app.route(linkto.workspaces, projectJoinPublicRoutes) // GET /:slug/projects/:projectId/join/:invitationId (public)

// ---- Current user. `userWorkspaceInvitationsRoutes` (/me/workspaces/invitations) goes before `workspaceUserRoutes`
// (/me/workspaces/:slug/...) so the literal segment wins.
app.route(linkto.users, usersRoutes)
app.route(linkto.users, apiTokensRoutes)
app.route(linkto.users, notificationPreferencesRoutes)
app.route(linkto.users, userWorkspaceInvitationsRoutes)
app.route(linkto.users, workspaceUserRoutes)
app.route(linkto.users, projectUserRoutes)

// ---- Workspaces (`/workspaces/:slug/...` written with a `:slug` segment in the router paths)
app.route(linkto.workspaces, workspacesRoutes)
app.route(linkto.workspaces, workspaceInvitationsRoutes)
app.route(linkto.workspaces, workspacePreferencesRoutes)
app.route(linkto.workspaces, projectsRoutes)
app.route(linkto.workspaces, pagesRoutes)
app.route(linkto.workspaces, assetsRoutes)

// ---- Project level (`linkto.apiProject`). `issueCollabRoutes` redefines comments and relations with wider schemas,
// so it must be registered before `issuesRoutes`.
app.route(linkto.apiProject, issueCollabRoutes)
app.route(linkto.apiProject, issuesRoutes)
app.route(linkto.apiProject, cyclesRoutes)
app.route(linkto.apiProject, modulesRoutes)
app.route(linkto.apiProject, estimatesRoutes)
app.route(linkto.apiProject, intakesRoutes)
app.route(linkto.apiProject, draftsRoutes)
app.route(linkto.apiProject, projectViewsRoutes)
app.route(linkto.apiProject, projectSearchRoutes)
app.route(linkto.apiProject, analyticsRoutes)
app.route(linkto.apiProject, exportsRoutes)
app.route(linkto.apiProject, importsRoutes)
app.route(linkto.apiProject, pdfRoutes)
app.route(linkto.apiProject, projectIntegrationsRoutes)
app.route(linkto.apiProject, projectPublicationRoutes)

// ---- Workspace level (`linkto.apiWorkspace`). `/issues/search` is declared before `/issues/:identifier` inside
// `issuesWorkspaceRoutes`; the view list at `/issues` has a different path, so the order between them is free.
app.route(linkto.apiWorkspace, issuesWorkspaceRoutes)
app.route(linkto.apiWorkspace, workspaceViewIssuesRoutes)
app.route(linkto.apiWorkspace, stickiesRoutes)
app.route(linkto.apiWorkspace, notificationsRoutes)
app.route(linkto.apiWorkspace, viewsRoutes)
app.route(linkto.apiWorkspace, workspaceSearchRoutes)
app.route(linkto.apiWorkspace, integrationsRoutes)
app.route(linkto.apiWorkspace, workspaceCyclesRoutes)
app.route(linkto.apiWorkspace, workspaceModulesRoutes)
app.route(linkto.apiWorkspace, workspaceEstimatesRoutes)
app.route(linkto.apiWorkspace, draftsWorkspaceRoutes)
app.route(linkto.apiWorkspace, workspaceAnalyticsRoutes)
app.route(linkto.apiWorkspace, workspaceExportsRoutes)

// ---- External tools (per-route authentication, so mounting at the root does not affect other routers)
app.route('/', externalToolsRoutes) // GET /unsplash

// ---- Public boards, instance and maintenance. Maintenance goes before instances so `/instances/maintenance/*`
// is never read as an instance sub-path.
app.route(linkto.apiPublic, publicRoutes)
app.route(linkto.apiMaintenance, maintenanceRoutes)
app.route(linkto.apiInstances, instancesRoutes)
