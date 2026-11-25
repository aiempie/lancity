import { z } from 'zod'
import { containsUrl } from '@/server/common/url'
import { restrictedWorkspaceSlugs } from '@/types/workspace/schema'

const email = z.string().trim().toLowerCase().pipe(z.email().max(255))

/** PD-1531 `WorkspaceSerializer.validate_name`: no URL and at least one letter or number. */
export const instanceWorkspaceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(value => !containsUrl(value), 'Name must not contain URLs')
  .refine(value => /[\p{L}\p{N}]/u.test(value), 'Name must contain at least one letter or number')

/** PD-1532 `WorkspaceSerializer.validate_slug`: not reserved. Uniqueness (case-insensitive) is checked by the service. */
export const instanceWorkspaceSlugSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-zA-Z0-9_-]+$/)
  .refine(value => !restrictedWorkspaceSlugs.has(value), 'Slug is not valid')

export const createInstanceWorkspaceSchema = z
  .object({ name: instanceWorkspaceNameSchema, slug: instanceWorkspaceSlugSchema, company_role: z.string().max(255).optional() })
  .strict()
export type CreateInstanceWorkspaceInput = z.infer<typeof createInstanceWorkspaceSchema>

export const instanceWorkspaceQuerySchema = z.object({ search: z.string().max(255).optional() })
export const instanceWorkspaceSlugQuerySchema = z.object({ slug: z.string().min(1).max(48) })

/** PD-1536 form fields of `InstanceAdminSignUpEndpoint` sent as JSON. */
export const instanceAdminSignUpSchema = z
  .object({
    email,
    password: z.string().min(1).max(128),
    first_name: z.string().trim().min(1).max(255),
    last_name: z.string().trim().max(255).default(''),
    company_name: z.string().trim().max(255).default(''),
    is_telemetry_enabled: z.boolean().default(true)
  })
  .strict()
export type InstanceAdminSignUpInput = z.infer<typeof instanceAdminSignUpSchema>

/** PD-1537 form fields of `InstanceAdminSignInEndpoint`. */
export const instanceAdminSignInSchema = z.object({ email, password: z.string().min(1).max(128) }).strict()
export type InstanceAdminSignInInput = z.infer<typeof instanceAdminSignInSchema>

/** PD-1553 `InstanceSerializer` writable fields (`id`, `email`, `last_checked_at`, `is_setup_done` are read-only). */
export const updateInstanceDetailsSchema = z
  .object({
    instanceName: z.string().trim().min(1).max(255).optional(),
    isTelemetryEnabled: z.boolean().optional(),
    isSupportRequired: z.boolean().optional(),
    whitelistEmails: z.string().max(10_000).nullable().optional(),
    domain: z.string().max(255).optional()
  })
  .strict()
  .refine(input => Object.keys(input).length > 0, 'No changes supplied')
export type UpdateInstanceDetailsInput = z.infer<typeof updateInstanceDetailsSchema>

/** PD-1548 body: any `KEY: value` pairs; unknown keys are ignored like Plane's `key__in` filter. */
export const updateInstanceConfigurationValuesSchema = z
  .record(z.string().min(1).max(100), z.union([z.string().max(10_000), z.number(), z.boolean(), z.null()]))
  .refine(input => Object.keys(input).length > 0, 'No changes supplied')
export type UpdateInstanceConfigurationValues = z.infer<typeof updateInstanceConfigurationValuesSchema>

export const emailCredentialCheckSchema = z.object({ receiver_email: email }).strict()
