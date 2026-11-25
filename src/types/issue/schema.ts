import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import {
  commentReactions,
  issueActivities,
  issueAssignees,
  issueAttachments,
  issueBlockers,
  issueComments,
  issueDescriptionVersions,
  issueLabels,
  issueLinks,
  issueMentions,
  issueReactions,
  issueRelations,
  issueSequences,
  issueSubscribers,
  issueVersions,
  issueVotes,
  issues,
  labels,
  projectIssueCounters,
  states
} from '@/db/schema/issue'
import { jsonValueSchema } from '@/types/database/schema'

const issueFields = {
  startDate: () => z.iso.date(),
  targetDate: () => z.iso.date(),
  archivedAt: () => z.iso.date(),
  descriptionJson: () => jsonValueSchema,
  sequenceId: (schema: z.ZodNumber) => schema.gt(0)
}
export const issueSchema = createSelectSchema(issues, issueFields).strict()
export const issueInsertSchema = createInsertSchema(issues, issueFields).omit({ id: true }).strict()
export type Issue = z.infer<typeof issueSchema>
export type IssueInsert = z.infer<typeof issueInsertSchema>

export const stateSchema = createSelectSchema(states).strict()
export const stateInsertSchema = createInsertSchema(states).omit({ id: true }).strict()
export type State = z.infer<typeof stateSchema>
export type StateInsert = z.infer<typeof stateInsertSchema>

export const labelSchema = createSelectSchema(labels).strict()
export const labelInsertSchema = createInsertSchema(labels).omit({ id: true }).strict()
export type Label = z.infer<typeof labelSchema>
export type LabelInsert = z.infer<typeof labelInsertSchema>

const issueSequenceFields = {
  sequence: (schema: z.ZodNumber) => schema.gt(0)
}
export const issueSequenceSchema = createSelectSchema(issueSequences, issueSequenceFields).strict()
export const issueSequenceInsertSchema = createInsertSchema(issueSequences, issueSequenceFields)
  .omit({ id: true })
  .strict()
export type IssueSequence = z.infer<typeof issueSequenceSchema>
export type IssueSequenceInsert = z.infer<typeof issueSequenceInsertSchema>

const projectIssueCounterFields = {
  lastSequence: (schema: z.ZodNumber) => schema.gte(0)
}
export const projectIssueCounterSchema = createSelectSchema(projectIssueCounters, projectIssueCounterFields).strict()
export const projectIssueCounterInsertSchema = createInsertSchema(projectIssueCounters, projectIssueCounterFields)
  .omit({ id: true })
  .strict()
export type ProjectIssueCounter = z.infer<typeof projectIssueCounterSchema>
export type ProjectIssueCounterInsert = z.infer<typeof projectIssueCounterInsertSchema>

export const issueAssigneeSchema = createSelectSchema(issueAssignees).strict()
export const issueAssigneeInsertSchema = createInsertSchema(issueAssignees).omit({ id: true }).strict()
export type IssueAssignee = z.infer<typeof issueAssigneeSchema>
export type IssueAssigneeInsert = z.infer<typeof issueAssigneeInsertSchema>

export const issueLabelSchema = createSelectSchema(issueLabels).strict()
export const issueLabelInsertSchema = createInsertSchema(issueLabels).omit({ id: true }).strict()
export type IssueLabel = z.infer<typeof issueLabelSchema>
export type IssueLabelInsert = z.infer<typeof issueLabelInsertSchema>

export const issueRelationSchema = createSelectSchema(issueRelations).strict()
export const issueRelationInsertSchema = createInsertSchema(issueRelations).omit({ id: true }).strict()
export type IssueRelation = z.infer<typeof issueRelationSchema>
export type IssueRelationInsert = z.infer<typeof issueRelationInsertSchema>

export const issueBlockerSchema = createSelectSchema(issueBlockers).strict()
export const issueBlockerInsertSchema = createInsertSchema(issueBlockers).omit({ id: true }).strict()
export type IssueBlocker = z.infer<typeof issueBlockerSchema>
export type IssueBlockerInsert = z.infer<typeof issueBlockerInsertSchema>

export const issueMentionSchema = createSelectSchema(issueMentions).strict()
export const issueMentionInsertSchema = createInsertSchema(issueMentions).omit({ id: true }).strict()
export type IssueMention = z.infer<typeof issueMentionSchema>
export type IssueMentionInsert = z.infer<typeof issueMentionInsertSchema>

