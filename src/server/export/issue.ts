import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { fileAssets } from '@/db/schema/content'
import { linkto } from '@/data/linkto'
import {
  dateField,
  dateTimeField,
  defineExportSchema,
  formatDate,
  jsonField,
  listField,
  numberField,
  stringField,
  type ExportSchemaDefinition
} from '@/server/export/base'
import { cycleIssues, cycles } from '@/db/schema/planning'
import type { LancityDb } from '@/types/database/schema'
import type { IssueExportRecord } from '@/types/reporting/p3-export-schema'

type Cycle = IssueExportRecord['cycles'][number]
export type IssueExportContext = {
  attachments_dict: Map<number, number[]>
  cycles_dict: Map<number, Cycle>
}

const ID_CHUNK = 80

/** `IssueRelationChoices._REVERSE_MAPPING`: relation type seen from the other side. */
export const ISSUE_RELATION_REVERSE: Record<string, string> = {
  blocked_by: 'blocking',
  relates_to: 'relates_to',
  duplicate: 'duplicate',
  start_before: 'start_after',
  finish_before: 'finish_after',
  implemented_by: 'implements'
}

/** PD-1763 `get_issue_attachments_dict`: issue id to the ids of its attachment assets. */
export async function getIssueAttachmentsDict(db: LancityDb, issueIds: number[]): Promise<Map<number, number[]>> {
  const dict = new Map<number, number[]>()
  for (let i = 0; i < issueIds.length; i += ID_CHUNK) {
    const rows = await db
      .select({ issueId: fileAssets.issueId, id: fileAssets.id })
      .from(fileAssets)
      .where(
        and(
          inArray(fileAssets.issueId, issueIds.slice(i, i + ID_CHUNK)),
          eq(fileAssets.entityType, 'ISSUE_ATTACHMENT'),
          eq(fileAssets.isDeleted, false),
          isNull(fileAssets.deletedAt)
        )
      )
      .orderBy(asc(fileAssets.id))
    for (const row of rows) if (row.issueId !== null) dict.set(row.issueId, [...(dict.get(row.issueId) ?? []), row.id])
  }
  return dict
}

/** PD-1764 `get_issue_last_cycles_dict`: the most recently added cycle of each issue. */
export async function getIssueLastCyclesDict(db: LancityDb, issueIds: number[]): Promise<Map<number, Cycle>> {
  const dict = new Map<number, Cycle>()
  for (let i = 0; i < issueIds.length; i += ID_CHUNK) {
    const rows = await db
      .select({
        issueId: cycleIssues.issueId,
        createdAt: cycleIssues.createdAt,
        name: cycles.name,
        startDate: cycles.startDate,
        endDate: cycles.endDate
      })
      .from(cycleIssues)
      .innerJoin(cycles, eq(cycles.id, cycleIssues.cycleId))
      .where(and(inArray(cycleIssues.issueId, issueIds.slice(i, i + ID_CHUNK)), isNull(cycleIssues.deletedAt), isNull(cycles.deletedAt)))
      .orderBy(asc(cycleIssues.issueId), asc(cycleIssues.createdAt), asc(cycleIssues.id))
    // Ascending order, so the last row of an issue is its newest cycle.
    for (const row of rows) {
      dict.set(row.issueId, { createdAt: row.createdAt, cycle: { name: row.name, startDate: row.startDate, endDate: row.endDate } })
    }
  }
  return dict
}

const identifier = (ref: { sequenceId: number; project: { identifier: string } }) => `${ref.project.identifier}-${ref.sequenceId}`

/** PD-1765 `_get_created_by`. */
export const getCreatedBy = (obj: { createdBy?: { name: string } | null }) => obj.createdBy?.name ?? ''
/** PD-1766 `_format_date`. */
export const formatExportDate = formatDate

