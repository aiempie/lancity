import { z } from 'zod'

const email = z.string('invalidEmail').trim().toLowerCase().pipe(z.email('invalidEmail'))
const username = z
  .string('invalidUsername')
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.]{3,30}$/, 'invalidUsername')
const password = z.string('requiredPassword').min(8, 'shortPassword').max(128, 'longPassword')

export const loginSchema = z.object({
  identifier: z.union([email, username], { error: 'invalidIdentifier' }),
  password: z.string('requiredPassword').min(1, 'requiredPassword').max(128, 'longPassword')
})

export const registerSchema = z.object({
  name: z.string('requiredName').trim().min(1, 'requiredName').max(100, 'longName'),
  username,
  email,
  password
})

export type AuthFormMode = 'login' | 'register'

export type AuthWorkerEnv = {
  DB: D1Database
  BETTER_AUTH_SECRET?: string
  BETTER_AUTH_URL?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  GITLAB_CLIENT_ID?: string
  GITLAB_CLIENT_SECRET?: string
  GITLAB_HOST?: string
  GITEA_CLIENT_ID?: string
  GITEA_CLIENT_SECRET?: string
  GITEA_HOST?: string
  GITHUB_ORGANIZATION_ID?: string
  AUTHENTICATION_RATE_LIMIT?: string
}

/** Identity established by a verified Better Auth session. */
export type Actor = { userId: number }

export const sessionUserIdSchema = z.union([
  z.number().int().positive().safe(),
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().positive().safe())
])

/** Social providers Plane supports; Better Auth ids (`gitea` goes through the generic OAuth plugin). */
export const oauthProviderIds = ['google', 'github', 'gitlab', 'gitea'] as const
export type OauthProviderId = (typeof oauthProviderIds)[number]

const planeEmail = z.string().trim().toLowerCase().pipe(z.email())

/** PD-0362/PD-0363 `validate_first_name` / `validate_last_name`: no URLs or domains in names. */
export const personNameSchema = z
  .string()
  .max(255)
  .refine(
    value => !/(?:https?:\/\/|www\.|(?:[a-z0-9-]+\.)+[a-z]{2,6}\b|(?:\d{1,3}\.){3}\d{1,3}\b)/i.test(value),
    'Name cannot contain a URL'
  )

/** PD-0365/PD-0366: avatar and cover assets are referenced by serial asset ID (ownership is checked in the service). */
export const ownAssetIdSchema = z.number().int().positive().safe().nullable()
export const avatarAssetSchema = z.object({ avatar_asset: ownAssetIdSchema }).strict()
export const coverImageAssetSchema = z.object({ cover_image_asset: ownAssetIdSchema }).strict()

export const emailCheckSchema = z.object({ email: z.string('EMAIL_REQUIRED').min(1, 'EMAIL_REQUIRED') }).strict()
export const magicGenerateSchema = z.object({ email: z.string().min(1) }).strict()
export const magicSignInSchema = z
  .object({ email: z.string().trim().min(1), code: z.string().trim().min(1), next_path: z.string().max(2048).optional() })
  .strict()
export const forgotPasswordSchema = z.object({ email: z.string().min(1) }).strict()
export const resetPasswordSchema = z.object({ token: z.string().min(1), password: z.string().min(1).max(128) }).strict()
/** PD-0369 `ChangePasswordSerializer.validate`: old password is required unless the password was auto-set. */
export const changePasswordSchema = z
  .object({ old_password: z.string().max(128).optional(), new_password: z.string().min(1).max(128) })
  .strict()
export const setPasswordSchema = z.object({ password: z.string().min(1).max(128) }).strict()
export const generateEmailVerificationCodeSchema = z.object({ email: planeEmail }).strict()
export const updateEmailSchema = z.object({ email: planeEmail, code: z.string().trim().min(1).max(32) }).strict()
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