const issueLinkFields = {
  metadata: () => jsonValueSchema
}
export const issueLinkSchema = createSelectSchema(issueLinks, issueLinkFields).strict()
export const issueLinkInsertSchema = createInsertSchema(issueLinks, issueLinkFields).omit({ id: true }).strict()
export type IssueLink = z.infer<typeof issueLinkSchema>
export type IssueLinkInsert = z.infer<typeof issueLinkInsertSchema>

const issueAttachmentFields = {
  attributes: () => jsonValueSchema
}
export const issueAttachmentSchema = createSelectSchema(issueAttachments, issueAttachmentFields).strict()
export const issueAttachmentInsertSchema = createInsertSchema(issueAttachments, issueAttachmentFields)
  .omit({ id: true })
  .strict()
export type IssueAttachment = z.infer<typeof issueAttachmentSchema>
export type IssueAttachmentInsert = z.infer<typeof issueAttachmentInsertSchema>

const issueCommentFields = {
  attachments: () => z.array(z.string().max(200)).max(10),
  commentJson: () => jsonValueSchema
}
export const issueCommentSchema = createSelectSchema(issueComments, issueCommentFields).strict()
export const issueCommentInsertSchema = createInsertSchema(issueComments, issueCommentFields)
  .omit({ id: true })
  .strict()
export type IssueComment = z.infer<typeof issueCommentSchema>
export type IssueCommentInsert = z.infer<typeof issueCommentInsertSchema>

const issueActivityFields = {
  attachments: () => z.array(z.string().max(200)).max(10)
}
export const issueActivitySchema = createSelectSchema(issueActivities, issueActivityFields).strict()
export const issueActivityInsertSchema = createInsertSchema(issueActivities, issueActivityFields)
  .omit({ id: true })
  .strict()
export type IssueActivity = z.infer<typeof issueActivitySchema>
export type IssueActivityInsert = z.infer<typeof issueActivityInsertSchema>

export const issueSubscriberSchema = createSelectSchema(issueSubscribers).strict()
export const issueSubscriberInsertSchema = createInsertSchema(issueSubscribers).omit({ id: true }).strict()
export type IssueSubscriber = z.infer<typeof issueSubscriberSchema>
export type IssueSubscriberInsert = z.infer<typeof issueSubscriberInsertSchema>

export const issueReactionSchema = createSelectSchema(issueReactions).strict()
export const issueReactionInsertSchema = createInsertSchema(issueReactions).omit({ id: true }).strict()
export type IssueReaction = z.infer<typeof issueReactionSchema>
export type IssueReactionInsert = z.infer<typeof issueReactionInsertSchema>

export const commentReactionSchema = createSelectSchema(commentReactions).strict()
export const commentReactionInsertSchema = createInsertSchema(commentReactions).omit({ id: true }).strict()
export type CommentReaction = z.infer<typeof commentReactionSchema>
export type CommentReactionInsert = z.infer<typeof commentReactionInsertSchema>

const issueVoteFields = {
  vote: () => z.literal([-1, 1])
}
export const issueVoteSchema = createSelectSchema(issueVotes, issueVoteFields).strict()
export const issueVoteInsertSchema = createInsertSchema(issueVotes, issueVoteFields).omit({ id: true }).strict()
export type IssueVote = z.infer<typeof issueVoteSchema>
export type IssueVoteInsert = z.infer<typeof issueVoteInsertSchema>

const issueVersionFields = {
  startDate: () => z.iso.date(),
  targetDate: () => z.iso.date(),
  archivedAt: () => z.iso.date(),
  assignees: () => z.array(z.int().positive()),
  labels: () => z.array(z.int().positive()),
  modules: () => z.array(z.int().positive()),
  properties: () => jsonValueSchema,
  meta: () => jsonValueSchema
}
export const issueVersionSchema = createSelectSchema(issueVersions, issueVersionFields).strict()
export const issueVersionInsertSchema = createInsertSchema(issueVersions, issueVersionFields)
  .omit({ id: true })
  .strict()
export type IssueVersion = z.infer<typeof issueVersionSchema>
export type IssueVersionInsert = z.infer<typeof issueVersionInsertSchema>

const issueDescriptionVersionFields = {
  descriptionJson: () => jsonValueSchema
}
export const issueDescriptionVersionSchema = createSelectSchema(
  issueDescriptionVersions,
  issueDescriptionVersionFields
).strict()
export const issueDescriptionVersionInsertSchema = createInsertSchema(
  issueDescriptionVersions,
  issueDescriptionVersionFields
)
  .omit({ id: true })
  .strict()
