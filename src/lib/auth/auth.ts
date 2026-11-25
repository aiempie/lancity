import { env } from 'cloudflare:workers'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { emailOTP, genericOAuth, username } from 'better-auth/plugins'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { getTranslations } from 'next-intl/server'
import { linkto } from '@/data/linkto'
import { getErrorMessage } from '@/data/i18n/config'
import { getDb } from '@/db/client'
import { account } from '@/db/schema/auth'
import * as schema from '@/db/schema/auth'
import { userSecurity } from '@/db/schema/ext-p1-auth'
import { workspaceMemberInvites } from '@/db/schema/workspace'
import { giteaConfig, githubOptions, gitlabOptions } from '@/lib/auth/providers'
import { queueAuthMail } from '@/server/identity/jobs'
import { AUTHENTICATION_ERROR_CODES, type AuthenticationErrorName } from '@/server/identity/errors'
import { forgotPasswordEmail, magicCodeEmail } from '@/server/identity/emails'
import { getDisplayName } from '@/server/identity/model-rules'
import { postUserAuthWorkflow, provisionUser, recordLogin } from '@/server/identity/onboarding'
import { isPasswordStrong } from '@/server/identity/password'
import { envAuthSettings, loadAuthSettings, type AuthSettings } from '@/server/identity/settings'
import { clientIp, incrementCounter, parseRate, throttleAllows } from '@/server/identity/throttle'
import { registerSchema, sessionUserIdSchema, type AuthWorkerEnv } from '@/types/auth/schema'
import { authCookiePrefix } from './cookies'

const bindings = env as unknown as AuthWorkerEnv & Record<string, unknown>

/** Plane `MagicCodeProvider` limits: 8-digit code, 10 minute lifetime, 5 verify attempts, 4 issued codes per window. */
const MAGIC_CODE_TTL_SECONDS = 600
const MAGIC_MAX_VERIFY_ATTEMPTS = 5
const MAGIC_MAX_CODES_PER_WINDOW = 4
const RESET_TOKEN_TTL_SECONDS = 3600

export function isGoogleEnabled(settings: AuthSettings = envAuthSettings(bindings)) {
  return settings.google.enabled
}

/** Providers usable on the sign-in screen (env-configured and enabled). */
export function enabledProviders(settings: AuthSettings = envAuthSettings(bindings)) {
  return (['google', 'github', 'gitlab', 'gitea'] as const).filter(id => settings[id].enabled)
}

const throttledPaths = new Set([
  '/sign-in/email',
  '/sign-in/username',
  '/sign-in/email-otp',
  '/sign-up/email',
  '/email-otp/send-verification-otp',
  '/request-password-reset',
  '/reset-password',
  '/change-password',
  '/verify-password'
])
const passwordStrengthFields: Record<string, string> = {
  '/sign-up/email': 'password',
  '/reset-password': 'newPassword',
  '/change-password': 'newPassword'
}

function denied(name: AuthenticationErrorName): never {
  throw new APIError('BAD_REQUEST', { message: name, code: name, error_code: AUTHENTICATION_ERROR_CODES[name] })
}

function randomCode(): string {
  // 8 digits like Plane `secrets.randbelow(90000000) + 10000000`, without modulo bias.
  const limit = Math.floor(0x100000000 / 90000000) * 90000000
  const buffer = new Uint32Array(1)
  do crypto.getRandomValues(buffer)
  while (buffer[0] >= limit)
  return String((buffer[0] % 90000000) + 10000000)
}

