import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import {
  cycleIssues,
  cycleUserProperties,
  cycles,
  draftIssueAssignees,
  draftIssueCycles,
  draftIssueLabels,
  draftIssueModules,
  draftIssues,
  estimatePoints,
  estimates,
  intakeIssues,
  intakes,
  issueTypes,
  moduleIssues,
  moduleLinks,
  moduleMembers,
  moduleUserProperties,
  modules,
  projectIssueTypes
} from '@/db/schema/planning'
import { jsonValueSchema } from '@/types/database/schema'

const cycleFields = {
  viewProps: () => jsonValueSchema,
  progressSnapshot: () => jsonValueSchema,
  logoProps: () => jsonValueSchema
}
export const cycleSchema = createSelectSchema(cycles, cycleFields).strict()
export const cycleInsertSchema = createInsertSchema(cycles, cycleFields).omit({ id: true }).strict()
export type Cycle = z.infer<typeof cycleSchema>
export type CycleInsert = z.infer<typeof cycleInsertSchema>

export const cycleIssueSchema = createSelectSchema(cycleIssues).strict()
export const cycleIssueInsertSchema = createInsertSchema(cycleIssues).omit({ id: true }).strict()
export type CycleIssue = z.infer<typeof cycleIssueSchema>
export type CycleIssueInsert = z.infer<typeof cycleIssueInsertSchema>

const cycleUserPropertyFields = {
  filters: () => jsonValueSchema,
  displayFilters: () => jsonValueSchema,
  displayProperties: () => jsonValueSchema,
  richFilters: () => jsonValueSchema
}
export const cycleUserPropertySchema = createSelectSchema(cycleUserProperties, cycleUserPropertyFields).strict()
export const cycleUserPropertyInsertSchema = createInsertSchema(cycleUserProperties, cycleUserPropertyFields)
  .omit({ id: true })
  .strict()
export type CycleUserProperty = z.infer<typeof cycleUserPropertySchema>
export type CycleUserPropertyInsert = z.infer<typeof cycleUserPropertyInsertSchema>

const moduleFields = {
  descriptionText: () => jsonValueSchema,
  descriptionHtml: () => jsonValueSchema,
  startDate: () => z.iso.date(),
  targetDate: () => z.iso.date(),
  viewProps: () => jsonValueSchema,
  logoProps: () => jsonValueSchema
}
export const moduleSchema = createSelectSchema(modules, moduleFields).strict()
export const moduleInsertSchema = createInsertSchema(modules, moduleFields).omit({ id: true }).strict()
export type Module = z.infer<typeof moduleSchema>
export type ModuleInsert = z.infer<typeof moduleInsertSchema>

export const moduleMemberSchema = createSelectSchema(moduleMembers).strict()
export const moduleMemberInsertSchema = createInsertSchema(moduleMembers).omit({ id: true }).strict()
export type ModuleMember = z.infer<typeof moduleMemberSchema>
export type ModuleMemberInsert = z.infer<typeof moduleMemberInsertSchema>

export const moduleIssueSchema = createSelectSchema(moduleIssues).strict()
export const moduleIssueInsertSchema = createInsertSchema(moduleIssues).omit({ id: true }).strict()
export type ModuleIssue = z.infer<typeof moduleIssueSchema>
export type ModuleIssueInsert = z.infer<typeof moduleIssueInsertSchema>

const moduleLinkFields = {
  metadata: () => jsonValueSchema
}
export const moduleLinkSchema = createSelectSchema(moduleLinks, moduleLinkFields).strict()
export const moduleLinkInsertSchema = createInsertSchema(moduleLinks, moduleLinkFields).omit({ id: true }).strict()
export type ModuleLink = z.infer<typeof moduleLinkSchema>
export type ModuleLinkInsert = z.infer<typeof moduleLinkInsertSchema>

const moduleUserPropertyFields = {
  filters: () => jsonValueSchema,
  displayFilters: () => jsonValueSchema,
  displayProperties: () => jsonValueSchema,
  richFilters: () => jsonValueSchema
}
export const moduleUserPropertySchema = createSelectSchema(moduleUserProperties, moduleUserPropertyFields).strict()
export const moduleUserPropertyInsertSchema = createInsertSchema(moduleUserProperties, moduleUserPropertyFields)
  .omit({ id: true })
  .strict()
export type ModuleUserProperty = z.infer<typeof moduleUserPropertySchema>
export type ModuleUserPropertyInsert = z.infer<typeof moduleUserPropertyInsertSchema>

export const estimateSchema = createSelectSchema(estimates).strict()
export const estimateInsertSchema = createInsertSchema(estimates).omit({ id: true }).strict()
export type Estimate = z.infer<typeof estimateSchema>
export type EstimateInsert = z.infer<typeof estimateInsertSchema>

