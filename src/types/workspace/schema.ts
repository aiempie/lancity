import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import {
  projectIdentifiers,
  projectMemberInvites,
  projectMembers,
  projectUserProperties,
  projects,
  teams,
  workspaceHomePreferences,
  workspaceMemberInvites,
  workspaceMembers,
  workspaceThemes,
  workspaceUserLinks,
  workspaceUserPreferences,
  workspaceUserProperties,
  workspaces
} from '@/db/schema/workspace'
import { jsonValueSchema } from '@/types/database/schema'

export const workspaceSchema = createSelectSchema(workspaces).strict()
export const workspaceInsertSchema = createInsertSchema(workspaces).omit({ id: true }).strict()
export type Workspace = z.infer<typeof workspaceSchema>
export type WorkspaceInsert = z.infer<typeof workspaceInsertSchema>

const workspaceMemberFields = {
  role: () => z.literal([20, 15, 5]),
  viewProps: () => jsonValueSchema,
  defaultProps: () => jsonValueSchema,
  issueProps: () => jsonValueSchema,
  exploredFeatures: () => jsonValueSchema,
  gettingStartedChecklist: () => jsonValueSchema,
  tips: () => jsonValueSchema
}
export const workspaceMemberSchema = createSelectSchema(workspaceMembers, workspaceMemberFields).strict()
export const workspaceMemberInsertSchema = createInsertSchema(workspaceMembers, workspaceMemberFields)
  .omit({ id: true })
  .strict()
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>
export type WorkspaceMemberInsert = z.infer<typeof workspaceMemberInsertSchema>

const workspaceMemberInviteFields = {
  role: () => z.literal([20, 15, 5])
}
export const workspaceMemberInviteSchema = createSelectSchema(
  workspaceMemberInvites,
  workspaceMemberInviteFields
).strict()
export const workspaceMemberInviteInsertSchema = createInsertSchema(workspaceMemberInvites, workspaceMemberInviteFields)
  .omit({ id: true })
  .strict()
export type WorkspaceMemberInvite = z.infer<typeof workspaceMemberInviteSchema>
export type WorkspaceMemberInviteInsert = z.infer<typeof workspaceMemberInviteInsertSchema>

const teamFields = {
  logoProps: () => jsonValueSchema
}
export const teamSchema = createSelectSchema(teams, teamFields).strict()
export const teamInsertSchema = createInsertSchema(teams, teamFields).omit({ id: true }).strict()
export type Team = z.infer<typeof teamSchema>
export type TeamInsert = z.infer<typeof teamInsertSchema>

const workspaceThemeFields = {
  colors: () => jsonValueSchema
}
export const workspaceThemeSchema = createSelectSchema(workspaceThemes, workspaceThemeFields).strict()
export const workspaceThemeInsertSchema = createInsertSchema(workspaceThemes, workspaceThemeFields)
  .omit({ id: true })
  .strict()
export type WorkspaceTheme = z.infer<typeof workspaceThemeSchema>
export type WorkspaceThemeInsert = z.infer<typeof workspaceThemeInsertSchema>

const workspaceUserPropertyFields = {
  filters: () => jsonValueSchema,
  displayFilters: () => jsonValueSchema,
  displayProperties: () => jsonValueSchema,
  richFilters: () => jsonValueSchema
}
export const workspaceUserPropertySchema = createSelectSchema(
  workspaceUserProperties,
  workspaceUserPropertyFields
).strict()
export const workspaceUserPropertyInsertSchema = createInsertSchema(
  workspaceUserProperties,
  workspaceUserPropertyFields
)
  .omit({ id: true })
  .strict()
export type WorkspaceUserProperty = z.infer<typeof workspaceUserPropertySchema>
export type WorkspaceUserPropertyInsert = z.infer<typeof workspaceUserPropertyInsertSchema>

const workspaceUserLinkFields = {
  metadata: () => jsonValueSchema
}
export const workspaceUserLinkSchema = createSelectSchema(workspaceUserLinks, workspaceUserLinkFields).strict()
export const workspaceUserLinkInsertSchema = createInsertSchema(workspaceUserLinks, workspaceUserLinkFields)
  .omit({ id: true })
  .strict()
