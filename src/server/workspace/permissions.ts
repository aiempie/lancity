import { and, eq, inArray, isNull } from 'drizzle-orm'
import { workspaceMembers, workspaces } from '@/db/schema/workspace'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

// plane/app/permissions/workspace.py (and the identical plane/utils/permissions/workspace.py).
const ADMIN = 20
const MEMBER = 15
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']

async function hasWorkspaceRole(db: LancityDb, actor: Actor, slug: string, roles?: number[]): Promise<boolean> {
  const [row] = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaces.slug, slug),
        isNull(workspaces.deletedAt),
        eq(workspaceMembers.memberId, actor.userId),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt),
        roles ? inArray(workspaceMembers.role, roles) : undefined
      )
    )
    .limit(1)
  return Boolean(row)
}

/** WorkSpaceBasePermission: anyone creates, safe methods are open, PUT/PATCH/DELETE need an admin. */
export async function hasPermissionWorkspaceBasePermission(db: LancityDb, actor: Actor, slug: string, method: string) {
  const upper = method.toUpperCase()
  if (upper === 'POST' || SAFE_METHODS.includes(upper)) return true
  if (['PUT', 'PATCH', 'DELETE'].includes(upper)) return hasWorkspaceRole(db, actor, slug, [ADMIN])
  return false
}
/** WorkspaceOwnerPermission: Plane checks the admin role, not workspace.owner. */
export const hasPermissionWorkspaceOwnerPermission = (db: LancityDb, actor: Actor, slug: string) =>
  hasWorkspaceRole(db, actor, slug, [ADMIN])
/** WorkSpaceAdminPermission: despite the name Plane accepts admins and members. */
export const hasPermissionWorkspaceAdminPermission = (db: LancityDb, actor: Actor, slug: string) =>
  hasWorkspaceRole(db, actor, slug, [ADMIN, MEMBER])
/** WorkspaceEntityPermission: any active member reads, admins and members write. */
export async function hasPermissionWorkspaceEntityPermission(
  db: LancityDb,
  actor: Actor,
  slug: string,
  method: string
) {
  if (SAFE_METHODS.includes(method.toUpperCase())) return hasWorkspaceRole(db, actor, slug)
  return hasWorkspaceRole(db, actor, slug, [ADMIN, MEMBER])
}
/** WorkspaceViewerPermission, WorkspaceUserPermission and WorkspaceMemberPermission: any active member. */
export const hasPermissionWorkspaceViewerPermission = (db: LancityDb, actor: Actor, slug: string) =>
  hasWorkspaceRole(db, actor, slug)
export const hasPermissionWorkspaceUserPermission = hasPermissionWorkspaceViewerPermission
export const hasPermissionWorkspaceMemberPermission = hasPermissionWorkspaceViewerPermission
