import type { ExportRecord } from '@/server/export/formatters'
import type { IssueExportRecord } from '@/types/reporting/p3-export-schema'

const iso = (value: Date | string | null | undefined) => (value instanceof Date ? value.toISOString() : (value ?? null))
const issueIdentifier = (ref: { sequenceId: number; project: { identifier: string } }) => `${ref.project.identifier}-${ref.sequenceId}`

/** `YYYY-MM-DD HH:MM:SS` in UTC, the comment timestamp format of `get_comments`. */
function commentTimestamp(value: Date | null): string {
  return value ? value.toISOString().slice(0, 19).replace('T', ' ') : ''
}

/** PD-2009 `get_identifier`. */
export const getIdentifierIssueExport = (i: IssueExportRecord) => `${i.project.identifier}-${i.sequenceId}`
/** PD-2010 `get_assignees`. */
export const getAssigneesIssueExport = (i: IssueExportRecord) => i.assignees.map(user => user.name)
/** PD-2011 `get_subscribers`. */
export const getSubscribersIssueExport = (i: IssueExportRecord) => i.subscribers.map(user => user.name)
/** PD-2012 `get_parent`. */
export const getParentIssueExport = (i: IssueExportRecord) => (i.parent ? issueIdentifier(i.parent) : '')
/** PD-2013 `get_labels`. */
export const getLabelsIssueExport = (i: IssueExportRecord) => i.labels.map(label => label.name)
/** PD-2014 `get_cycles`. */
export const getCyclesIssueExport = (i: IssueExportRecord) => i.cycles.map(c => c.cycle.name)
/** PD-2015 `get_modules`. */
export const getModulesIssueExport = (i: IssueExportRecord) => i.modules.map(m => m.name)
/** PD-2016 `get_estimate`. */
export const getEstimateIssueExport = (i: IssueExportRecord) => i.estimatePoint?.value ?? ''
/** PD-2017 `get_links`: the title falls back to the URL. */
export const getLinksIssueExport = (i: IssueExportRecord) => i.links.map(link => ({ url: link.url, title: link.title || link.url }))
/** PD-2018 `get_relations`: outgoing relations first, then incoming ones. */
export const getRelationsIssueExport = (i: IssueExportRecord) => [
  ...i.relations.map(r => ({ type: r.relationType, issue: issueIdentifier(r.relatedIssue), direction: 'outgoing' })),
  ...i.related.map(r => ({ type: r.relationType, issue: issueIdentifier(r.issue), direction: 'incoming' }))
]
/** PD-2019 `get_comments`. */
export const getCommentsIssueExport = (i: IssueExportRecord) =>
  i.comments.map(c => ({ comment: c.commentStripped, created_by: c.actor?.name ?? '', created_at: commentTimestamp(c.createdAt) }))

/**
 * `IssueExportSerializer`: one record per issue in the field order of the Plane serializer. `sub_issues_count`,
 * `link_count` and `attachment_count` need queryset annotations that the Plane task never adds, so Plane drops
 * them from its output and so does this serializer.
 */
export function serializeIssueExport(i: IssueExportRecord): ExportRecord {
  return {
    project_name: i.project.name,
    project_identifier: i.project.identifier,
    parent: getParentIssueExport(i),
    identifier: getIdentifierIssueExport(i),
    sequence_id: i.sequenceId,
    name: i.name,
    state_name: i.state?.name ?? '',
    priority: i.priority,
    assignees: getAssigneesIssueExport(i),
    subscribers: getSubscribersIssueExport(i),
    created_by_name: i.createdBy?.name ?? '',
    start_date: i.startDate,
    target_date: i.targetDate,
    completed_at: iso(i.completedAt),
    created_at: iso(i.createdAt),
    updated_at: iso(i.updatedAt),
    archived_at: i.archivedAt,
    estimate: getEstimateIssueExport(i),
    labels: getLabelsIssueExport(i),
    cycles: getCyclesIssueExport(i),
    modules: getModulesIssueExport(i),
    links: getLinksIssueExport(i),
    relations: getRelationsIssueExport(i),
    comments: getCommentsIssueExport(i),
    is_draft: i.isDraft
  }
}

export const serializeIssuesForExport = (rows: IssueExportRecord[]) => rows.map(serializeIssueExport)

type ExporterRow = {
  id: number
  createdAt: Date | null
  updatedAt: Date | null
  project: number[] | null
  provider: string
  status: string
  url: string | null
  initiatedById: number
  token: string
  createdById: number | null
  updatedById: number | null
}

/** PD-1399 `ExporterHistory.__str__`: `provider <workspace name>`. */
export const formatExporterHistory = (row: { provider: string }, workspace: { name: string }) => `${row.provider} <${workspace.name}>`

/** `ExporterHistorySerializer`: every field is read only. `url` is null once the download window is over. */
export function presentExporter(
  row: ExporterRow,
  initiator: { id: number; name: string; image: string | null } | null,
  options: { expired?: boolean } = {}
) {
  return {
    id: row.id,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
    project: row.project ?? [],
    provider: row.provider,
    status: row.status,
    url: options.expired ? null : row.url,
    initiated_by: row.initiatedById,
    initiated_by_detail: initiator ? { id: initiator.id, display_name: initiator.name, avatar: initiator.image } : null,
    token: row.token,
    created_by: row.createdById,
    updated_by: row.updatedById
  }
}
