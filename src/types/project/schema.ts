import { z } from 'zod'

// Plane `Project.FORBIDDEN_IDENTIFIER_CHARS_PATTERN` (PD-0353, PD-0354).
const name = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[^&+,:;$^}{*=?@#|'<>.()%!\-]+$/)
const identifier = z
  .string()
  .trim()
  .min(1)
  .max(12)
  .regex(/^[a-zA-Z0-9_]+$/)
  .transform(value => value.toUpperCase())
const id = z.number().int().positive().safe()
const jsonObject = z.record(z.string(), z.json())
const role = z.literal([5, 15, 20])

export const projectIdSchema = z.coerce.number().int().positive().safe()
/** PD-0353 `validate_name` and PD-0354 `validate_identifier`: format rules. Uniqueness is checked in the service. */
export const projectValidateName = name
export const projectValidateIdentifier = identifier

const projectFields = {
  description: z.string().max(10000).optional(),
  descriptionHtml: jsonObject.nullable().optional(),
  network: z.literal([0, 2]),
  projectLeadId: id.nullable().optional(),
  defaultAssigneeId: id.nullable().optional(),
  emoji: z.string().max(255).nullable().optional(),
  iconProp: jsonObject.nullable().optional(),
  logoProps: jsonObject.optional(),
  coverImage: z.string().max(4000).nullable().optional(),
  moduleView: z.boolean().optional(),
  cycleView: z.boolean().optional(),
  issueViewsView: z.boolean().optional(),
  pageView: z.boolean().optional(),
  intakeView: z.boolean().optional(),
  guestViewAllFeatures: z.boolean().optional(),
  isTimeTrackingEnabled: z.boolean().optional(),
  isIssueTypeEnabled: z.boolean().optional(),
  archiveIn: z.number().int().min(0).max(12).optional(),
  closeIn: z.number().int().min(0).max(12).optional(),
  timezone: z.string().min(1).max(255).optional(),
  externalSource: z.string().max(255).nullable().optional(),
  externalId: z.string().max(255).nullable().optional()
}

/** PD-0355 `ProjectSerializer.validate` and PD-0040 `ProjectCreateSerializer.validate` (shape part). */
export const createProjectSchema = z
  .object({ name, identifier, ...projectFields, network: projectFields.network.default(2) })
  .strict()
export const updateProjectSchema = z
  .object({
    ...projectFields,
    name: name.optional(),
    identifier: identifier.optional(),
    network: projectFields.network.optional(),
    defaultStateId: id.nullable().optional(),
    estimateId: id.nullable().optional()
  })
  .strict()
  .refine(value => Object.keys(value).length > 0)
export const projectInputSchema = createProjectSchema
export const projectCreateApiInputSchema = createProjectSchema
export const projectApiInputSchema = updateProjectSchema

/** Query of the paginated project lists (`cursor`, `per_page`, `order_by`, `fields`, `include_archived`). */
export const projectListQuerySchema = z.object({
  cursor: z.string().optional(),
  per_page: z.coerce.number().int().min(1).max(100).optional(),
  order_by: z.string().optional(),
  fields: z.string().optional(),
  include_archived: z.enum(['true', 'false', '1', '0']).optional()
})
export const projectSummaryQuerySchema = z.object({ fields: z.string().optional() })
export const projectSummaryFields = ['members', 'states', 'labels', 'cycles', 'modules', 'issues', 'intakes', 'pages'] as const
export const projectIdentifierQuerySchema = z.object({ name: z.string().trim().min(1).max(12) })

/** Single member (mobile `memberId`) or Plane's bulk `members` list. */
export const addProjectMemberSchema = z.object({ memberId: id, role }).strict()
export const addProjectMembersSchema = z
  .object({ members: z.array(z.object({ memberId: id, role }).strict()).min(1).max(100) })
  .strict()
/** PD-0032 `validate_member`, PD-0033 `validate_role`, PD-0034 `validate`: public API input. */
export const projectMemberApiValidateMember = id
export const projectMemberApiValidateRole = role
export const projectMemberApiInputSchema = z.object({ member: id, role }).strict()
export const updateProjectMemberSchema = z
  .object({
    role: role.optional(),
    isActive: z.boolean().optional(),
    comment: z.string().max(10000).nullable().optional(),
    viewProps: jsonObject.optional(),
    defaultProps: jsonObject.optional(),
    preferences: jsonObject.optional(),
    sortOrder: z.number().finite().optional()
  })
  .strict()
  .refine(value => Object.keys(value).length > 0)
/** PD-0359: preferences are merged into the stored object. */
export const projectMemberPreferenceValidatePreferences = jsonObject
export const projectUserViewsSchema = z
  .object({
    viewProps: jsonObject.optional(),
    defaultProps: jsonObject.optional(),
    preferences: jsonObject.optional(),
    sortOrder: z.number().finite().optional()
  })
  .strict()

export const createProjectInvitationsSchema = z
  .object({
    emails: z
      .array(z.object({ email: z.string().trim().toLowerCase().max(255).pipe(z.email()), role: role.default(5) }).strict())
      .min(1)
      .max(100)
  })
  .strict()
export const respondProjectInvitationSchema = z.object({ token: z.string().min(1).max(255), accepted: z.boolean() }).strict()
export const joinProjectsSchema = z.object({ projectIds: z.array(id).max(100) }).strict()

const views = z
  .object({
    list: z.boolean(),
    kanban: z.boolean(),
    calendar: z.boolean(),
    gantt: z.boolean(),
    spreadsheet: z.boolean()
  })
  .strict()
export const createDeployBoardSchema = z
  .object({
    isCommentsEnabled: z.boolean().default(false),
    isReactionsEnabled: z.boolean().default(false),
    isVotesEnabled: z.boolean().default(false),
    intakeId: id.nullable().default(null),
    views: views.default({ list: true, kanban: true, calendar: true, gantt: true, spreadsheet: true })
  })
  .strict()
export const updateDeployBoardSchema = z
  .object({
    isCommentsEnabled: z.boolean().optional(),
    isReactionsEnabled: z.boolean().optional(),
    isVotesEnabled: z.boolean().optional(),
    isActivityEnabled: z.boolean().optional(),
    intakeId: id.nullable().optional(),
    views: views.optional()
  })
  .strict()
  .refine(value => Object.keys(value).length > 0)
export const favoriteProjectSchema = z.object({ project: id }).strict()

export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>
export type CreateDeployBoardInput = z.infer<typeof createDeployBoardSchema>
export type UpdateDeployBoardInput = z.infer<typeof updateDeployBoardSchema>
export type UpdateProjectMemberInput = z.infer<typeof updateProjectMemberSchema>
export type ProjectUserViewsInput = z.infer<typeof projectUserViewsSchema>
export type CreateProjectInvitationsInput = z.infer<typeof createProjectInvitationsSchema>
export type ProjectRole = 5 | 15 | 20
export type ProjectActionState = { error?: string; success?: boolean }