export function createAuth(settings: AuthSettings = envAuthSettings(bindings)) {
  const secret = bindings.BETTER_AUTH_SECRET
  const baseURL = bindings.BETTER_AUTH_URL

  if (!secret || secret.length < 32 || !baseURL) {
    throw new Error('Configure BETTER_AUTH_SECRET (32+ characters) and BETTER_AUTH_URL on the Worker')
  }

  const socialProviders = {
    ...(settings.google.enabled ? { google: { clientId: settings.google.clientId!, clientSecret: settings.google.clientSecret!, overrideUserInfoOnSignIn: settings.google.sync } } : {}),
    ...(settings.github.enabled ? { github: githubOptions(settings.github) } : {}),
    ...(settings.gitlab.enabled ? { gitlab: gitlabOptions(settings.gitlab) } : {})
  }

  return betterAuth({
    appName: 'Lancity',
    basePath: linkto.authApi,
    baseURL,
    secret,
    database: drizzleAdapter(drizzle(bindings.DB, { schema }), {
      provider: 'sqlite',
      schema,
      transaction: false
    }),
    advanced: {
      cookiePrefix: authCookiePrefix,
      database: { generateId: 'serial' },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] }
    },
    rateLimit: { enabled: true },
    emailAndPassword: {
      enabled: true,
      resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
      revokeSessionsOnPasswordReset: true,
      // PD-1136 `forgot_password` task. Always responds the same whether or not the address exists.
      sendResetPassword: async ({ user, url }) => {
        await queueAuthMail(user.email, forgotPasswordEmail(user.name || null, url))
      }
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await queueAuthMail(user.email, {
          subject: 'Verify your Lancity email address',
          html: `<p>Confirm your email address:</p><p><a href="${url.replace(/"/g, '&quot;')}">Verify email</a></p>`,
          text: `Confirm your email address: ${url}`
        })
      }
    },
    socialProviders,
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false
      }
    },
    plugins: [
      username(),
      // PD-0994..0999, PD-1045..1047 magic code: Better Auth stores a hashed code in `verification`.
      emailOTP({
        otpLength: 8,
        expiresIn: MAGIC_CODE_TTL_SECONDS,
        allowedAttempts: MAGIC_MAX_VERIFY_ATTEMPTS,
        storeOTP: 'hashed',
        generateOTP: () => randomCode(),
        sendVerificationOTP: async ({ email, otp }) => {
          await queueAuthMail(email, magicCodeEmail(otp))
        }
      }),
      ...(settings.gitea.enabled ? [genericOAuth({ config: [giteaConfig(settings.gitea)] })] : [])
    ],
    databaseHooks: {
      user: {
        create: {
          // PD-0966 `__check_signup` + PD-1499 `User.save` normalisation.
          before: async user => {
            const email = user.email.toLowerCase().trim()
            const instance = await loadAuthSettings(getDb(), bindings)
            if (!instance.signupEnabled) {
              const [invite] = await getDb().select({ id: workspaceMemberInvites.id }).from(workspaceMemberInvites).where(eq(workspaceMemberInvites.email, email)).limit(1)
              if (!invite) denied('SIGNUP_DISABLED')
            }
            return { data: { ...user, email, name: user.name?.trim() || getDisplayName(email) } }
          },
          after: async user => {
            const id = sessionUserIdSchema.safeParse(user.id)
            if (id.success) await provisionUser(id.data, { passwordAutoset: false })
          }
        }
      },
      session: {
        create: {
          // PD-0973 `complete_login_or_signup`: deactivated accounts and bots cannot sign in by any method.
          before: async session => {
            const [row] = await getDb().select().from(userSecurity).where(eq(userSecurity.userId, Number(session.userId))).limit(1)
            if (row?.isBot) denied('BOT_USER_LOGIN_FORBIDDEN')
            if (row && !row.isActive && row.lastLogoutTime) denied('USER_ACCOUNT_DEACTIVATED')
          }
        }
      }
    },
    hooks: {
      before: createAuthMiddleware(async ctx => {
        const ip = ctx.headers?.get('cf-connecting-ip')
        // PD-1015..1020 AuthenticationThrottle (per IP). Skipped without a Cloudflare IP header (local dev).
        if (ip && throttledPaths.has(ctx.path)) {
          const { limit, windowSeconds } = parseRate(bindings.AUTHENTICATION_RATE_LIMIT)
          if (!(await throttleAllows('authentication', clientIp(ctx.headers!), { limit, windowSeconds }))) {
            throw new APIError('TOO_MANY_REQUESTS', { message: 'RATE_LIMIT_EXCEEDED', code: 'RATE_LIMIT_EXCEEDED', error_code: 5900 })
          }
        }

        const field = passwordStrengthFields[ctx.path]
        if (field) {
          const value = (ctx.body as Record<string, unknown> | undefined)?.[field]
          if (typeof value === 'string' && !isPasswordStrong(value)) denied('PASSWORD_TOO_WEAK')
        }

        if (['/sign-in/email', '/sign-in/username', '/sign-up/email'].includes(ctx.path)) {
          if (!(await loadAuthSettings(getDb(), bindings)).emailPasswordEnabled) denied('EMAIL_PASSWORD_AUTHENTICATION_DISABLED')
        }

        if (['/sign-in/email-otp', '/email-otp/send-verification-otp'].includes(ctx.path)) {
          const instance = await loadAuthSettings(getDb(), bindings)
          if (!instance.setupDone) denied('INSTANCE_NOT_CONFIGURED')
          if (!instance.smtpConfigured) denied('SMTP_NOT_CONFIGURED')
          if (!instance.magicLinkEnabled) denied('MAGIC_LINK_LOGIN_DISABLED')
          const body = ctx.body as { email?: unknown; type?: unknown } | undefined
          if (ctx.path.endsWith('send-verification-otp') && body?.type === 'sign-in' && typeof body.email === 'string') {
            const issued = await incrementCounter(`magic_${body.email.toLowerCase().trim()}:issued`, MAGIC_CODE_TTL_SECONDS)
            if (issued > MAGIC_MAX_CODES_PER_WINDOW) denied('EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN')
          }
        }

        if (ctx.path === '/sign-in/social' || ctx.path === '/link-social') {
          const provider = (ctx.body as { provider?: string } | undefined)?.provider
          const instance = await loadAuthSettings(getDb(), bindings)
          if (provider === 'google' || provider === 'github' || provider === 'gitlab' || provider === 'gitea') {
            if (!instance[provider].enabled) denied(`${provider.toUpperCase() as 'GOOGLE'}_NOT_CONFIGURED`)
          }
        }

        if (ctx.path !== '/sign-up/email') return

        const result = registerSchema.safeParse(ctx.body)
        if (!result.success) {
          const t = await getTranslations('errors')
          const message = getErrorMessage(t, result.error.issues[0].message)
          throw new APIError('BAD_REQUEST', { message })
        }

        return { context: { body: { ...ctx.body, ...result.data } } }
      }),
      after: createAuthMiddleware(async ctx => {
        const session = ctx.context.newSession
        if (!session) return
        const id = sessionUserIdSchema.safeParse(session.user.id)
        if (!id.success) return
        const db = getDb()
        try {
          // PD-0970 `save_user_data` + `user_login`: record the login; a user without a password account is "auto-set".
          const [credential] = await db.select({ id: account.id }).from(account).where(and(eq(account.userId, id.data), eq(account.providerId, 'credential'))).limit(1)
          const medium = ctx.path.includes('email-otp') ? 'magic-code' : ctx.path.includes('callback') ? (ctx.params?.id ?? 'oauth') : 'email'
          await recordLogin(id.data, { medium, ip: ctx.headers ? clientIp(ctx.headers) : undefined, userAgent: ctx.headers?.get('user-agent') })
          await db.update(userSecurity).set({ isPasswordAutoset: !credential }).where(eq(userSecurity.userId, id.data))
          // PD-1032 `post_user_auth_workflow`.
          await postUserAuthWorkflow(id.data, db)
        } catch (error) {
          // Authentication already succeeded; retry accepted invitations on the next sign-in.
          console.error('Unable to complete post-login workflow', error)
        }
      })
    }
  })
}
