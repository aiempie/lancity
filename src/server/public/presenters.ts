import type { PublicBoard } from '@/server/public/board'

type ProjectMeta = Record<string, unknown>

/** PD-1387 `DeployBoard.__str__`: `<entity name> <project name>` for logs and labels. */
export const formatDeployBoard = (entityName: string | null, projectName: string) =>
  `${entityName ?? 'project'} <${projectName}>`

/**
 * `DeployBoardSerializer`: the settings a public page needs to decide what to show. Internal ids of the audit users
 * are not included.
 */
export function toDeployBoardSettings(board: PublicBoard, project: ProjectMeta) {
  return {
    id: board.id,
    anchor: board.anchor,
    entity_name: 'project',
    entity_identifier: board.projectId,
    project: board.projectId,
    workspace: board.workspaceId,
    intake: board.intakeId,
    is_comments_enabled: board.isCommentsEnabled,
    is_reactions_enabled: board.isReactionsEnabled,
    is_votes_enabled: board.isVotesEnabled,
    is_activity_enabled: board.isActivityEnabled,
    view_props: board.viewProps,
    created_at: board.createdAt,
    updated_at: board.updatedAt,
    project_details: project,
    workspace_detail: { id: board.workspaceId, name: board.workspaceName, slug: board.workspaceSlug }
  }
}