export type WorkspaceUserLink = z.infer<typeof workspaceUserLinkSchema>
export type WorkspaceUserLinkInsert = z.infer<typeof workspaceUserLinkInsertSchema>

const workspaceHomePreferenceFields = {
  config: () => jsonValueSchema
}
export const workspaceHomePreferenceSchema = createSelectSchema(
  workspaceHomePreferences,
  workspaceHomePreferenceFields
).strict()
export const workspaceHomePreferenceInsertSchema = createInsertSchema(
  workspaceHomePreferences,
  workspaceHomePreferenceFields
)
  .omit({ id: true })
  .strict()
export type WorkspaceHomePreference = z.infer<typeof workspaceHomePreferenceSchema>
export type WorkspaceHomePreferenceInsert = z.infer<typeof workspaceHomePreferenceInsertSchema>

export const workspaceUserPreferenceSchema = createSelectSchema(workspaceUserPreferences).strict()
export const workspaceUserPreferenceInsertSchema = createInsertSchema(workspaceUserPreferences)
  .omit({ id: true })
  .strict()
export type WorkspaceUserPreference = z.infer<typeof workspaceUserPreferenceSchema>
export type WorkspaceUserPreferenceInsert = z.infer<typeof workspaceUserPreferenceInsertSchema>

const projectFields = {
  descriptionHtml: () => jsonValueSchema,
  network: () => z.literal([0, 2]),
  descriptionText: () => jsonValueSchema,
  iconProp: () => jsonValueSchema,
  logoProps: () => jsonValueSchema
}
export const projectSchema = createSelectSchema(projects, projectFields).strict()
export const projectInsertSchema = createInsertSchema(projects, projectFields).omit({ id: true }).strict()
export type Project = z.infer<typeof projectSchema>
export type ProjectInsert = z.infer<typeof projectInsertSchema>

export const projectIdentifierSchema = createSelectSchema(projectIdentifiers).strict()
export const projectIdentifierInsertSchema = createInsertSchema(projectIdentifiers).omit({ id: true }).strict()
export type ProjectIdentifier = z.infer<typeof projectIdentifierSchema>
export type ProjectIdentifierInsert = z.infer<typeof projectIdentifierInsertSchema>

const projectMemberFields = {
  role: () => z.literal([20, 15, 5]),
  viewProps: () => jsonValueSchema,
  defaultProps: () => jsonValueSchema,
  preferences: () => jsonValueSchema
}
export const projectMemberSchema = createSelectSchema(projectMembers, projectMemberFields).strict()
export const projectMemberInsertSchema = createInsertSchema(projectMembers, projectMemberFields)
  .omit({ id: true })
  .strict()
export type ProjectMember = z.infer<typeof projectMemberSchema>
export type ProjectMemberInsert = z.infer<typeof projectMemberInsertSchema>

const projectMemberInviteFields = {
  role: () => z.literal([20, 15, 5])
}
export const projectMemberInviteSchema = createSelectSchema(projectMemberInvites, projectMemberInviteFields).strict()
export const projectMemberInviteInsertSchema = createInsertSchema(projectMemberInvites, projectMemberInviteFields)
  .omit({ id: true })
  .strict()
export type ProjectMemberInvite = z.infer<typeof projectMemberInviteSchema>
export type ProjectMemberInviteInsert = z.infer<typeof projectMemberInviteInsertSchema>

const projectUserPropertyFields = {
  displayProperties: () => jsonValueSchema,
  displayFilters: () => jsonValueSchema,
  filters: () => jsonValueSchema,
  richFilters: () => jsonValueSchema,
  preferences: () => jsonValueSchema
}
export const projectUserPropertySchema = createSelectSchema(projectUserProperties, projectUserPropertyFields).strict()
export const projectUserPropertyInsertSchema = createInsertSchema(projectUserProperties, projectUserPropertyFields)
  .omit({ id: true })
  .strict()
export type ProjectUserProperty = z.infer<typeof projectUserPropertySchema>
export type ProjectUserPropertyInsert = z.infer<typeof projectUserPropertyInsertSchema>

