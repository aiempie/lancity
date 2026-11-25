import { Hono } from 'hono'
import {
  changePassword,
  checkEmail,
  enforceAuthThrottle,
  forgotPassword,
  getAuthConfig,
  magicGenerate,
  magicSignIn,
  resetPassword,
  setUserPassword
} from '@/server/identity/auth-actions'
import { authenticate } from '@/server/api/v1/middleware'
import { readJson } from '@/server/api/v1/validation'
import { getEnv } from '@/server/common/env'
import {
  changePasswordSchema,
  emailCheckSchema,
  forgotPasswordSchema,
  magicGenerateSchema,
  magicSignInSchema,
  resetPasswordSchema,
  setPasswordSchema
} from '@/types/auth/schema'
import type { ApiEnv } from '@/types/api/schema'

/**
 * Plane auth endpoints that Better Auth does not provide (`/auth/*` in Plane). Mount at `/auth` under /api/v1.
 * Sign-in, sign-up, sign-out, OAuth initiate/callback stay on Better Auth at `/api/auth/*`.
 * The same routes serve the "spaces" (public) apps: PD-1056..1073 are merged here.
 */
export const authExtraRoutes = new Hono<ApiEnv>({ strict: false })
const env = () => getEnv() as Record<string, unknown>

authExtraRoutes.get('/config', async c => c.json(await getAuthConfig(env())))

authExtraRoutes.post('/email-check', async c => {
  await enforceAuthThrottle(c.req.raw.headers, env())
  return c.json(await checkEmail(await readJson(c, emailCheckSchema), env()))
})
authExtraRoutes.post('/magic-generate', async c => {
  const { email } = await readJson(c, magicGenerateSchema)
  return c.json(await magicGenerate(email, c.req.raw.headers, env()))
})

for (const mode of ['sign-in', 'sign-up'] as const) {
  authExtraRoutes.post(`/magic-${mode}`, async c => {
    const result = await magicSignIn(await readJson(c, magicSignInSchema), mode, c.req.raw.headers)
    for (const cookie of result.cookies) c.header('Set-Cookie', cookie, { append: true })
    return c.json(result.body)
  })
}

authExtraRoutes.post('/forgot-password', async c => {
  const { email } = await readJson(c, forgotPasswordSchema)
  const origin = new URL(c.req.url).origin
  return c.json(await forgotPassword(email, `${origin}/login`, env(), c.req.raw.headers))
})
authExtraRoutes.post('/reset-password', async c => c.json(await resetPassword(await readJson(c, resetPasswordSchema))))
authExtraRoutes.post('/set-password', authenticate, async c =>
  c.json(await setUserPassword(c.get('actor'), (await readJson(c, setPasswordSchema)).password, c.req.raw.headers))
)
authExtraRoutes.post('/change-password', authenticate, async c => {
  const result = await changePassword(c.get('actor'), await readJson(c, changePasswordSchema), c.req.raw.headers)
  for (const cookie of result.cookies) c.header('Set-Cookie', cookie, { append: true })
  return c.json(result.body)
})
