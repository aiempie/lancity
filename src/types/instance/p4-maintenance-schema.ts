import { z } from 'zod'

const email = z.string().trim().toLowerCase().email().max(255)
const slug = z.string().trim().min(1).max(48)
const positive = z.coerce.number().int().positive().safe()
const count = (max: number) => z.coerce.number().int().min(0).max(max).default(0)

/** PD-1199 `process_logs` payload (Plane `APIActivityLog` fields). Unknown keys are dropped. */
export const apiLogDataSchema = z.object({
  token_identifier: z.string().max(255),
  path: z.string().max(255),
  method: z.string().max(10),
  query_params: z.string().nullish(),
  headers: z.string().nullish(),
  body: z.string().nullish(),
  response_code: z.number().int(),
  response_body: z.string().nullish(),
  ip_address: z.string().nullish(),
  user_agent: z.string().max(512).nullish()
})
export type ApiLogData = z.infer<typeof apiLogDataSchema>

/** `create_dummy_data` prompts. Caps keep one run inside the Worker's D1 subrequest budget. */
export const dummyDataSchema = z
  .object({
    slug,
    email,
    members: z.array(email).max(50).default([]),
    issueCount: count(1000),
    cycleCount: count(50),
    moduleCount: count(50),
    pagesCount: count(100),
    intakeIssueCount: count(200)
  })
  .strict()
export type DummyDataInput = z.infer<typeof dummyDataSchema>

export const activateUserSchema = z.object({ email }).strict()
export const resetPasswordSchema = z.object({ email, password: z.string().min(8).max(128) }).strict()
export const clearCacheSchema = z.object({ key: z.string().trim().min(1).max(500).optional() }).strict()
export const createProjectMemberSchema = z
  .object({ projectId: positive, email, role: z.literal([5, 15, 20]).default(20) })
  .strict()
export const reactivateWorkspaceMemberSchema = z.object({ slug, email }).strict()
export const updateDeletedWorkspaceSlugSchema = z.object({ slug, dryRun: z.boolean().default(false) }).strict()
/** `PROJ-12`: the identifier and the sequence of the duplicated issue. */
export const fixDuplicateSequencesSchema = z
  .object({ workspaceSlug: slug, issueIdentifier: z.string().trim().regex(/^[^-\s]+-\d+$/, 'Use the form PROJECT-123') })
  .strict()
export const syncVersionSchema = z
  .object({ batchSize: z.coerce.number().int().min(1).max(5000).default(1000), countdown: z.coerce.number().int().min(0).max(86_400).default(0) })
  .strict()
export const testEmailSchema = z.object({ to: email }).strict()
export const registerInstanceSchema = z.object({ machineSignature: z.string().trim().min(1).max(255).default('machine-signature') }).strict()
export const cleanupRunSchema = z
  .object({ task: z.enum(['api_logs', 'email_logs', 'page_versions', 'issue_description_versions', 'webhook_logs', 'hard_delete']) })
  .strict()
export const workspaceSeedRunSchema = z.object({ workspaceId: positive }).strict()
export const maintenanceRunsQuerySchema = z.object({
  task: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
})

export type CreateProjectMemberInput = z.infer<typeof createProjectMemberSchema>
export type FixDuplicateSequencesInput = z.infer<typeof fixDuplicateSequencesSchema>
export type SyncVersionInput = z.infer<typeof syncVersionSchema>