export const restrictedWorkspaceSlugs = new Set([
  '404',
  'accounts',
  'api',
  'create-workspace',
  'god-mode',
  'installations',
  'invitations',
  'onboarding',
  'profile',
  'spaces',
  'workspace-invitations',
  'password',
  'flags',
  'monitor',
  'monitoring',
  'ingest',
  'plane-pro',
  'plane-ultimate',
  'enterprise',
  'plane-enterprise',
  'disco',
  'silo',
  'chat',
  'calendar',
  'drive',
  'channels',
  'upgrade',
  'billing',
  'sign-in',
  'sign-up',
  'signin',
  'signup',
  'config',
  'live',
  'admin',
  'm',
  'import',
  'importers',
  'integrations',
  'integration',
  'configuration',
  'initiatives',
  'initiative',
  'workflow',
  'workflows',
  'epics',
  'epic',
  'story',
  'mobile',
  'dashboard',
  'desktop',
  'onload',
  'real-time',
  'one',
  'pages',
  'business',
  'pro',
  'settings',
  'license',
  'licenses',
  'instances',
  'instance'
])
const workspaceNameInput = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    value => /[\p{L}\p{N}]/u.test(value) && !/(?:https?:\/\/|www\.)\S+|\b\S+\.[a-z]{2,}\b/i.test(value),
    'Invalid workspace name'
  )
const workspaceSlugInput = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-zA-Z0-9_-]+$/)
  .refine(value => !restrictedWorkspaceSlugs.has(value), 'Reserved workspace slug')
export const createWorkspaceInputSchema = z
  .object({
    name: workspaceNameInput,
    slug: workspaceSlugInput,
    companyRole: z.string().max(255).optional(),
    /** Seed a sample project after creation (Plane always seeds; here the user opts in). */
    seed: z.boolean().optional()
  })
  .strict()
export const updateWorkspaceInputSchema = z
  .object({
    name: workspaceNameInput.optional(),
    slug: workspaceSlugInput.optional(),
    timezone: z.string().min(1).max(255).optional(),
    backgroundColor: z.string().max(255).optional(),
    organizationSize: z.string().max(20).nullable().optional()
  })
  .strict()
  .refine(value => Object.keys(value).length > 0, 'No changes supplied')
export const updateWorkspaceMemberInputSchema = z.object({ role: z.literal([5, 15, 20]) }).strict()
export const workspaceMemberIdSchema = z.coerce.number().int().positive().safe()
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceInputSchema>
export type WorkspaceRole = 5 | 15 | 20
export type WorkspaceActionState = { error?: string; success?: boolean }

export const createWorkspaceInvitationSchema = z
  .object({
    email: z
      .email()
      .max(255)
      .transform(value => value.trim().toLowerCase()),
    role: z.literal([5, 15, 20]).default(5),
    message: z.string().max(2000).nullable().optional()
  })
  .strict()
export const updateWorkspaceInvitationSchema = z.object({ role: z.literal([5, 15, 20]) }).strict()
export const respondWorkspaceInvitationSchema = z.object({ accepted: z.boolean() }).strict()
export type CreateWorkspaceInvitationInput = z.output<typeof createWorkspaceInvitationSchema>

export const workspacePreferenceKeySchema = z.enum([
  'views',
  'active_cycles',
  'analytics',
  'drafts',
  'your_work',
  'archives',
  'stickies'
])
export const updateWorkspacePreferencesSchema = z
  .array(
    z
      .object({
        key: workspacePreferenceKeySchema,
        is_pinned: z.boolean().optional(),
        sort_order: z.number().finite().optional()
      })
      .strict()
      .refine(value => value.is_pinned !== undefined || value.sort_order !== undefined)
  )
  .min(1)
  .max(7)
  .refine(values => new Set(values.map(value => value.key)).size === values.length)
