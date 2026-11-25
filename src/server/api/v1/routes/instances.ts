import { Hono, type Context } from 'hono'
import { apiV1Routes } from '@/data/linkto'
import { getDb } from '@/db/client'
import { getActor } from '@/lib/auth/server-session'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import { getEnv } from '@/server/common/env'
import { enforceAuthThrottle } from '@/server/identity/auth-actions'
import {
  addInstanceAdmin,
  createInstanceAdminSignIn,
  createInstanceAdminSignOut,
  createInstanceAdminSignUp,
  getInstanceAdminUserMe,
  getInstanceAdminUserSession,
  listInstanceAdmins,
  removeInstanceAdmin,
  type AdminSessionResult
} from '@/server/instance/admin'
import {
  createEmailCredentialCheck,
  deleteDisableEmailFeature,
  listInstanceConfigurations,
  updateInstanceConfiguration
} from '@/server/instance/configuration'
import { getInstance, getInstanceInfo, markSignUpScreenVisited, updateInstanceDetails } from '@/server/instance/service'
import { createInstanceWorkspace, getInstanceWorkspace, getInstanceWorkspaceAvailabilityCheck } from '@/server/instance/workspace'
import type { ApiEnv } from '@/types/api/schema'
import {
  createInstanceWorkspaceSchema,
  emailCredentialCheckSchema,
  instanceWorkspaceSlugQuerySchema,
  updateInstanceConfigurationValuesSchema,
  updateInstanceDetailsSchema
} from '@/types/instance/p3-instance-schema'
import { instanceAdminIdSchema, inviteInstanceAdminSchema } from '@/types/instance/schema'

/** Paths without a `linkto` key yet. Move them into `apiV1Routes` when merging (see handoff p3-instance). */
const p3Paths = {
  info: apiV1Routes.instanceInfo,
  adminMe: apiV1Routes.instanceAdminMe,
  adminSession: apiV1Routes.instanceAdminSession,
  adminSignUp: apiV1Routes.instanceAdminSignUp,
  adminSignIn: apiV1Routes.instanceAdminSignIn,
  adminSignOut: apiV1Routes.instanceAdminSignOut,
  signUpScreenVisited: apiV1Routes.instanceSignUpScreenVisited,
  disableEmailFeature: apiV1Routes.instanceDisableEmailFeature,
  emailCredentialsCheck: apiV1Routes.instanceEmailCredentialsCheck,
  workspaceSlugCheck: apiV1Routes.instanceWorkspaceSlugCheck
} as const

export const instancesRoutes = new Hono<ApiEnv>()
const env = () => getEnv() as Record<string, unknown>

function withCookies(c: Context, result: AdminSessionResult) {
  for (const cookie of result.cookies) c.header('Set-Cookie', cookie, { append: true })
  return c.json(result.body)
}

instancesRoutes.get(apiV1Routes.root, async c => c.json(await getInstance(getDb())))
instancesRoutes.patch(apiV1Routes.root, authenticate, async c =>
  c.json(await updateInstanceDetails(getDb(), c.get('actor'), await readJson(c, updateInstanceDetailsSchema)))
)
// Plane `GET /api/instances/` payload (`{ config, instance }`). Public, short private cache like Plane.
instancesRoutes.get(p3Paths.info, async c => {
  c.header('Cache-Control', 'private, max-age=12')
  return c.json(await getInstanceInfo(getDb(), env()))
})

// Admin console session. Registered before `/admins/:adminId`.
instancesRoutes.post(p3Paths.adminSignUp, async c => {
  await enforceAuthThrottle(c.req.raw.headers, env())
  return withCookies(c, await createInstanceAdminSignUp(getDb(), await c.req.json().catch(() => ({})), c.req.raw.headers))
})
instancesRoutes.post(p3Paths.adminSignIn, async c => {
  await enforceAuthThrottle(c.req.raw.headers, env())
  return withCookies(c, await createInstanceAdminSignIn(getDb(), await c.req.json().catch(() => ({})), c.req.raw.headers))
})
instancesRoutes.post(p3Paths.adminSignOut, async c =>
  withCookies(c, await createInstanceAdminSignOut(await getActor(c.req.raw.headers), c.req.raw.headers))
)
instancesRoutes.get(p3Paths.adminMe, authenticate, async c => c.json(await getInstanceAdminUserMe(getDb(), c.get('actor'))))
instancesRoutes.get(p3Paths.adminSession, async c =>
  c.json(await getInstanceAdminUserSession(getDb(), await getActor(c.req.raw.headers)))
)
instancesRoutes.post(p3Paths.signUpScreenVisited, async c => {
  await markSignUpScreenVisited(getDb())
  return c.body(null, 204)
})

instancesRoutes.get(apiV1Routes.instanceAdmins, authenticate, async c =>
  c.json(await listInstanceAdmins(getDb(), c.get('actor')))
)
instancesRoutes.post(apiV1Routes.instanceAdmins, authenticate, async c =>
  c.json(await addInstanceAdmin(getDb(), c.get('actor'), (await readJson(c, inviteInstanceAdminSchema)).email), 201)
)
instancesRoutes.delete(apiV1Routes.instanceAdmin, authenticate, async c => {
  await removeInstanceAdmin(getDb(), c.get('actor'), parseInput(instanceAdminIdSchema, c.req.param('adminId')))
  return c.body(null, 204)
})

instancesRoutes.get(p3Paths.workspaceSlugCheck, authenticate, async c =>
  c.json(
    await getInstanceWorkspaceAvailabilityCheck(
      getDb(),
      c.get('actor'),
      parseInput(instanceWorkspaceSlugQuerySchema.partial(), { slug: c.req.query('slug') }).slug
    )
  )
)
instancesRoutes.get(apiV1Routes.instanceWorkspaces, authenticate, async c =>
  c.json(await getInstanceWorkspace(getDb(), c.get('actor'), new URL(c.req.url).searchParams))
)
instancesRoutes.post(apiV1Routes.instanceWorkspaces, authenticate, async c =>
  c.json(await createInstanceWorkspace(getDb(), c.get('actor'), await readJson(c, createInstanceWorkspaceSchema)), 201)
)

instancesRoutes.get(apiV1Routes.instanceConfigurations, authenticate, async c =>
  c.json(await listInstanceConfigurations(getDb(), c.get('actor')))
)
instancesRoutes.patch(apiV1Routes.instanceConfigurations, authenticate, async c =>
  c.json(await updateInstanceConfiguration(getDb(), c.get('actor'), await readJson(c, updateInstanceConfigurationValuesSchema)))
)
instancesRoutes.delete(p3Paths.disableEmailFeature, authenticate, async c => {
  await deleteDisableEmailFeature(getDb(), c.get('actor'))
  return c.body(null, 200)
})
instancesRoutes.post(p3Paths.emailCredentialsCheck, authenticate, async c =>
  c.json(await createEmailCredentialCheck(getDb(), c.get('actor'), (await readJson(c, emailCredentialCheckSchema)).receiver_email))
)

export default instancesRoutes
