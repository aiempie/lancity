import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { user } from '@/db/schema/auth'
import { profiles } from '@/db/schema/identity'
import { workspaceMemberInvites, workspaceMembers, workspaceThemes, workspaces } from '@/db/schema/workspace'
import { containsFolded, searchValue } from '@/server/common/unicode'
import { memberUserFields } from '@/server/workspace/presenters'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { WorkspaceListQuery } from '@/types/workspace/schema'

const active = and(eq(workspaceMembers.isActive, true), isNull(workspaceMembers.deletedAt))

// Invitation columns. The token is never selected for API output.
export const invitationFields = {
  id: workspaceMemberInvites.id,
  email: workspaceMemberInvites.email,
  role: workspaceMemberInvites.role,
  message: workspaceMemberInvites.message,
  accepted: workspaceMemberInvites.accepted,
  respondedAt: workspaceMemberInvites.respondedAt,
  createdAt: workspaceMemberInvites.createdAt,
  updatedAt: workspaceMemberInvites.updatedAt,
  createdById: workspaceMemberInvites.createdById,
  workspaceId: workspaceMemberInvites.workspaceId
}

/** WorkSpaceViewSet.get_queryset: workspaces the actor is an active member of, by name, with the member count. */
export function queryWorkspace(db: LancityDb, actor: Actor, filters: WorkspaceListQuery = {}) {
  return db
    .select({
      workspace: workspaces,
      role: workspaceMembers.role,
      totalMembers: sql<number>`(select count(*) from workspace_members m where m.workspace_id = ${workspaces.id}
        and m.is_active = 1 and m.deleted_at is null
        and not exists (select 1 from user_security s where s.user_id = m.member_id and s.is_bot = 1))`.mapWith(Number)
    })
    .from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMembers.memberId, actor.userId),
        active,
        isNull(workspaces.deletedAt),
        filters.search ? containsFolded(sql`${workspaces.name}`, filters.search, searchValue('workspaces', 'name', sql`${workspaces.id}`)) : undefined,
        filters.owner ? eq(workspaces.ownerId, filters.owner) : undefined
      )
    )
    .orderBy(asc(workspaces.name))
}

/** WorkspaceThemeViewSet.get_queryset. */
export const queryWorkspaceTheme = (db: LancityDb, workspaceId: number) =>
  db
    .select()
    .from(workspaceThemes)
    .where(and(eq(workspaceThemes.workspaceId, workspaceId), isNull(workspaceThemes.deletedAt)))
    .orderBy(desc(workspaceThemes.createdAt))

/** WorkSpaceMemberViewSet.get_queryset with the search fields member display name and first name. */
export function queryWorkspaceMember(db: LancityDb, workspaceId: number, search?: string) {
  return db
    .select({
      id: workspaceMembers.id,
      memberId: workspaceMembers.memberId,
      role: workspaceMembers.role,
      isActive: workspaceMembers.isActive,
      createdAt: workspaceMembers.createdAt,
      ...memberUserFields
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.memberId))
    .leftJoin(profiles, eq(profiles.userId, user.id))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        isNull(workspaceMembers.deletedAt),
        search
          ? or(
              containsFolded(sql`${user.username}`, search, searchValue('user', 'username', sql`${user.id}`)),
              containsFolded(sql`${user.name}`, search, searchValue('user', 'name', sql`${user.id}`)),
              containsFolded(sql`${profiles.firstName}`, search, searchValue('profiles', 'first_name', sql`${profiles.id}`))
            )
          : undefined
      )
    )
    .orderBy(desc(workspaceMembers.createdAt), desc(workspaceMembers.id))
}

/** WorkspaceInvitationsViewset.get_queryset (both app and public API): invitations of one workspace. */
export const queryWorkspaceInvitations = (db: LancityDb, workspaceId: number) =>
  db
    .select(invitationFields)
    .from(workspaceMemberInvites)
    .where(and(eq(workspaceMemberInvites.workspaceId, workspaceId), isNull(workspaceMemberInvites.deletedAt)))
    .orderBy(desc(workspaceMemberInvites.createdAt))

/** WorkspaceInvitationsViewset.get_object. */
export async function findWorkspaceInvitations(db: LancityDb, workspaceId: number, id: number) {
  const [invite] = await db
    .select(invitationFields)
    .from(workspaceMemberInvites)
    .where(
      and(
        eq(workspaceMemberInvites.id, id),
        eq(workspaceMemberInvites.workspaceId, workspaceId),
        isNull(workspaceMemberInvites.deletedAt)
      )
    )
  return invite
}

/** UserWorkspaceInvitationsViewSet.get_queryset: invitations addressed to one e-mail address. */
export const queryUserWorkspaceInvitations = (db: LancityDb, email: string) =>
  db
    .select({ ...invitationFields, workspaceName: workspaces.name, workspaceSlug: workspaces.slug })
    .from(workspaceMemberInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMemberInvites.workspaceId))
    .where(
      and(
        sql`lower(${workspaceMemberInvites.email}) = ${email.toLowerCase()}`,
        isNull(workspaceMemberInvites.deletedAt),
        isNull(workspaces.deletedAt)
      )
    )
    .orderBy(desc(workspaceMemberInvites.createdAt))