export const estimatePointSchema = createSelectSchema(estimatePoints).strict()
export const estimatePointInsertSchema = createInsertSchema(estimatePoints).omit({ id: true }).strict()
export type EstimatePoint = z.infer<typeof estimatePointSchema>
export type EstimatePointInsert = z.infer<typeof estimatePointInsertSchema>

const issueTypeFields = {
  logoProps: () => jsonValueSchema
}
export const issueTypeSchema = createSelectSchema(issueTypes, issueTypeFields).strict()
export const issueTypeInsertSchema = createInsertSchema(issueTypes, issueTypeFields).omit({ id: true }).strict()
export type IssueType = z.infer<typeof issueTypeSchema>
export type IssueTypeInsert = z.infer<typeof issueTypeInsertSchema>

const projectIssueTypeFields = {
  level: (schema: z.ZodNumber) => schema.gte(0)
}
export const projectIssueTypeSchema = createSelectSchema(projectIssueTypes, projectIssueTypeFields).strict()
export const projectIssueTypeInsertSchema = createInsertSchema(projectIssueTypes, projectIssueTypeFields)
  .omit({ id: true })
  .strict()
export type ProjectIssueType = z.infer<typeof projectIssueTypeSchema>
export type ProjectIssueTypeInsert = z.infer<typeof projectIssueTypeInsertSchema>

const intakeFields = {
  viewProps: () => jsonValueSchema,
  logoProps: () => jsonValueSchema
}
export const intakeSchema = createSelectSchema(intakes, intakeFields).strict()
export const intakeInsertSchema = createInsertSchema(intakes, intakeFields).omit({ id: true }).strict()
export type Intake = z.infer<typeof intakeSchema>
export type IntakeInsert = z.infer<typeof intakeInsertSchema>

const intakeIssueFields = {
  status: () => z.literal([-2, -1, 0, 1, 2]),
  extra: () => jsonValueSchema
}
export const intakeIssueSchema = createSelectSchema(intakeIssues, intakeIssueFields).strict()
export const intakeIssueInsertSchema = createInsertSchema(intakeIssues, intakeIssueFields).omit({ id: true }).strict()
export type IntakeIssue = z.infer<typeof intakeIssueSchema>
export type IntakeIssueInsert = z.infer<typeof intakeIssueInsertSchema>

const draftIssueFields = {
  startDate: () => z.iso.date(),
  targetDate: () => z.iso.date(),
  descriptionJson: () => jsonValueSchema
}
export const draftIssueSchema = createSelectSchema(draftIssues, draftIssueFields).strict()
export const draftIssueInsertSchema = createInsertSchema(draftIssues, draftIssueFields).omit({ id: true }).strict()
export type DraftIssue = z.infer<typeof draftIssueSchema>
export type DraftIssueInsert = z.infer<typeof draftIssueInsertSchema>

export const draftIssueAssigneeSchema = createSelectSchema(draftIssueAssignees).strict()
export const draftIssueAssigneeInsertSchema = createInsertSchema(draftIssueAssignees).omit({ id: true }).strict()
export type DraftIssueAssignee = z.infer<typeof draftIssueAssigneeSchema>
export type DraftIssueAssigneeInsert = z.infer<typeof draftIssueAssigneeInsertSchema>

export const draftIssueLabelSchema = createSelectSchema(draftIssueLabels).strict()
export const draftIssueLabelInsertSchema = createInsertSchema(draftIssueLabels).omit({ id: true }).strict()
export type DraftIssueLabel = z.infer<typeof draftIssueLabelSchema>
export type DraftIssueLabelInsert = z.infer<typeof draftIssueLabelInsertSchema>

export const draftIssueModuleSchema = createSelectSchema(draftIssueModules).strict()
export const draftIssueModuleInsertSchema = createInsertSchema(draftIssueModules).omit({ id: true }).strict()
export type DraftIssueModule = z.infer<typeof draftIssueModuleSchema>
export type DraftIssueModuleInsert = z.infer<typeof draftIssueModuleInsertSchema>

export const draftIssueCycleSchema = createSelectSchema(draftIssueCycles).strict()
export const draftIssueCycleInsertSchema = createInsertSchema(draftIssueCycles).omit({ id: true }).strict()
export type DraftIssueCycle = z.infer<typeof draftIssueCycleSchema>
export type DraftIssueCycleInsert = z.infer<typeof draftIssueCycleInsertSchema>

