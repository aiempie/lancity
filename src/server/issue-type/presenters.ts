import { formatProject } from '@/server/project/presenters'
import type { IssueType } from '@/types/planning/schema'
import type { Project, Workspace } from '@/types/workspace/schema'

/** PD-1441 `IssueType.__str__`. */
export function formatIssueType(issueType: Pick<IssueType, 'name'>): string {
  return issueType.name
}

/** PD-1442 `ProjectIssueType.__str__`. */
export function formatProjectIssueType(
  project: Pick<Project, 'name'>,
  workspace: Pick<Workspace, 'name'>,
  issueType: Pick<IssueType, 'name'>
): string {
  return `${formatProject(project, workspace)} - ${formatIssueType(issueType)}`
}