// Plane WorkspaceUserLinkSerializer.to_internal_value: prefix http:// when the scheme is missing.
const quickLinkUrlSchema = z.preprocess(
  value => (typeof value === 'string' && value && !/^https?:\/\//.test(value) ? `http://${value}` : value),
  z
    .url()
    .max(2048)
    .refine(value => {
      try {
        const url = new URL(value)
        return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
      } catch {
        return false
      }
    }, 'URL must use HTTP or HTTPS')
)
export const createQuickLinkSchema = z
  .object({
    url: quickLinkUrlSchema,
    title: z.string().max(255).nullable().optional(),
    project_id: z.number().int().positive().safe().nullable().optional()
  })
  .strict()
export const updateQuickLinkSchema = z
  .object({
    url: quickLinkUrlSchema.optional(),
    title: z.string().max(255).nullable().optional(),
    project_id: z.number().int().positive().safe().nullable().optional()
  })
  .strict()
  .refine(value => Object.keys(value).length > 0)
export const createWorkspaceFavoriteSchema = z.discriminatedUnion('entity_type', [
  z
    .object({
      entity_type: z.literal('folder'),
      name: z.string().trim().min(1).max(255),
      parent: z.number().int().positive().safe().nullable().optional()
    })
    .strict(),
  z
    .object({
      entity_type: z.enum(['project', 'issue', 'cycle', 'module', 'view', 'page']),
      entity_identifier: z.number().int().positive().safe(),
      project_id: z.number().int().positive().safe().nullable().optional(),
      name: z.string().max(255).nullable().optional(),
      parent: z.number().int().positive().safe().nullable().optional()
    })
    .strict()
])
export const updateWorkspaceFavoriteSchema = z
  .object({
    name: z.string().max(255).nullable().optional(),
    sequence: z.number().finite().optional(),
    parent: z.number().int().positive().safe().nullable().optional()
  })
  .strict()
  .refine(value => Object.keys(value).length > 0)
export type UpdateWorkspacePreferences = z.output<typeof updateWorkspacePreferencesSchema>
export type CreateQuickLink = z.output<typeof createQuickLinkSchema>
export type UpdateQuickLink = z.output<typeof updateQuickLinkSchema>
export type CreateWorkspaceFavorite = z.output<typeof createWorkspaceFavoriteSchema>
export type UpdateWorkspaceFavorite = z.output<typeof updateWorkspaceFavoriteSchema>

const positiveId = z.coerce.number().int().positive().safe()
const roleSchema = z.literal([5, 15, 20])

// Workspace list filters (Plane search_fields = name, filterset_fields = owner).
export const workspaceListQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  owner: positiveId.optional()
})
export type WorkspaceListQuery = z.output<typeof workspaceListQuerySchema>

// Plane app/serializers WorkSpaceSerializer.validate_name / validate_slug are in the create/update schemas above.
// api/serializers/invite.py WorkspaceInviteSerializer.validate_email / validate_role / validate.
export const workspaceInviteApiValidateEmail = z
  .email('Invalid email address')
  .max(255)
  .transform(value => value.trim().toLowerCase())
export const workspaceInviteApiValidateRole = roleSchema
export const workspaceInviteApiInputSchema = z
  .object({ email: workspaceInviteApiValidateEmail, role: workspaceInviteApiValidateRole.default(5) })
  .strict()

// app/views/workspace/invite.py create(): `emails` is a list of { email, role }.
export const createWorkspaceInvitationsBulkSchema = z
  .object({
    emails: z
      .array(z.object({ email: workspaceInviteApiValidateEmail, role: roleSchema.default(5) }).strict())
      .min(1)
      .max(100)
  })
  .strict()
export const inviteWorkspaceMembersSchema = z.union([
  createWorkspaceInvitationsBulkSchema,
  createWorkspaceInvitationSchema
])
export type CreateWorkspaceInvitationsBulkInput = z.output<typeof createWorkspaceInvitationsBulkSchema>

export const joinWorkspaceInvitationSchema = z
  .object({ token: z.string().min(1).max(255), accepted: z.boolean().default(false) })
  .strict()
export const joinWorkspaceInvitationTokenQuerySchema = z.object({ token: z.string().min(1).max(255) })
export const acceptUserWorkspaceInvitationsSchema = z
  .object({ invitations: z.array(positiveId).min(1).max(100) })
  .strict()
export type JoinWorkspaceInvitationInput = z.output<typeof joinWorkspaceInvitationSchema>

export const workspaceMemberListQuerySchema = z.object({
  search: z.string().trim().max(255).optional(),
  cursor: z.string().max(40).optional(),
  per_page: z.coerce.number().int().min(1).max(100).optional()
})
export const workspaceMemberViewsSchema = z.object({ view_props: z.record(z.string(), z.unknown()) }).strict()