export type IssueDescriptionVersion = z.infer<typeof issueDescriptionVersionSchema>
export type IssueDescriptionVersionInsert = z.infer<typeof issueDescriptionVersionInsertSchema>

const positiveId = z.number().int().positive().safe()
export const issueIdParamSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(positiveId)
const nullableId = positiveId.nullable().optional()
const prioritySchema = z.enum(['urgent', 'high', 'medium', 'low', 'none'])
/** Fields shared by issue create and update (PD-0020, PD-0322, PD-0333). */
const issueWriteFields = {
  name: z.string().trim().min(1).max(255),
  priority: prioritySchema,
  parentId: nullableId,
  startDate: z.iso.date().nullable().optional(),
  targetDate: z.iso.date().nullable().optional(),
  descriptionHtml: z.string().max(1_000_000).optional(),
  descriptionJson: jsonValueSchema.optional(),
  assigneeIds: z.array(positiveId).max(100).optional(),
  labelIds: z.array(positiveId).max(100).optional(),
  estimatePointId: nullableId,
  typeId: nullableId,
  point: z.number().int().min(0).max(12).nullable().optional(),
  externalId: z.string().max(255).nullable().optional(),
  externalSource: z.string().max(255).nullable().optional()
}
const startBeforeTarget = (value: { startDate?: string | null; targetDate?: string | null }) =>
  !value.startDate || !value.targetDate || value.startDate <= value.targetDate
const startBeforeTargetIssue = { message: 'Start date cannot exceed target date', path: ['targetDate'] }

export const createIssueInputSchema = z
  .object({ ...issueWriteFields, priority: prioritySchema.optional(), stateId: nullableId })
  .strict()
  .refine(startBeforeTarget, startBeforeTargetIssue)
export type CreateIssueInput = z.infer<typeof createIssueInputSchema>
export type IssueActionState = { error?: string; success?: boolean }
/** Public API and mobile create input share the same validation (PD-0021, PD-0322). */
export const issueApiInputSchema = createIssueInputSchema
/** Body of the external-id upsert. Create or update validation runs in the service. */
export const externalIssueInputSchema = z.record(z.string(), z.unknown())
export const issueInputSchema = createIssueInputSchema

export const stateGroupSchema = z.enum(['backlog', 'unstarted', 'started', 'completed', 'cancelled'])
/** Plane `StateSerializer.validate`: a triage state can never be created or set through the API (PD-0045, PD-0361). */
const stateWriteFields = {
  name: z.string().trim().min(1).max(255),
  color: z.string().trim().min(1).max(255),
  slug: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(10000).optional(),
  sequence: z.number().finite().optional(),
  externalId: z.string().max(255).nullable().optional(),
  externalSource: z.string().max(255).nullable().optional()
}
export const createStateInputSchema = z
  .object({ ...stateWriteFields, group: stateGroupSchema.optional(), default: z.boolean().optional() })
  .strict()
export const updateStateInputSchema = z
  .object({
    name: stateWriteFields.name.optional(),
    color: stateWriteFields.color.optional(),
    description: stateWriteFields.description,
    sequence: stateWriteFields.sequence,
    group: stateGroupSchema.optional(),
    default: z.boolean().optional(),
    externalId: stateWriteFields.externalId,
    externalSource: stateWriteFields.externalSource
  })
  .strict()
  .refine(value => Object.keys(value).length > 0, 'Provide at least one field')
export const stateApiInputSchema = createStateInputSchema
export const stateInputSchema = createStateInputSchema
export type CreateStateInput = z.infer<typeof createStateInputSchema>
export type UpdateStateInput = z.infer<typeof updateStateInputSchema>

const labelWriteFields = {
  name: z.string().trim().min(1).max(255),
  color: z.string().max(255).optional(),
  description: z.string().max(10000).optional(),
  parentId: nullableId,
  sortOrder: z.number().finite().optional(),
  externalId: z.string().max(255).nullable().optional(),
  externalSource: z.string().max(255).nullable().optional()
}
export const createLabelInputSchema = z.object(labelWriteFields).strict()
export const updateLabelInputSchema = z
  .object({ ...labelWriteFields, name: labelWriteFields.name.optional() })
  .strict()
  .refine(value => Object.keys(value).length > 0, 'Provide at least one field')
/** Label name rules of `LabelSerializer.validate_name` (PD-0326): case-insensitive uniqueness is checked in the service. */
export const labelValidateName = labelWriteFields.name
export const bulkCreateLabelsInputSchema = z
  .object({
    labelData: z
      .array(
        z
          .object({ name: z.string().trim().min(1).max(255).optional(), description: z.string().max(10000).optional() })
          .strict()
      )
      .max(500)
  })
  .strict()
