import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import {
  analyticViews,
  emailNotificationLogs,
  issueViews,
  notifications,
  stickies,
  userFavorites,
  userNotificationPreferences,
  userRecentVisits
} from '@/db/schema/notification'
import { jsonValueSchema } from '@/types/database/schema'

const issueViewFields = {
  query: () => jsonValueSchema,
  access: () => z.literal([0, 1]),
  filters: () => jsonValueSchema,
  displayFilters: () => jsonValueSchema,
  displayProperties: () => jsonValueSchema,
  logoProps: () => jsonValueSchema,
  richFilters: () => jsonValueSchema
}
export const issueViewSchema = createSelectSchema(issueViews, issueViewFields).strict()
export const issueViewInsertSchema = createInsertSchema(issueViews, issueViewFields).omit({ id: true }).strict()
export type IssueView = z.infer<typeof issueViewSchema>
export type IssueViewInsert = z.infer<typeof issueViewInsertSchema>

const analyticViewFields = {
  query: () => jsonValueSchema,
  queryDict: () => jsonValueSchema
}
export const analyticViewSchema = createSelectSchema(analyticViews, analyticViewFields).strict()
export const analyticViewInsertSchema = createInsertSchema(analyticViews, analyticViewFields)
  .omit({ id: true })
  .strict()
export type AnalyticView = z.infer<typeof analyticViewSchema>
export type AnalyticViewInsert = z.infer<typeof analyticViewInsertSchema>

export const userFavoriteSchema = createSelectSchema(userFavorites).strict()
export const userFavoriteInsertSchema = createInsertSchema(userFavorites).omit({ id: true }).strict()
export type UserFavorite = z.infer<typeof userFavoriteSchema>
export type UserFavoriteInsert = z.infer<typeof userFavoriteInsertSchema>

export const userRecentVisitSchema = createSelectSchema(userRecentVisits).strict()
export const userRecentVisitInsertSchema = createInsertSchema(userRecentVisits).omit({ id: true }).strict()
export type UserRecentVisit = z.infer<typeof userRecentVisitSchema>
export type UserRecentVisitInsert = z.infer<typeof userRecentVisitInsertSchema>

const stickieFields = {
  description: () => jsonValueSchema,
  logoProps: () => jsonValueSchema
}
export const stickieSchema = createSelectSchema(stickies, stickieFields).strict()
export const stickieInsertSchema = createInsertSchema(stickies, stickieFields).omit({ id: true }).strict()
export type Stickie = z.infer<typeof stickieSchema>
export type StickieInsert = z.infer<typeof stickieInsertSchema>

const notificationFields = {
  data: () => jsonValueSchema,
  message: () => jsonValueSchema
}
export const notificationSchema = createSelectSchema(notifications, notificationFields).strict()
export const notificationInsertSchema = createInsertSchema(notifications, notificationFields)
  .omit({ id: true })
  .strict()
export type Notification = z.infer<typeof notificationSchema>
export type NotificationInsert = z.infer<typeof notificationInsertSchema>

export const userNotificationPreferenceSchema = createSelectSchema(userNotificationPreferences).strict()
export const userNotificationPreferenceInsertSchema = createInsertSchema(userNotificationPreferences)
  .omit({ id: true })
  .strict()
export type UserNotificationPreference = z.infer<typeof userNotificationPreferenceSchema>
export type UserNotificationPreferenceInsert = z.infer<typeof userNotificationPreferenceInsertSchema>

const emailNotificationLogFields = {
  data: () => jsonValueSchema
}
export const emailNotificationLogSchema = createSelectSchema(emailNotificationLogs, emailNotificationLogFields).strict()
export const emailNotificationLogInsertSchema = createInsertSchema(emailNotificationLogs, emailNotificationLogFields)
  .omit({ id: true })
  .strict()
export type EmailNotificationLog = z.infer<typeof emailNotificationLogSchema>
export type EmailNotificationLogInsert = z.infer<typeof emailNotificationLogInsertSchema>

const queryBoolean = z.enum(['true', 'false']).transform(value => value === 'true')
export const notificationListQuerySchema = z
  .object({
    snoozed: queryBoolean.default(false),
    archived: queryBoolean.default(false),
    read: queryBoolean.optional(),
    mentioned: queryBoolean.default(false),
    type: z
      .string()
      .default('all')
      .transform(value => value.split(','))
      .refine(
        values =>
          values.length > 0 && values.every(value => ['all', 'subscribed', 'assigned', 'created'].includes(value))
      )
  })
  .strip()
export const notificationSnoozeSchema = z
  .object({
    snoozed_till: z.iso
      .datetime({ offset: true })
      .transform(value => new Date(value))
      .nullable()
  })
  .strict()
export const notificationMarkAllSchema = z
  .object({
    snoozed: z.boolean().default(false),
    archived: z.boolean().default(false),
    type: z.enum(['all', 'watching', 'assigned', 'created']).default('all')
  })
  .strict()
export const notificationPreferencesUpdateSchema = z
  .object({
    property_change: z.boolean().optional(),
    state_change: z.boolean().optional(),
    comment: z.boolean().optional(),
    mention: z.boolean().optional(),
    issue_completed: z.boolean().optional()
  })
  .strict()
  .refine(value => Object.keys(value).length > 0)
export type NotificationListQuery = z.output<typeof notificationListQuerySchema>
export type NotificationMarkAll = z.output<typeof notificationMarkAllSchema>
export type NotificationPreferencesUpdate = z.output<typeof notificationPreferencesUpdateSchema>
