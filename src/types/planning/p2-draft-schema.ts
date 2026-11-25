import { z } from 'zod'
import { jsonValueSchema } from '@/types/database/schema'

// Workspace draft payloads (Plane `DraftIssueCreateSerializer`). snake_case like the Plane API.
const id = z.number().int().positive().safe()
const nullableId = id.nullable().optional()
const prioritySchema = z.enum(['urgent', 'high', 'medium', 'low', 'none'])

const draftFields = {
  name: z.string().trim().max(255).nullable().optional(),
  description_html: z.string().max(1_000_000).nullable().optional(),
  description_json: jsonValueSchema.optional(),
  priority: prioritySchema.optional(),
  start_date: z.iso.date().nullable().optional(),
  target_date: z.iso.date().nullable().optional(),
  state_id: nullableId,
  parent_id: nullableId,
  estimate_point_id: nullableId,
  type_id: nullableId,
  label_ids: z.array(id).max(100).optional(),
  assignee_ids: z.array(id).max(100).optional(),
  // `null` clears the cycle on update; absent leaves it alone (Plane context `not_provided`).
  cycle_id: nullableId,
  module_ids: z.array(id).max(100).optional()
}
const startBeforeTarget = (value: { start_date?: string | null; target_date?: string | null }) =>
  !value.start_date || !value.target_date || value.start_date <= value.target_date
const startBeforeTargetIssue = { message: 'Start date cannot exceed target date', path: ['target_date'] }

/** `POST draft-issues` (PD-0306). `project_id` is optional: a draft may exist without a project. */
export const createWorkspaceDraftInputSchema = z
  .object({ ...draftFields, project_id: nullableId })
  .refine(startBeforeTarget, startBeforeTargetIssue)
export type CreateWorkspaceDraftInput = z.output<typeof createWorkspaceDraftInputSchema>

/** `PATCH draft-issues/:draftId`. The project of a draft cannot change, so `project_id` is only permission checked. */
export const updateWorkspaceDraftInputSchema = z
  .object({ ...draftFields, project_id: nullableId })
  .refine(startBeforeTarget, startBeforeTargetIssue)
export type UpdateWorkspaceDraftInput = z.output<typeof updateWorkspaceDraftInputSchema>

/** `POST draft-to-issue/:draftId`: the issue payload (validated again by the issue service) plus cycle and modules. */
export const draftToIssueInputSchema = z
  .object({ ...draftFields, name: z.string().trim().min(1).max(255) })
  .refine(startBeforeTarget, startBeforeTargetIssue)
export type DraftToIssueInput = z.output<typeof draftToIssueInputSchema>