export const createCommentInputSchema = z
  .object({
    text: z.string().trim().min(1).max(10000)
  })
  .strict()
export type CreateLabelInput = z.infer<typeof createLabelInputSchema>
export type UpdateLabelInput = z.infer<typeof updateLabelInputSchema>
export type BulkCreateLabelsInput = z.infer<typeof bulkCreateLabelsInputSchema>
export type CreateCommentInput = z.infer<typeof createCommentInputSchema>

export const updateIssueInputSchema = z
  .object({
    ...issueWriteFields,
    name: issueWriteFields.name.optional(),
    priority: prioritySchema.optional(),
    stateId: positiveId.optional(),
    sortOrder: z.number().finite().optional()
  })
  .strict()
  .refine(value => Object.keys(value).length > 0, 'Provide at least one field')
export type UpdateIssueInput = z.infer<typeof updateIssueInputSchema>

/** Bulk operations (PD-0569, PD-0592, PD-0602). */
export const bulkIssueIdsInputSchema = z.object({ issueIds: z.array(positiveId).min(1).max(500) }).strict()
export const bulkUpdateDatesInputSchema = z
  .object({
    updates: z
      .array(
        z
          .object({
            id: positiveId,
            startDate: z.iso.date().optional(),
            targetDate: z.iso.date().optional()
          })
          .strict()
      )
      .min(1)
      .max(500)
  })
  .strict()
export const subIssuesInputSchema = z.object({ subIssueIds: z.array(positiveId).min(1).max(500) }).strict()
export const projectUserPropertyInputSchema = z
  .object({
    displayProperties: z.record(z.string(), jsonValueSchema).optional(),
    displayFilters: z.record(z.string(), jsonValueSchema).optional(),
    filters: z.record(z.string(), jsonValueSchema).optional(),
    richFilters: z.record(z.string(), jsonValueSchema).optional(),
    preferences: z.record(z.string(), jsonValueSchema).optional(),
    sortOrder: z.number().finite().optional()
  })
  .strict()
export type BulkIssueIdsInput = z.infer<typeof bulkIssueIdsInputSchema>
export type BulkUpdateDatesInput = z.infer<typeof bulkUpdateDatesInputSchema>
export type SubIssuesInput = z.infer<typeof subIssuesInputSchema>
export type ProjectUserPropertyInput = z.infer<typeof projectUserPropertyInputSchema>

/** Query string of the issue list endpoints. Values stay raw strings; `filter.ts` interprets them (PD-1883). */
export const issueListQuerySchema = z.record(z.string(), z.string())
export type IssueListQuery = z.infer<typeof issueListQuerySchema>
export type IssueGroupingOptions = { publicBoard?: boolean }
export type IssueGroupValuesOptions = IssueGroupingOptions & { userId?: number }

export const issueRelationInputSchema = z.object({ id: positiveId }).strict()
export type IssueRelationInput = z.infer<typeof issueRelationInputSchema>

const issueLinkUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .transform(value => (/^https?:\/\//i.test(value) ? value : `http://${value}`))
  .refine(value => {
    try {
      const url = new URL(value)
      return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password
    } catch {
      return false
    }
  }, 'Invalid URL')
export const createIssueLinkSchema = z
  .object({ url: issueLinkUrlSchema, title: z.string().trim().max(255).nullable().optional() })
  .strict()
export const updateIssueLinkSchema = z
  .object({ url: issueLinkUrlSchema.optional(), title: z.string().trim().max(255).nullable().optional() })
  .strict()
  .refine(value => Object.keys(value).length > 0)
export type CreateIssueLinkInput = z.infer<typeof createIssueLinkSchema>
export type UpdateIssueLinkInput = z.infer<typeof updateIssueLinkSchema>
export const issueRelationCreateSchema = z
  .object({
    relation_type: z.enum([
      'blocking',
      'blocked_by',
      'duplicate',
      'relates_to',
      'start_after',
      'start_before',
      'finish_after',
      'finish_before'
    ]),
    issues: z.array(positiveId).min(1).max(50)
  })
  .strict()
  .refine(value => new Set(value.issues).size === value.issues.length)
export const issueRelationRemoveSchema = z.object({ related_issue: positiveId }).strict()
export type IssueRelationCreate = z.infer<typeof issueRelationCreateSchema>

export const issueSubscriberInputSchema = z.object({ subscriber: positiveId }).strict()
