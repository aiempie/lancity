import type { intakeIssues } from '@/db/schema/planning'

type IntakeIssueRow = typeof intakeIssues.$inferSelect
export type IntakeIssueLite = {
  id: number
  name: string
  priority: string
  sequenceId: number
  projectId: number
  createdAt: Date
  createdById: number | null
}

/** PD-1403 `Intake.__str__` and PD-1404 `IntakeIssue.__str__`, kept for logs and labels. */
export const formatIntake = (name: string, projectName: string) => `${name} <${projectName}>`
export const formatIntakeIssue = (issueName: string, intakeName: string) => `${issueName} <${intakeName}>`

/** `IssueIntakeSerializer`: the few issue fields a triage card needs. */
export function toIssueIntake(issue: IntakeIssueLite, labelIds: number[]) {
  return {
    id: issue.id,
    name: issue.name,
    priority: issue.priority,
    sequenceId: issue.sequenceId,
    projectId: issue.projectId,
    createdAt: issue.createdAt,
    labelIds,
    createdBy: issue.createdById
  }
}

/** PD-0318 `IntakeIssueSerializer.to_representation` (app list and create). */
export function toIntakeIssueResponse(row: IntakeIssueRow, issue: IntakeIssueLite, labelIds: number[]) {
  return {
    id: row.id,
    status: row.status,
    duplicateTo: row.duplicateToId,
    snoozedTill: row.snoozedTill,
    source: row.source,
    issue: toIssueIntake(issue, labelIds),
    createdBy: row.createdById
  }
}

/** PD-0319 `IntakeIssueDetailSerializer.to_representation` (app retrieve and update). */
export function toIntakeIssueDetailResponse(
  row: IntakeIssueRow,
  issue: Record<string, unknown>,
  duplicate: ReturnType<typeof toIssueIntake> | null
) {
  return {
    id: row.id,
    status: row.status,
    duplicateTo: row.duplicateToId,
    snoozedTill: row.snoozedTill,
    duplicateIssueDetail: duplicate,
    source: row.source,
    issue
  }
}

/** Public API `IntakeIssueSerializer` (`fields = "__all__"` plus `issue_detail` and `inbox`). */
export function toIntakeIssueApiResponse(row: IntakeIssueRow, issueDetail: Record<string, unknown>) {
  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdById,
    updatedBy: row.updatedById,
    status: row.status,
    snoozedTill: row.snoozedTill,
    source: row.source,
    sourceEmail: row.sourceEmail,
    externalSource: row.externalSource,
    externalId: row.externalId,
    extra: row.extra,
    workspace: row.workspaceId,
    project: row.projectId,
    intake: row.intakeId,
    issue: row.issueId,
    duplicateTo: row.duplicateToId,
    issueDetail,
    inbox: row.intakeId
  }
}
