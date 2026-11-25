import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { changelogs, instanceAdmins, instanceConfigurations, instances } from '@/db/schema/instance'
import { jsonValueSchema } from '@/types/database/schema'

export const instanceSchema = createSelectSchema(instances).strict()
export const instanceInsertSchema = createInsertSchema(instances).omit({ id: true }).strict()
export type Instance = z.infer<typeof instanceSchema>
export type InstanceInsert = z.infer<typeof instanceInsertSchema>

const instanceAdminFields = {
  role: () => z.literal([20])
}
export const instanceAdminSchema = createSelectSchema(instanceAdmins, instanceAdminFields).strict()
export const instanceAdminInsertSchema = createInsertSchema(instanceAdmins, instanceAdminFields)
  .omit({ id: true })
  .strict()
export type InstanceAdmin = z.infer<typeof instanceAdminSchema>
export type InstanceAdminInsert = z.infer<typeof instanceAdminInsertSchema>

export const instanceConfigurationSchema = createSelectSchema(instanceConfigurations).strict()
export const instanceConfigurationInsertSchema = createInsertSchema(instanceConfigurations).omit({ id: true }).strict()
export type InstanceConfiguration = z.infer<typeof instanceConfigurationSchema>
export type InstanceConfigurationInsert = z.infer<typeof instanceConfigurationInsertSchema>

const changelogFields = {
  tags: () => jsonValueSchema
}
export const changelogSchema = createSelectSchema(changelogs, changelogFields).strict()
export const changelogInsertSchema = createInsertSchema(changelogs, changelogFields).omit({ id: true }).strict()
export type Changelog = z.infer<typeof changelogSchema>
export type ChangelogInsert = z.infer<typeof changelogInsertSchema>

export const instanceAdminIdSchema = z.coerce.number().int().positive().safe()
export const inviteInstanceAdminSchema = z.object({ email: z.email().max(255).toLowerCase() }).strict()
export const updateInstanceInputSchema = z
  .object({
    instanceName: z.string().trim().min(1).max(255).optional()
  })
  .strict()
  .refine(input => Object.keys(input).length > 0)
export const updateInstanceConfigurationSchema = z
  .object({
    DISABLE_WORKSPACE_CREATION: z.literal(['0', '1'])
  })
  .strict()
export type UpdateInstanceInput = z.infer<typeof updateInstanceInputSchema>
