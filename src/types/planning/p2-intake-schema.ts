import { z } from 'zod'
import { jsonValueSchema } from '@/types/database/schema'

// Request payloads of the intake work item API. Keys stay snake_case like the Plane API and the other planning
// payloads in `schema.ts`; rules that need D1 (same-project duplicate, default state) run in the service.
const id = z.number().int().positive().safe()
const prioritySchema = z.enum(['urgent', 'high', 'medium', 'low', 'none'])

/** Plane `IntakeIssue.status`: pending, rejected, snoozed, accepted, duplicate. */
export const INTAKE_STATUS = { PENDING: -2, REJECTED: -1, SNOOZED: 0, ACCEPTED: 1, DUPLICATE: 2 } as const
export const intakeIssueStatusSchema = z.union([z.literal(-2), z.literal(-1), z.literal(0), z.literal(1), z.literal(2)])
export type IntakeIssueStatus = z.infer<typeof intakeIssueStatusSchema>

/** A snooze is a bare date or an ISO datetime. The service floors it to the project's day start (PD-1405). */
export const snoozedTillInputSchema = z.union([z.iso.date(), z.iso.datetime({ offset: true })])

const description = {
  description_html: z.string().max(1_000_000).nullable().optional(),
  // Plane accepts both `description` and `description_json` for the JSON document.
  description: jsonValueSchema.nullable().optional(),
  description_json: jsonValueSchema.nullable().optional()
}
const startBeforeTarget = (value: { start_date?: string | null; target_date?: string | null }) =>
  !value.start_date || !value.target_date || value.start_date <= value.target_date

/** `issue` of `POST inbox-issues` (app): `IssueCreateSerializer` fields that make sense for a triage item. */
const appIssueFields = {
  ...description,
  priority: prioritySchema.optional(),
  start_date: z.iso.date().nullable().optional(),
  target_date: z.iso.date().nullable().optional(),
  label_ids: z.array(id).max(100).optional(),
  assignee_ids: z.array(id).max(100).optional()
}
export const createIntakeIssueInputSchema = z.object({
  issue: z
    .object({ name: z.string().trim().min(1, 'Name is required').max(255), ...appIssueFields })
    .refine(startBeforeTarget, { message: 'Start date cannot exceed target date', path: ['target_date'] })
})
export type CreateIntakeIssueInput = z.output<typeof createIntakeIssueInputSchema>

/** `IssueDataSerializer` (public API, PD-0121): name, description and priority only. */
export const createIntakeIssueApiInputSchema = z.object({
  issue: z.object({
    name: z.string().trim().min(1, 'Name is required').max(255),
    ...description,
    priority: prioritySchema.optional()
  })
})
export type CreateIntakeIssueApiInput = z.output<typeof createIntakeIssueApiInputSchema>

const issueEdit = z
  .object({ name: z.string().trim().min(1).max(255).optional(), ...appIssueFields })
  .refine(startBeforeTarget, { message: 'Start date cannot exceed target date', path: ['target_date'] })

/** Body of `PATCH inbox-issues/:issueId` (PD-0552). `source_email` is writable only through the public API. */
export const updateIntakeIssueInputSchema = z.object({
  issue: issueEdit.optional(),
  status: intakeIssueStatusSchema.optional(),
  snoozed_till: snoozedTillInputSchema.nullable().optional(),
  duplicate_to: id.nullable().optional(),
  source: z.string().max(255).nullable().optional(),
  skip_activity: z.boolean().optional()
})
export type UpdateIntakeIssueInput = z.output<typeof updateIntakeIssueInputSchema>

/** `IntakeIssueUpdateSerializer` (PD-0014, PD-0015): the same body plus `source_email`. */
export const updateIntakeIssueApiInputSchema = updateIntakeIssueInputSchema.extend({
  source_email: z.string().nullable().optional()
})
export type UpdateIntakeIssueApiInput = z.output<typeof updateIntakeIssueApiInputSchema>

/** `status` query: comma separated statuses, `null` entries ignored (PD-0549). */
export function parseIntakeStatusQuery(raw: string | undefined, fallback = '-2'): IntakeIssueStatus[] {
  const items = (raw ?? fallback).split(',').filter(item => item !== 'null')
  return items.map(item => intakeIssueStatusSchema.parse(Number(item)))
}
