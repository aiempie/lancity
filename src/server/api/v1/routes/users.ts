import { Hono } from 'hono'
import { z } from 'zod'
import { apiV1Routes } from '@/data/linkto'
import { getActor } from '@/lib/auth/server-session'
import { authenticate } from '@/server/api/v1/middleware'
import { ServiceError } from '@/server/common/errors'
import { readJson } from '@/server/api/v1/validation'
import { clientIp } from '@/server/identity/throttle'
import { deactivateUser, deleteAccount, generateEmailVerificationCodeUser, getUserActivity, updateEmailUser } from '@/server/identity/account'
import {
  getAccount,
  getAccounts,
  getCurrentUser,
  getUserSession,
  getProfile,
  retrieveInstanceAdminUser,
  retrieveUserSettings,
  updateProfile,
  updateUser,
  updateUserOnBoarded,
  updateUserTourCompleted
} from '@/server/identity/service'
import type { ApiEnv } from '@/types/api/schema'
import {
  onboardSchema,
  tourCompletedSchema,
  updateCurrentUserSchema,
  updateProfileSchema
} from '@/types/identity/schema'

export const usersRoutes = new Hono<ApiEnv>({ strict: false })

// Plane-only sub-paths that have no key in linkto yet (see handoff), derived from existing keys.
const { currentUserEmail, currentUserEmailCode, currentUserActivities, currentUserAccount } = apiV1Routes

function parseId(raw: string): number {
  const id = Number(raw)
  if (!Number.isSafeInteger(id) || id < 1) throw new ServiceError(404, 'NOT_FOUND', 'Not found')
  return id
}

usersRoutes.get(apiV1Routes.userSession, async c => c.json(await getUserSession(await getActor(c.req.raw.headers))))
usersRoutes.get(apiV1Routes.currentUser, authenticate, async c => c.json(await getCurrentUser(c.get('actor'))))
usersRoutes.patch(apiV1Routes.currentUser, authenticate, async c =>
  c.json(await updateUser(c.get('actor'), await readJson(c, updateCurrentUserSchema)))
)
usersRoutes.get(apiV1Routes.currentUserSettings, authenticate, async c =>
  c.json(await retrieveUserSettings(c.get('actor')))
)
usersRoutes.get(apiV1Routes.currentUserInstanceAdmin, authenticate, async c =>
  c.json(await retrieveInstanceAdminUser(c.get('actor')))
)
usersRoutes.get(apiV1Routes.currentUserProfile, authenticate, async c => c.json(await getProfile(c.get('actor'))))
usersRoutes.patch(apiV1Routes.currentUserProfile, authenticate, async c =>
  c.json(await updateProfile(c.get('actor'), await readJson(c, updateProfileSchema)))
)
usersRoutes.patch(apiV1Routes.currentUserOnboard, authenticate, async c =>
  c.json(await updateUserOnBoarded(c.get('actor'), (await readJson(c, onboardSchema)).is_onboarded))
)
usersRoutes.patch(apiV1Routes.currentUserTour, authenticate, async c =>
  c.json(await updateUserTourCompleted(c.get('actor'), (await readJson(c, tourCompletedSchema)).is_tour_completed))
)
usersRoutes.get(apiV1Routes.currentUserAccounts, authenticate, async c => c.json(await getAccounts(c.get('actor'))))
usersRoutes.get(currentUserAccount, authenticate, async c => c.json(await getAccount(c.get('actor'), parseId(c.req.param('accountId')))))
usersRoutes.delete(currentUserAccount, authenticate, async c => {
  await deleteAccount(c.get('actor'), parseId(c.req.param('accountId')))
  return c.body(null, 204)
})
usersRoutes.delete(apiV1Routes.currentUser, authenticate, async c => {
  await deactivateUser(c.get('actor'), { ip: clientIp(c.req.raw.headers) })
  return c.body(null, 204)
})
usersRoutes.post(currentUserEmailCode, authenticate, async c =>
  c.json(await generateEmailVerificationCodeUser(c.get('actor'), await readJson(c, z.object({ email: z.string() }).strict())))
)
usersRoutes.patch(currentUserEmail, authenticate, async c =>
  c.json(await updateEmailUser(c.get('actor'), await readJson(c, z.object({ email: z.string(), code: z.string() }).strict())))
)
usersRoutes.get(currentUserActivities, authenticate, async c => c.json(await getUserActivity(c.get('actor'), c.req.query())))