type Prepare = NonNullable<ExportSchemaDefinition<IssueExportRecord, LancityDb>['prepare']>
const prepare: Prepare = {
  // PD-1767
  id: i => identifier({ sequenceId: i.sequenceId, project: i.project }),
  // PD-1768
  state_name: i => i.state?.name ?? null,
  // PD-1769
  module_name: i => i.modules.map(m => m.name),
  // PD-1770
  created_by: i => getCreatedBy(i),
  // PD-1771
  labels: i => i.labels.map(label => label.name),
  // PD-1772
  comments: i =>
    i.comments.map(comment => ({
      comment: comment.commentStripped,
      created_at: formatDate(comment.createdAt),
      created_by: comment.actor?.name ?? ''
    })),
  // PD-1773
  estimate: i => (i.estimatePoint?.value ? i.estimatePoint.value : ''),
  // PD-1774
  link: i => i.links.map(link => link.url),
  // PD-1775
  assignees: i => i.assignees.map(user => user.name),
  // PD-1776
  subscribers_count: i => i.subscribers.length,
  // PD-1777
  attachment_count: (i, ctx) => ((ctx.attachments_dict as IssueExportContext['attachments_dict'] | undefined)?.get(i.id) ?? []).length,
  // PD-1778
  attachment_links: (i, ctx) =>
    ((ctx.attachments_dict as IssueExportContext['attachments_dict'] | undefined)?.get(i.id) ?? []).map(
      asset => `${linkto.apiV1}/workspaces/${i.workspace.slug}/projects/${i.projectId}/issues/${i.id}/attachments/${asset}/`
    ),
  // PD-1779
  cycle_name: (i, ctx) => (ctx.cycles_dict as IssueExportContext['cycles_dict'] | undefined)?.get(i.id)?.cycle.name ?? '',
  // PD-1780
  cycle_start_date: (i, ctx) => formatDate((ctx.cycles_dict as IssueExportContext['cycles_dict'] | undefined)?.get(i.id)?.cycle.startDate),
  // PD-1781
  cycle_end_date: (i, ctx) => formatDate((ctx.cycles_dict as IssueExportContext['cycles_dict'] | undefined)?.get(i.id)?.cycle.endDate),
  // PD-1782
  parent: i => (i.parent ? identifier(i.parent) : ''),
  // PD-1783: reverse relations win over forward ones with the same type, as in Plane.
  relations: i => {
    const relations: Record<string, string> = {}
    for (const r of i.relations) relations[r.relationType] = identifier(r.relatedIssue)
    for (const r of i.related) relations[ISSUE_RELATION_REVERSE[r.relationType] ?? r.relationType] = identifier(r.issue)
    return relations
  }
}

/** `IssueExportSchema` (utils/exporters/schemas/issue.py). */
export const issueExportSchema = defineExportSchema<IssueExportRecord, LancityDb>({
  fields: {
    id: stringField({ label: 'ID' }),
    project_identifier: stringField({ source: 'project.identifier', label: 'Project Identifier' }),
    project_name: stringField({ source: 'project.name', label: 'Project' }),
    project_id: stringField({ source: 'project.id', label: 'Project ID' }),
    sequence_id: numberField({ source: 'sequenceId', label: 'Sequence ID' }),
    name: stringField({ source: 'name', label: 'Name' }),
    description: stringField({ source: 'descriptionStripped', label: 'Description' }),
    priority: stringField({ source: 'priority', label: 'Priority' }),
    start_date: dateField({ source: 'startDate', label: 'Start Date' }),
    target_date: dateField({ source: 'targetDate', label: 'Target Date' }),
    state_name: stringField({ label: 'State' }),
    created_at: dateTimeField({ source: 'createdAt', label: 'Created At' }),
    updated_at: dateTimeField({ source: 'updatedAt', label: 'Updated At' }),
    completed_at: dateTimeField({ source: 'completedAt', label: 'Completed At' }),
    archived_at: dateTimeField({ source: 'archivedAt', label: 'Archived At' }),
    module_name: listField({ label: 'Module Name' }),
    created_by: stringField({ label: 'Created By' }),
    labels: listField({ label: 'Labels' }),
    comments: jsonField({ label: 'Comments' }),
    estimate: stringField({ label: 'Estimate' }),
    link: listField({ label: 'Link' }),
    assignees: listField({ label: 'Assignees' }),
    subscribers_count: numberField({ label: 'Subscribers Count' }),
    attachment_count: numberField({ label: 'Attachment Count' }),
    attachment_links: listField({ label: 'Attachment Links' }),
    cycle_name: stringField({ label: 'Cycle Name' }),
    cycle_start_date: dateField({ label: 'Cycle Start Date' }),
    cycle_end_date: dateField({ label: 'Cycle End Date' }),
    parent: stringField({ label: 'Parent' }),
    relations: jsonField({ label: 'Relations' })
  },
  prepare,
  // PD-1784 `get_context_data`
  getContext: async (rows, db) => {
    if (!db) return {}
    const ids = rows.map(row => row.id)
    return { attachments_dict: await getIssueAttachmentsDict(db, ids), cycles_dict: await getIssueLastCyclesDict(db, ids) }
  }
})
