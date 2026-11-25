import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import {
  deployBoards,
  descriptionVersions,
  descriptions,
  fileAssets,
  pageLabels,
  pageLogs,
  pageVersions,
  pages,
  projectDeployBoards,
  projectPages,
  projectPublicMembers
} from '@/db/schema/content'
import { jsonValueSchema } from '@/types/database/schema'

const pageFields = {
  access: () => z.literal([0, 1]),
  archivedAt: () => z.iso.date(),
  viewProps: () => jsonValueSchema,
  logoProps: () => jsonValueSchema,
  descriptionJson: () => jsonValueSchema
}
export const pageSchema = createSelectSchema(pages, pageFields).strict()
export const pageInsertSchema = createInsertSchema(pages, pageFields).omit({ id: true }).strict()
export type Page = z.infer<typeof pageSchema>
export type PageInsert = z.infer<typeof pageInsertSchema>

export const pageLabelSchema = createSelectSchema(pageLabels).strict()
export const pageLabelInsertSchema = createInsertSchema(pageLabels).omit({ id: true }).strict()
export type PageLabel = z.infer<typeof pageLabelSchema>
export type PageLabelInsert = z.infer<typeof pageLabelInsertSchema>

export const projectPageSchema = createSelectSchema(projectPages).strict()
export const projectPageInsertSchema = createInsertSchema(projectPages).omit({ id: true }).strict()
export type ProjectPage = z.infer<typeof projectPageSchema>
export type ProjectPageInsert = z.infer<typeof projectPageInsertSchema>

const pageLogFields = {
  transaction: () => z.uuid()
}
export const pageLogSchema = createSelectSchema(pageLogs, pageLogFields).strict()
export const pageLogInsertSchema = createInsertSchema(pageLogs, pageLogFields).omit({ id: true }).strict()
export type PageLog = z.infer<typeof pageLogSchema>
export type PageLogInsert = z.infer<typeof pageLogInsertSchema>

const pageVersionFields = {
  descriptionJson: () => jsonValueSchema,
  subPagesData: () => jsonValueSchema
}
export const pageVersionSchema = createSelectSchema(pageVersions, pageVersionFields).strict()
export const pageVersionInsertSchema = createInsertSchema(pageVersions, pageVersionFields).omit({ id: true }).strict()
export type PageVersion = z.infer<typeof pageVersionSchema>
export type PageVersionInsert = z.infer<typeof pageVersionInsertSchema>

const descriptionFields = {
  descriptionJson: () => jsonValueSchema
}
export const descriptionSchema = createSelectSchema(descriptions, descriptionFields).strict()
export const descriptionInsertSchema = createInsertSchema(descriptions, descriptionFields).omit({ id: true }).strict()
export type Description = z.infer<typeof descriptionSchema>
export type DescriptionInsert = z.infer<typeof descriptionInsertSchema>

const descriptionVersionFields = {
  descriptionJson: () => jsonValueSchema
}
export const descriptionVersionSchema = createSelectSchema(descriptionVersions, descriptionVersionFields).strict()
export const descriptionVersionInsertSchema = createInsertSchema(descriptionVersions, descriptionVersionFields)
  .omit({ id: true })
  .strict()
export type DescriptionVersion = z.infer<typeof descriptionVersionSchema>
export type DescriptionVersionInsert = z.infer<typeof descriptionVersionInsertSchema>

const fileAssetFields = {
  attributes: () => jsonValueSchema,
  storageMetadata: () => jsonValueSchema
}
export const fileAssetSchema = createSelectSchema(fileAssets, fileAssetFields).strict()
export const fileAssetInsertSchema = createInsertSchema(fileAssets, fileAssetFields).omit({ id: true }).strict()
export type FileAsset = z.infer<typeof fileAssetSchema>
export type FileAssetInsert = z.infer<typeof fileAssetInsertSchema>

const deployBoardFields = {
  viewProps: () => jsonValueSchema
}
export const deployBoardSchema = createSelectSchema(deployBoards, deployBoardFields).strict()
export const deployBoardInsertSchema = createInsertSchema(deployBoards, deployBoardFields).omit({ id: true }).strict()
export type DeployBoard = z.infer<typeof deployBoardSchema>
export type DeployBoardInsert = z.infer<typeof deployBoardInsertSchema>

const projectDeployBoardFields = {
  views: () => jsonValueSchema
}
export const projectDeployBoardSchema = createSelectSchema(projectDeployBoards, projectDeployBoardFields).strict()
export const projectDeployBoardInsertSchema = createInsertSchema(projectDeployBoards, projectDeployBoardFields)
  .omit({ id: true })
  .strict()
export type ProjectDeployBoard = z.infer<typeof projectDeployBoardSchema>
export type ProjectDeployBoardInsert = z.infer<typeof projectDeployBoardInsertSchema>

export const projectPublicMemberSchema = createSelectSchema(projectPublicMembers).strict()
export const projectPublicMemberInsertSchema = createInsertSchema(projectPublicMembers).omit({ id: true }).strict()
export type ProjectPublicMember = z.infer<typeof projectPublicMemberSchema>
export type ProjectPublicMemberInsert = z.infer<typeof projectPublicMemberInsertSchema>

export const contentIdSchema = z.coerce.number().int().positive().safe()
export const pageLiveActionSchema = z.enum(['view', 'edit'])
export const publicBoardAnchorSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9_-]+$/)
export const publicationCommentsSchema = z.object({ is_comments_enabled: z.boolean() }).strict()
export type PageLiveAction = z.infer<typeof pageLiveActionSchema>
export type PageFormState = { error?: string; success?: boolean }
export const createPageInputSchema = z
  .object({
    name: z.string().trim().max(255).default(''),
    descriptionText: z.string().max(200000).default(''),
    access: z.literal([0, 1]).default(0)
  })
  .strict()
export const updatePageInputSchema = z
  .object({
    name: z.string().trim().max(255).optional(),
    descriptionText: z.string().max(200000).optional(),
    access: z.literal([0, 1]).optional()
  })
  .strict()
  .refine(value => Object.keys(value).length > 0)
export type CreatePageInput = z.infer<typeof createPageInputSchema>
export type UpdatePageInput = z.infer<typeof updatePageInputSchema>
export type ContentWorkerEnv = { ASSET_BUCKET?: R2Bucket }