export const workspaceThemeColorsSchema = z.record(z.string(), z.unknown())
export const createWorkspaceThemeSchema = z
  .object({ name: z.string().trim().min(1).max(300), colors: workspaceThemeColorsSchema.default({}) })
  .strict()
export const updateWorkspaceThemeSchema = createWorkspaceThemeSchema
  .partial()
  .refine(value => Object.keys(value).length > 0)
export type CreateWorkspaceTheme = z.output<typeof createWorkspaceThemeSchema>
export type UpdateWorkspaceTheme = z.output<typeof updateWorkspaceThemeSchema>

// WorkspaceHomePreference.HomeWidgetKeys. quick_tutorial and new_at_plane are never auto-created.
export const homeWidgetKeySchema = z.enum(['quick_links', 'recents', 'my_stickies', 'new_at_plane', 'quick_tutorial'])
export const updateWorkspaceHomePreferenceSchema = z
  .object({ is_enabled: z.boolean().optional(), sort_order: z.number().finite().optional() })
  .strict()
  .refine(value => Object.keys(value).length > 0)
export type UpdateWorkspaceHomePreference = z.output<typeof updateWorkspaceHomePreferenceSchema>

const jsonRecord = z.record(z.string(), z.unknown())
export const updateWorkspaceUserPropertiesSchema = z
  .object({
    filters: jsonRecord.optional(),
    display_filters: jsonRecord.optional(),
    display_properties: jsonRecord.optional(),
    rich_filters: jsonRecord.optional(),
    navigation_project_limit: z.number().int().min(0).max(1000).optional(),
    navigation_control_preference: z.enum(['ACCORDION', 'TABBED']).optional()
  })
  .strict()
export type UpdateWorkspaceUserProperties = z.output<typeof updateWorkspaceUserPropertiesSchema>

// Recent visits (bgtasks/recent_visited_task.py). Plane lists only issue, page and project.
export const recentVisitEntitySchema = z.enum(['issue', 'page', 'project'])
export const recentVisitQuerySchema = z.object({ entity_name: recentVisitEntitySchema.optional() })
export const recordRecentVisitSchema = z
  .object({
    entity_name: recentVisitEntitySchema,
    entity_identifier: positiveId,
    project_id: positiveId.nullable().optional()
  })
  .strict()
export type RecordRecentVisit = z.output<typeof recordRecentVisitSchema>

export const workspaceActivityExportSchema = z
  .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date is required (YYYY-MM-DD)') })
  .strict()

// Profile, dashboard and activity queries. Filters follow plane.utils.issue_filters.issue_filters (subset).
const csv = z
  .string()
  .max(1000)
  .transform(value =>
    value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  )
export const workspaceUserIssuesQuerySchema = z.object({
  per_page: z.coerce.number().int().min(1).max(1000).default(1000),
  cursor: z.string().max(40).optional(),
  order_by: z.string().max(40).default('-created_at'),
  // Subset of Plane's ISSUE_GROUP_BY_ALLOWLIST that is grouped inside the page.
  group_by: z.enum(['state_id', 'state__group', 'priority', 'project_id', 'cycle_id']).optional(),
  priority: csv.optional(),
  state_group: csv.optional(),
  state: csv.optional(),
  project: csv.optional(),
  labels: csv.optional(),
  assignees: csv.optional(),
  created_by: csv.optional(),
  start_date: csv.optional(),
  target_date: csv.optional()
})
export type WorkspaceUserIssuesQuery = z.output<typeof workspaceUserIssuesQuerySchema>
export const workspaceUserStatsQuerySchema = workspaceUserIssuesQuerySchema.pick({
  priority: true,
  state_group: true,
  state: true,
  project: true,
  labels: true,
  created_by: true,
  start_date: true,
  target_date: true
})
export const workspaceUserActivityQuerySchema = z.object({
  per_page: z.coerce.number().int().min(1).max(1000).default(1000),
  cursor: z.string().max(40).optional(),
  order_by: z.string().max(40).default('-created_at'),
  project: csv.optional()
})
export const monthQuerySchema = z.object({ month: z.coerce.number().int().min(1).max(12).default(1) })
export const workspaceFieldsQuerySchema = z.object({ fields: z.string().max(300).optional() })
