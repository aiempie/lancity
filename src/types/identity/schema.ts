import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { deviceSessions, devices, profiles, socialLoginConnections } from '@/db/schema/identity'
import { personNameSchema } from '@/types/auth/schema'
import { jsonValueSchema } from '@/types/database/schema'

const profileFields = {
  theme: () => jsonValueSchema,
  onboardingStep: () => jsonValueSchema,
  billingAddress: () => jsonValueSchema,
  mobileOnboardingStep: () => jsonValueSchema,
  startOfTheWeek: () => z.literal([0, 1, 2, 3, 4, 5, 6]),
  goals: () => jsonValueSchema,
  productTour: () => jsonValueSchema
}
export const profileSchema = createSelectSchema(profiles, profileFields).strict()
export const profileInsertSchema = createInsertSchema(profiles, profileFields).omit({ id: true }).strict()
export type Profile = z.infer<typeof profileSchema>
export type ProfileInsert = z.infer<typeof profileInsertSchema>

export const deviceSchema = createSelectSchema(devices).strict()
export const deviceInsertSchema = createInsertSchema(devices).omit({ id: true }).strict()
export type Device = z.infer<typeof deviceSchema>
export type DeviceInsert = z.infer<typeof deviceInsertSchema>

export const deviceSessionSchema = createSelectSchema(deviceSessions).strict()
export const deviceSessionInsertSchema = createInsertSchema(deviceSessions).omit({ id: true }).strict()
export type DeviceSession = z.infer<typeof deviceSessionSchema>
export type DeviceSessionInsert = z.infer<typeof deviceSessionInsertSchema>

const socialLoginConnectionFields = {
  tokenData: () => jsonValueSchema,
  extraData: () => jsonValueSchema
}
export const socialLoginConnectionSchema = createSelectSchema(
  socialLoginConnections,
  socialLoginConnectionFields
).strict()
export const socialLoginConnectionInsertSchema = createInsertSchema(socialLoginConnections, socialLoginConnectionFields)
  .omit({ id: true })
  .strict()
export type SocialLoginConnection = z.infer<typeof socialLoginConnectionSchema>
export type SocialLoginConnectionInsert = z.infer<typeof socialLoginConnectionInsertSchema>

const profileName = personNameSchema
export const updateCurrentUserSchema = z
  .object({
    first_name: profileName.nullable().optional(),
    last_name: profileName.nullable().optional(),
    user_timezone: z.string().max(255).nullable().optional(),
    avatar_asset: z.number().int().positive().safe().nullable().optional(),
    cover_image_asset: z.number().int().positive().safe().nullable().optional()
  })
  .strict()
  .refine(value => Object.keys(value).length > 0)

export const updateProfileSchema = z
  .object({
    theme: jsonValueSchema.optional(),
    onboarding_step: jsonValueSchema.optional(),
    use_case: z.string().nullable().optional(),
    role: z.string().max(300).nullable().optional(),
    language: z.string().max(255).optional(),
    is_smooth_cursor_enabled: z.boolean().optional(),
    start_of_the_week: z.number().int().min(0).max(6).optional(),
    is_app_rail_docked: z.boolean().optional(),
    background_color: z.string().max(255).optional(),
    goals: jsonValueSchema.optional(),
    has_marketing_email_consent: z.boolean().optional(),
    is_navigation_tour_completed: z.boolean().optional(),
    is_subscribed_to_changelog: z.boolean().optional(),
    notification_view_mode: z.enum(['full', 'compact']).optional(),
    product_tour: jsonValueSchema.optional()
  })
  .strict()
  .refine(value => Object.keys(value).length > 0)

export const onboardSchema = z.object({ is_onboarded: z.boolean().default(false) }).strict()
export const tourCompletedSchema = z.object({ is_tour_completed: z.boolean().default(false) }).strict()
export type UpdateCurrentUser = z.infer<typeof updateCurrentUserSchema>
export type UpdateProfile = z.infer<typeof updateProfileSchema>
