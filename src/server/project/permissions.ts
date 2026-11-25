import { and, eq, isNull } from 'drizzle-orm'
import { projectMembers, projects, workspaceMembers, workspaces } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

/** Project entities require active membership even when project metadata is publicly visible within the workspace. */
export async function requireProjectAccess(
  db: LancityDb,
  actor: Actor,
  workspaceSlug: string,
  projectId: number,
  minimumRole: 5 | 15 | 20 = 5
) {
  const [row] = await db
    .select({
      workspace: workspaces,
      project: projects,
      membership: projectMembers,
      workspaceMembership: workspaceMembers
    })
    .from(projects)
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.memberId, actor.userId))
    )
    .innerJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, projects.id),
        eq(projectMembers.workspaceId, workspaces.id),
        eq(projectMembers.memberId, actor.userId)
      )
    )
    .where(
      and(
        eq(workspaces.slug, workspaceSlug),
        eq(projects.id, projectId),
        isNull(workspaces.deletedAt),
        isNull(projects.deletedAt),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt)
      )
    )
    .limit(1)
  if (!row) throw new ServiceError(404, 'PROJECT_NOT_FOUND', 'Project not found')
  const role = row.workspaceMembership.role === 20 ? 20 : row.membership.role
  if (role < minimumRole) throw new ServiceError(403, 'FORBIDDEN', 'Insufficient project permissions')
  return row
}

export type AccessMode = 'read' | 'create' | 'write'
type ProjectAccess = { workspaceRole: number | null; projectRole: number | null }

/** Active workspace and (optional) project roles of the actor. Both are null when no active membership exists. */
export async function loadProjectAccess(
  db: LancityDb,
  actor: Actor,
  workspaceSlug: string,
  projectId?: number
): Promise<ProjectAccess> {
  const [workspaceRow] = await db
    .select({ id: workspaces.id, role: workspaceMembers.role })
    .from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaces.slug, workspaceSlug),
        isNull(workspaces.deletedAt),
        eq(workspaceMembers.memberId, actor.userId),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt)
      )
    )
  if (!workspaceRow) return { workspaceRole: null, projectRole: null }
  if (projectId === undefined) return { workspaceRole: workspaceRow.role, projectRole: null }
  const [projectRow] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.workspaceId, workspaceRow.id),
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.memberId, actor.userId),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt)
      )
    )
  return { workspaceRole: workspaceRow.role, projectRole: projectRow?.role ?? null }
}

/** PD-0281 / PD-1969 `ProjectBasePermission`: read for workspace members, create for members and admins, write for project admins. */
export function hasPermissionProjectBasePermission(access: ProjectAccess, mode: AccessMode) {
  if (access.workspaceRole === null) return false
  if (mode === 'read') return true
  if (mode === 'create') return access.workspaceRole >= 15
  return access.projectRole === 20 || (access.projectRole !== null && access.workspaceRole === 20)
}

/** PD-0282 `ProjectArchiveUnarchivePermission`: project admin or member, or any project member who is a workspace admin. */
export function hasPermissionProjectArchiveUnarchivePermission(access: ProjectAccess) {
  if (access.workspaceRole === null || access.projectRole === null) return false
  return access.projectRole >= 15 || access.workspaceRole === 20
}

/** PD-0283 / PD-1970 `ProjectMemberPermission`: any member reads, project admins and members write. */
export function hasPermissionProjectMemberPermission(access: ProjectAccess, mode: AccessMode) {
  if (access.projectRole === null) return false
  return mode === 'read' || access.projectRole >= 15
}

/** PD-0284 / PD-1971 `ProjectEntityPermission`: same rules as the member permission. */
export function hasPermissionProjectEntityPermission(access: ProjectAccess, mode: AccessMode) {
  return hasPermissionProjectMemberPermission(access, mode)
}

/** PD-0285 / PD-1972 `ProjectAdminPermission`. */
export function hasPermissionProjectAdminPermission(access: ProjectAccess) {
  return access.projectRole === 20 || (access.projectRole !== null && access.workspaceRole === 20)
}

/** PD-0286 / PD-1973 `ProjectLitePermission`: any active project member. */
export function hasPermissionProjectLitePermission(access: ProjectAccess) {
  return access.projectRole !== null
}

/** PD-0190 `ProjectMemberListCreateAPIEndpoint.get_permissions`: reads need membership, writes need a project admin. */
export function getPermissionsProjectMemberListCreateAPI(access: ProjectAccess, method: 'GET' | 'WRITE') {
  return method === 'GET'
    ? hasPermissionProjectMemberPermission(access, 'read')
    : hasPermissionProjectAdminPermission(access)
}

/** PD-0223 `has_workspace_role`: the actor is an active workspace member whose role satisfies the predicate. */
export function hasWorkspaceRole(access: ProjectAccess, predicate: (role: number) => boolean) {
  return access.workspaceRole !== null && predicate(access.workspaceRole)
}

/** Workspace, project and the actor's roles in one query. Any missing piece is reported as 404 to avoid leaking existence. */
export async function loadProjectScope(db: LancityDb, actor: Actor, workspaceSlug: string, projectId: number) {
  const [row] = await db
    .select({
      workspace: workspaces,
      project: projects,
      workspaceRole: workspaceMembers.role,
      projectRole: projectMembers.role
    })
    .from(projects)
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.memberId, actor.userId),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt)
      )
    )
    .leftJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, projects.id),
        eq(projectMembers.memberId, actor.userId),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt)
      )
    )
    .where(
      and(
        eq(workspaces.slug, workspaceSlug),
        eq(projects.id, projectId),
        isNull(workspaces.deletedAt),
        isNull(projects.deletedAt)
      )
    )
    .limit(1)
  if (!row) throw new ServiceError(404, 'PROJECT_NOT_FOUND', 'Project not found')
  return { ...row, access: { workspaceRole: row.workspaceRole, projectRole: row.projectRole } as ProjectAccess }
}

export function forbidden(allowed: boolean, message = 'Insufficient project permissions') {
  if (!allowed) throw new ServiceError(403, 'FORBIDDEN', message)
}
