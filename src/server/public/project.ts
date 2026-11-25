import { and, asc, eq, isNull } from 'drizzle-orm'
import { user } from '@/db/schema/auth'
import { deployBoards } from '@/db/schema/content'
import { projectMembers, projects, workspaces } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import { requireBoard } from '@/server/public/board'
import { toDeployBoardSettings } from '@/server/public/presenters'
import { getPublicProjectMeta } from '@/server/public/service'
import type { LancityDb } from '@/types/database/schema'

/** PD-1683 `ProjectDeployBoardPublicSettingsEndpoint.get` and PD-1685: the settings of one board. */
export async function getPublicBoardSettings(db: LancityDb, anchor: string) {
  const board = await requireBoard(db, anchor)
  return toDeployBoardSettings(board, await getPublicProjectMeta(db, anchor))
}

/**
 * PD-1684 `WorkspaceProjectDeployBoardEndpoint.get`: the published projects of a workspace. The Plane code reads the
 * workspace from the board anchor and never calls `values_list`, so it cannot run; the intent is the project cards of
 * the public workspace page, keyed by the workspace slug in the route.
 */
export async function listWorkspaceProjectBoards(db: LancityDb, slug: string) {
  return db
    .select({
      id: projects.id,
      identifier: projects.identifier,
      name: projects.name,
      description: projects.description,
      emoji: projects.emoji,
      icon_prop: projects.iconProp,
      cover_image: projects.coverImage,
      anchor: deployBoards.anchor
    })
    .from(deployBoards)
    .innerJoin(
      projects,
      and(eq(projects.id, deployBoards.projectId), eq(projects.workspaceId, deployBoards.workspaceId))
    )
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .where(
      and(
        eq(workspaces.slug, slug),
        isNull(workspaces.deletedAt),
        eq(deployBoards.entityName, 'project'),
        eq(deployBoards.entityIdentifier, projects.id),
        eq(deployBoards.isDisabled, false),
        isNull(deployBoards.deletedAt),
        isNull(projects.deletedAt),
        isNull(projects.archivedAt)
      )
    )
    .orderBy(asc(projects.name), asc(projects.id))
}

/** PD-1685 `WorkspaceProjectAnchorEndpoint.get`: the board of a project, found by workspace slug and project id. */
export async function getWorkspaceProjectAnchor(db: LancityDb, slug: string, projectId: number) {
  const [board] = await db
    .select({ anchor: deployBoards.anchor })
    .from(deployBoards)
    .innerJoin(workspaces, eq(workspaces.id, deployBoards.workspaceId))
    .where(
      and(
        eq(workspaces.slug, slug),
        eq(deployBoards.projectId, projectId),
        eq(deployBoards.entityIdentifier, projectId),
        eq(deployBoards.entityName, 'project'),
        isNull(deployBoards.deletedAt)
      )
    )
    .limit(1)
  if (!board) throw new ServiceError(404, 'BOARD_NOT_FOUND', 'Project is not published')
  return getPublicBoardSettings(db, board.anchor)
}

/** PD-1686 `ProjectMembersEndpoint.get`: active members of the board project, with a display name and avatar only. */
export async function listPublicBoardMembers(db: LancityDb, anchor: string) {
  const board = await requireBoard(db, anchor)
  const rows = await db
    .select({
      id: projectMembers.id,
      member: projectMembers.memberId,
      name: user.name,
      username: user.username,
      image: user.image
    })
    .from(projectMembers)
    .innerJoin(user, eq(user.id, projectMembers.memberId))
    .where(
      and(
        eq(projectMembers.projectId, board.projectId),
        eq(projectMembers.workspaceId, board.workspaceId),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt)
      )
    )
    .orderBy(asc(projectMembers.id))
  return rows.map(row => ({
    id: row.id,
    member: row.member,
    member__display_name: row.username ?? row.name,
    member__avatar: row.image
  }))
}