// Request payloads are deliberately narrower than the database insert schemas.
export const planningIdSchema = z.coerce.number().int().positive().safe()
const planningDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })]).transform(value => new Date(value))
export const createCycleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    description: z.string().optional(),
    start_date: planningDate.nullable().optional(),
    end_date: planningDate.nullable().optional(),
    timezone: z.string().min(1).max(255).optional()
  })
  .strict()
  .refine(x => Boolean(x.start_date) === Boolean(x.end_date), 'Both cycle dates must be supplied together')
  .refine(x => !x.start_date || !x.end_date || x.start_date <= x.end_date, 'End date must be after start date')
export const updateCycleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().optional(),
    start_date: planningDate.nullable().optional(),
    end_date: planningDate.nullable().optional(),
    timezone: z.string().min(1).max(255).optional()
  })
  .strict()
  .refine(x => Object.keys(x).length > 0, 'No changes supplied')
export const createModuleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    description: z.string().optional(),
    start_date: z.iso.date().nullable().optional(),
    target_date: z.iso.date().nullable().optional(),
    status: z.enum(['backlog', 'planned', 'in-progress', 'paused', 'completed', 'cancelled']).optional()
  })
  .strict()
  .refine(x => !x.start_date || !x.target_date || x.start_date <= x.target_date, 'Target date must be after start date')
export const updateModuleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().optional(),
    start_date: z.iso.date().nullable().optional(),
    target_date: z.iso.date().nullable().optional(),
    status: z.enum(['backlog', 'planned', 'in-progress', 'paused', 'completed', 'cancelled']).optional()
  })
  .strict()
  .refine(x => Object.keys(x).length > 0, 'No changes supplied')
export const planningIssuesInputSchema = z
  .object({ issues: z.array(z.number().int().positive().safe()).min(1).max(100) })
  .strict()
export type CreateCycleInput = z.output<typeof createCycleInputSchema>
export type UpdateCycleInput = z.output<typeof updateCycleInputSchema>
export type CreateModuleInput = z.output<typeof createModuleInputSchema>
export type UpdateModuleInput = z.output<typeof updateModuleInputSchema>

export const estimatePointInputSchema = z
  .object({
    key: z.number().int().min(0).default(0),
    value: z.string().min(1).max(20),
    description: z.string().default('')
  })
  .strict()
export const createEstimateInputSchema = z
  .object({
    estimate: z
      .object({
        name: z.string().trim().min(1).max(255),
        description: z.string().default(''),
        type: z.enum(['categories', 'points']).default('categories'),
        last_used: z.boolean().default(false)
      })
      .strict(),
    estimate_points: z.array(estimatePointInputSchema).max(100).default([])
  })
  .strict()
export const updateEstimateInputSchema = z
  .object({ name: z.string().trim().min(1).max(255).optional(), description: z.string().optional() })
  .strict()
  .refine(x => Object.keys(x).length > 0)
export const createIntakeInputSchema = z
  .object({ name: z.string().trim().min(1).max(255), description: z.string().default('') })
  .strict()
export const updateIntakeInputSchema = z
  .object({ name: z.string().trim().min(1).max(255).optional(), description: z.string().optional() })
  .strict()
  .refine(x => Object.keys(x).length > 0)
export const createDraftInputSchema = z
  .object({
    name: z.string().trim().max(255).nullable().optional(),
    description_html: z.string().optional(),
    priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']).optional()
  })
  .strict()
export const updateDraftInputSchema = createDraftInputSchema.refine(x => Object.keys(x).length > 0)
export type CreateEstimateInput = z.output<typeof createEstimateInputSchema>
export type UpdateEstimateInput = z.output<typeof updateEstimateInputSchema>
export type CreateIntakeInput = z.output<typeof createIntakeInputSchema>
export type UpdateIntakeInput = z.output<typeof updateIntakeInputSchema>
export type DraftInput = z.output<typeof createDraftInputSchema>
export const estimatePointsInputSchema = z
  .union([
    z.array(estimatePointInputSchema).min(1).max(100),
    z.object({ estimate_points: z.array(estimatePointInputSchema).min(1).max(100) }).strict()
  ])
  .transform(value => (Array.isArray(value) ? value : value.estimate_points))
export const updateEstimatePointInputSchema = z
  .object({
    key: z.number().int().min(0).optional(),
    value: z.string().min(1).max(20).optional(),
    description: z.string().optional()
  })
  .strict()
  .refine(value => Object.keys(value).length > 0)
export type EstimatePointInput = z.output<typeof estimatePointInputSchema>
export type UpdateEstimatePointInput = z.output<typeof updateEstimatePointInputSchema>

export const transferCycleIssuesInputSchema = z.object({ new_cycle_id: z.number().int().positive().safe() }).strict()
