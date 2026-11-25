import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { user } from '@/db/schema/auth'
import { projectMembers, projects, workspaceMembers, workspaces } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import { appOrigin, queueProjectMail } from '@/server/project/events'
import { projectAdditionEmail } from '@/server/project/emails'
import { memberDefaults, userPropertyInsert } from '@/server/project/model-rules'
import {
  forbidden,
  hasPermissionProjectAdminPermission,
  hasPermissionProjectMemberPermission,
  loadProjectAccess,
  loadProjectScope,
  requireProjectAccess
} from '@/server/project/permissions'
import { notBot, queryProjectMember, queryProjectMemberPreference } from '@/server/project/queries'
import { pageEnvelope, pageWindow } from '@/server/workspace/pagination'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { ProjectRole, UpdateProjectMemberInput } from '@/types/project/schema'

/** Personal columns of a membership row, only returned to the member who owns it. */
const PERSONAL_MEMBER_FIELDS = ['preferences', 'viewProps', 'defaultProps'] as const

/** PD-0768 `_without_personal_fields`. */
export function withoutPersonalFields<T extends Record<string, unknown>>(data: T, ownerId: number | null, actor: Actor) {
  type Personal = (typeof PERSONAL_MEMBER_FIELDS)[number] & keyof T
  type Result = Omit<T, Personal> & Partial<Pick<T, Personal>>
  if (ownerId === actor.userId) return data as Result
  const copy: Record<string, unknown> = { ...data }
  for (const field of PERSONAL_MEMBER_FIELDS) delete copy[field]
  return copy as Result
}

/** Workspace roles of active workspace members, by user id. */
async function workspaceRoles(db: LancityDb, workspaceId: number, memberIds: number[]) {
  const rows = await db
    .select({ memberId: workspaceMembers.memberId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        inArray(workspaceMembers.memberId, memberIds),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt)
      )
    )
  return new Map(rows.map(row => [row.memberId, row.role]))
}

/** A project role cannot fall below an admin's workspace role nor exceed a guest's (PD-0033, PD-0034, PD-0770). */
function assertRoleMatchesWorkspace(workspaceRole: number | undefined, role: number) {
  if (workspaceRole === undefined) throw new ServiceError(400, 'NOT_WORKSPACE_MEMBER', 'User is not an active workspace member')
  if ((workspaceRole === 5 && role !== 5) || (workspaceRole === 20 && role !== 20))
    throw new ServiceError(400, 'INVALID_MEMBER_ROLE', 'Project role conflicts with workspace role')
}

/** PD-0771 `ProjectMemberViewSet.list`: active members who are still active workspace members. */
export async function listProjectMembers(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const access = await requireProjectAccess(db, actor, slug, projectId)
  const members = await queryProjectMember(
    db,
    access.workspace.id,
    projectId,
    eq(projectMembers.isActive, true),
    sql`exists (select 1 from workspace_members wm where wm.workspace_id = ${projectMembers.workspaceId}
      and wm.member_id = ${projectMembers.memberId} and wm.is_active = 1 and wm.deleted_at is null)`
  )
  return members.map(member => ({
    id: member.id,
    memberId: member.memberId,
    role: member.role,
    originalRole: member.role,
    createdAt: member.createdAt,
    name: member.name,
    image: member.image,
    email: access.membership.role === 5 && member.memberId !== actor.userId ? null : member.email
  }))
}

/** PD-0772 `ProjectMemberViewSet.retrieve`: guests get the role view, others the admin view. Personal fields stay private. */
export async function getProjectMember(db: LancityDb, actor: Actor, slug: string, projectId: number, id: number) {
  const access = await requireProjectAccess(db, actor, slug, projectId)
  const [member] = await queryProjectMember(
    db,
    access.workspace.id,
    projectId,
    eq(projectMembers.id, id),
    eq(projectMembers.isActive, true)
  )
  if (!member) throw new ServiceError(404, 'MEMBER_NOT_FOUND', 'Project member not found')
  const own = member.memberId === actor.userId
  const base = {
    id: member.id,
    memberId: member.memberId,
    role: member.role,
    originalRole: member.role,
    createdAt: member.createdAt,
    name: member.name,
    image: member.image,
    email: access.membership.role === 5 && !own ? null : member.email
  }
  if (access.membership.role <= 5) return base
  return withoutPersonalFields(
    {
      ...base,
      comment: member.comment,
      isActive: member.isActive,
      sortOrder: member.sortOrder,
      viewProps: member.viewProps,
      defaultProps: member.defaultProps,
      preferences: member.preferences
    },
    member.memberId,
    actor
  )
}

/**
 * PD-0770 `ProjectMemberViewSet.create`: add several members at once. Existing rows are reactivated with the new role,
 * new members get a user-property row, and every member is notified by email. Project admins only.
 */
export async function createProjectMember(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  members: { memberId: number; role: ProjectRole }[]
) {
  const { workspace, project, access } = await loadProjectScope(db, actor, slug, projectId)
  forbidden(hasPermissionProjectAdminPermission(access))
  if (!members.length) throw new ServiceError(400, 'MEMBERS_REQUIRED', 'At least one member is required')
  // The last role given for a user wins, as the member_roles dictionary in Plane.
  const requested = [...new Map(members.map(member => [member.memberId, member.role])).entries()]
  const roles = await workspaceRoles(db, workspace.id, requested.map(([memberId]) => memberId))
  for (const [memberId, role] of requested) assertRoleMatchesWorkspace(roles.get(memberId), role)
  const written = await db.batch([
    ...requested.flatMap(([memberId, role]) => [
      db
        .insert(projectMembers)
        .values({
          workspaceId: workspace.id,
          projectId,
          memberId,
          role,
          ...memberDefaults(),
          createdById: actor.userId,
          updatedById: actor.userId
        })
        .onConflictDoNothing(),
      db
        .update(projectMembers)
        .set({ role, isActive: true, updatedById: actor.userId })
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.memberId, memberId),
            isNull(projectMembers.deletedAt)
          )
        ),
      userPropertyInsert(db, { projectId, userId: memberId, actorId: actor.userId })
    ]),
    db
      .select({ id: projectMembers.id, memberId: projectMembers.memberId, role: projectMembers.role, email: user.email })
      .from(projectMembers)
      .innerJoin(user, eq(user.id, projectMembers.memberId))
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          inArray(projectMembers.memberId, requested.map(([memberId]) => memberId)),
          isNull(projectMembers.deletedAt)
        )
      )
  ] as unknown as Parameters<typeof db.batch>[0])
  const rows = written[written.length - 1] as unknown as { id: number; memberId: number; role: number; email: string }[]
  const [inviter] = await db.select({ name: user.name }).from(user).where(eq(user.id, actor.userId))
  const origin = await appOrigin()
  await Promise.all(
    rows.map(row =>
      queueProjectMail(
        row.email,
        projectAdditionEmail({
          inviter: inviter?.name ?? 'A teammate',
          projectName: project.name,
          workspaceName: workspace.name,
          projectUrl: `${origin}/issues?${new URLSearchParams({ slug, projectId: String(projectId) })}`
        })
      )
    )
  )
  return rows.map(row => ({ id: row.id, memberId: row.memberId, role: row.role }))
}

/** Add one member. Unlike the bulk call, an already active member is a conflict. */
export async function addProjectMember(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  memberId: number,
  role: ProjectRole
) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 20)
  const [existing] = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.memberId, memberId),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt)
      )
    )
  if (existing) throw new ServiceError(409, 'MEMBER_EXISTS', 'Project member already exists')
  const roles = await workspaceRoles(db, workspace.id, [memberId])
  assertRoleMatchesWorkspace(roles.get(memberId), role)
  const [created] = await createProjectMember(db, actor, slug, projectId, [{ memberId, role }])
  return created
}

type TargetRow = typeof projectMembers.$inferSelect

async function findMemberRow(db: LancityDb, projectId: number, id: number) {
  const [target] = await db
    .select()
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.id, id),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt)
      )
    )
  if (!target) throw new ServiceError(404, 'MEMBER_NOT_FOUND', 'Project member not found')
  return target as TargetRow
}

/**
 * PD-0773 `ProjectMemberViewSet.partial_update`. Project admins (or workspace admins) edit a row; only the owner edits
 * personal fields. Unless the actor is a workspace admin they cannot change their own row, touch an equal or higher role,
 * or grant a role equal to or above their own.
 */
export async function patchProjectMember(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  id: number,
  input: UpdateProjectMemberInput
) {
  const access = await requireProjectAccess(db, actor, slug, projectId, 20)
  const isWorkspaceAdmin = access.workspaceMembership.role === 20
  const requesterRole = isWorkspaceAdmin ? 20 : access.membership.role
  const target = await findMemberRow(db, projectId, id)
  const own = target.memberId === actor.userId
  if (!own && PERSONAL_MEMBER_FIELDS.some(field => input[field] !== undefined))
    throw new ServiceError(403, 'FORBIDDEN', "You cannot update another member's personal settings")
  const privileged = input.role !== undefined || input.isActive !== undefined
  if (privileged) {
    if (own && !isWorkspaceAdmin) throw new ServiceError(400, 'CANNOT_UPDATE_SELF', 'You cannot update your own role')
    if (target.role >= requesterRole && !isWorkspaceAdmin)
      throw new ServiceError(403, 'FORBIDDEN', 'You cannot update a member with a role equal to or higher than your own')
  }
  if (input.role !== undefined) {
    if (input.role >= requesterRole && !isWorkspaceAdmin)
      throw new ServiceError(403, 'FORBIDDEN', 'You cannot assign a role equal to or higher than your own')
    const roles = await workspaceRoles(db, target.workspaceId, [target.memberId!])
    assertRoleMatchesWorkspace(roles.get(target.memberId!), input.role)
  }
  const [changed] = await db
    .update(projectMembers)
    .set({
      ...(input.role === undefined ? {} : { role: input.role }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      ...(input.comment === undefined ? {} : { comment: input.comment }),
      ...(input.viewProps === undefined ? {} : { viewProps: input.viewProps }),
      ...(input.defaultProps === undefined ? {} : { defaultProps: input.defaultProps }),
      ...(input.preferences === undefined ? {} : { preferences: input.preferences }),
      ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
      updatedById: actor.userId
    })
    .where(
      and(
        eq(projectMembers.id, target.id),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt)
      )
    )
    .returning()
  // Plane has no last-admin rule on this endpoint (only leave and workspace member removal guard admins).
  if (!changed) throw new ServiceError(409, 'MEMBER_CHANGED', 'Project membership changed')
  return withoutPersonalFields(
    { id: changed.id, memberId: changed.memberId, role: changed.role, isActive: changed.isActive, comment: changed.comment, sortOrder: changed.sortOrder, viewProps: changed.viewProps, defaultProps: changed.defaultProps, preferences: changed.preferences },
    changed.memberId,
    actor
  )
}

/**
 * PD-0774 `ProjectMemberViewSet.destroy`: deactivate a member. Nobody removes themselves here (use leave) and nobody removes a
 * higher role.
 */
export async function deleteProjectMember(db: LancityDb, actor: Actor, slug: string, projectId: number, id: number) {
  const access = await requireProjectAccess(db, actor, slug, projectId, 20)
  const requesterRole = access.workspaceMembership.role === 20 ? 20 : access.membership.role
  const target = await findMemberRow(db, projectId, id)
  if (target.memberId === actor.userId)
    throw new ServiceError(400, 'CANNOT_REMOVE_SELF', 'You cannot remove yourself from the project. Please use leave project')
  if (requesterRole < target.role)
    throw new ServiceError(400, 'CANNOT_REMOVE_HIGHER_ROLE', 'You cannot remove a user having role higher than you')
  await deactivateMember(db, actor, projectId, target)
}

/** Deactivate a row (ProjectMemberViewSet.destroy has no last-admin rule in Plane). */
export async function deactivateMember(db: LancityDb, actor: Actor, _projectId: number, target: TargetRow) {
  const [changed] = await db
    .update(projectMembers)
    .set({ isActive: false, updatedById: actor.userId })
    .where(and(eq(projectMembers.id, target.id), eq(projectMembers.isActive, true), isNull(projectMembers.deletedAt)))
    .returning({ id: projectMembers.id })
  if (!changed) throw new ServiceError(409, 'MEMBER_CHANGED', 'Project membership changed')
}

/** Kept for existing callers: a role change, or removal when `role` is null. */
export async function updateProjectMember(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  memberId: number,
  role: ProjectRole | null
) {
  if (role === null) return deleteProjectMember(db, actor, slug, projectId, memberId)
  const changed = await patchProjectMember(db, actor, slug, projectId, memberId, { role })
  return { id: changed.id, memberId: changed.memberId, role: changed.role }
}

/** PD-0776 `ProjectMemberUserEndpoint.get`: the caller's own membership row. */
export async function getProjectMemberUser(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId)
  const [member] = await queryProjectMember(
    db,
    workspace.id,
    projectId,
    eq(projectMembers.memberId, actor.userId),
    eq(projectMembers.isActive, true)
  )
  if (!member) throw new ServiceError(404, 'MEMBER_NOT_FOUND', 'Project member not found')
  return {
    id: member.id,
    memberId: member.memberId,
    role: member.role,
    comment: member.comment,
    isActive: member.isActive,
    sortOrder: member.sortOrder,
    viewProps: member.viewProps,
    defaultProps: member.defaultProps,
    preferences: member.preferences,
    createdAt: member.createdAt,
    workspaceId: member.workspaceId,
    projectId: member.projectId
  }
}

/** PD-0777 `UserProjectRolesEndpoint.get`: the actor's role in every project of the workspace. */
export async function getUserProjectRoles(db: LancityDb, actor: Actor, slug: string) {
  const access = await loadProjectAccess(db, actor, slug)
  if (access.workspaceRole === null) throw new ServiceError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found')
  const rows = await db
    .select({ projectId: projectMembers.projectId, role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(workspaces, eq(workspaces.id, projectMembers.workspaceId))
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(
      and(
        eq(workspaces.slug, slug),
        eq(projectMembers.memberId, actor.userId),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt),
        isNull(projects.deletedAt)
      )
    )
  return Object.fromEntries(rows.map(row => [String(row.projectId), row.role]))
}

/** Own-preferences access shared by PD-0779 and PD-0780: the path member must be the caller. */
async function ownPreferences(db: LancityDb, actor: Actor, slug: string, projectId: number, memberId: number) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId)
  if (memberId !== actor.userId)
    throw new ServiceError(403, 'FORBIDDEN', "You cannot access another member's preferences.")
  const [row] = await queryProjectMemberPreference(db, workspace.id, projectId, memberId)
  if (!row) throw new ServiceError(404, 'MEMBER_NOT_FOUND', 'Project member not found')
  return row
}

/** PD-0780 `ProjectMemberPreferenceEndpoint.get`. */
export async function getProjectMemberPreference(db: LancityDb, actor: Actor, slug: string, projectId: number, memberId: number) {
  const row = await ownPreferences(db, actor, slug, projectId, memberId)
  return { preferences: row.preferences, projectId: row.projectId, memberId: row.memberId, workspaceId: row.workspaceId }
}

/** PD-0779 `ProjectMemberPreferenceEndpoint.patch` with PD-0359: the request is merged into the stored preferences. */
export async function updateProjectMemberPreference(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  memberId: number,
  patch: Record<string, unknown>
) {
  const row = await ownPreferences(db, actor, slug, projectId, memberId)
  const preferences = { ...(row.preferences as Record<string, unknown>), ...patch }
  await db
    .update(projectMembers)
    .set({ preferences: preferences as never, updatedById: actor.userId })
    .where(eq(projectMembers.id, row.id))
  return { preferences }
}

/** Lite user fields of the public API (`UserLiteSerializer`). Email is hidden from workspace guests (PD-0188). */
function userLite(row: { id: number | null; name: string; email: string; image: string | null }, showEmail: boolean) {
  return { id: row.id, name: row.name, image: row.image, ...(showEmail ? { email: row.email } : {}) }
}

/** PD-0198 `ProjectMemberLiteAPIEndpoint.get` and PD-0188 `member_fields` (email only for non-guest workspace members): paginated flat list for pickers. Removed members are left out. */
export async function listProjectMembersLiteApi(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  query: { cursor?: string; perPage?: number }
) {
  const { workspace, access } = await loadProjectScope(db, actor, slug, projectId)
  forbidden(hasPermissionProjectMemberPermission(access, 'read'))
  const win = pageWindow(query.cursor, query.perPage ?? 20, 100)
  const rows = await queryProjectMember(db, workspace.id, projectId, eq(projectMembers.isActive, true))
    .limit(win.limit + 1)
    .offset(win.offset)
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.workspaceId, workspace.id),
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt),
        notBot(projectMembers.memberId)
      )
    )
  const showEmail = (access.workspaceRole ?? 0) > 5
  return pageEnvelope(
    rows.map(row => ({ ...userLite({ ...row, id: row.memberId }, showEmail), displayName: row.name })),
    total,
    win
  )
}

/** Join a discoverable project using the caller's current workspace role. */
export async function joinProject(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const client = db.$client
  // The role, visibility and active workspace membership are evaluated in the write statement.
  const [membership] = await client.batch([
    client
      .prepare(
        `insert into project_members (workspace_id, project_id, member_id, role, created_by_id, updated_by_id)
      select w.id, p.id, ?, wm.role, ?, ? from projects p
      join workspaces w on w.id = p.workspace_id
      join workspace_members wm on wm.workspace_id = w.id and wm.member_id = ?
      where w.slug = ? and p.id = ? and w.deleted_at is null and p.deleted_at is null and p.archived_at is null
        and wm.is_active = 1 and wm.deleted_at is null and wm.role in (15, 20)
        and (p.network = 2 or wm.role = 20)
      on conflict (project_id, member_id) where deleted_at is null do update
      set is_active = 1, role = excluded.role, updated_by_id = excluded.updated_by_id,
        updated_at = cast(unixepoch('subsec') * 1000 as integer)
      where project_members.is_active = 0
      returning id, member_id, role`
      )
      .bind(actor.userId, actor.userId, actor.userId, actor.userId, slug, projectId),
    client
      .prepare(
        `insert into project_user_properties (workspace_id, project_id, user_id, created_by_id)
      select w.id, p.id, ?, ? from projects p join workspaces w on w.id = p.workspace_id
      join workspace_members wm on wm.workspace_id = w.id and wm.member_id = ?
      join project_members pm on pm.workspace_id = w.id and pm.project_id = p.id and pm.member_id = ?
      where w.slug = ? and p.id = ? and w.deleted_at is null and p.deleted_at is null and p.archived_at is null
        and wm.is_active = 1 and wm.deleted_at is null and wm.role in (15, 20)
        and (p.network = 2 or wm.role = 20) and pm.is_active = 1 and pm.deleted_at is null
      on conflict do nothing`
      )
      .bind(actor.userId, actor.userId, actor.userId, actor.userId, slug, projectId)
  ])
  const changed = membership.results[0] as { id: number; member_id: number; role: number } | undefined
  if (changed) return { id: changed.id, memberId: changed.member_id, role: changed.role }

  // Existing active membership is an idempotent success, but never elevate a guest or join a hidden project.
  const [row] = await db
    .select({
      membership: projectMembers,
      workspaceRole: workspaceMembers.role,
      network: projects.network,
      archivedAt: projects.archivedAt
    })
    .from(projects)
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.memberId, actor.userId))
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
        eq(projects.id, projectId),
        eq(workspaces.slug, slug),
        isNull(projects.deletedAt),
        isNull(workspaces.deletedAt),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt)
      )
    )
    .limit(1)
  if (!row || row.archivedAt) throw new ServiceError(404, 'PROJECT_NOT_FOUND', 'Project not found')
  if (row.workspaceRole < 15 || (row.network === 0 && row.workspaceRole !== 20))
    throw new ServiceError(403, 'FORBIDDEN', 'Cannot join this project')
  if (!row.membership) throw new ServiceError(409, 'PROJECT_CHANGED', 'Project access changed')
  return { id: row.membership.id, memberId: row.membership.memberId, role: row.membership.role }
}

/** An administrator may leave only when another active administrator remains. */
export async function leaveProject(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  await requireProjectAccess(db, actor, slug, projectId)
  const [changed] = await db
    .update(projectMembers)
    .set({ isActive: false, updatedById: actor.userId })
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.memberId, actor.userId),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt),
        sql`exists (select 1 from projects p join workspaces w on w.id = p.workspace_id
      join workspace_members wm on wm.workspace_id = w.id and wm.member_id = ${actor.userId}
      where p.id = ${projectMembers.projectId} and p.workspace_id = ${projectMembers.workspaceId}
        and p.deleted_at is null and w.deleted_at is null and w.slug = ${slug}
        and wm.is_active = 1 and wm.deleted_at is null)`,
        sql`(${projectMembers.role} != 20 or exists (select 1 from project_members other
      join workspace_members wm on wm.workspace_id = other.workspace_id and wm.member_id = other.member_id
      where other.project_id = ${projectId} and other.workspace_id = ${projectMembers.workspaceId}
        and other.id != ${projectMembers.id} and other.role = 20 and other.is_active = 1 and other.deleted_at is null
        and wm.is_active = 1 and wm.deleted_at is null))`
      )
    )
    .returning({ id: projectMembers.id })
  if (!changed)
    throw new ServiceError(
      409,
      'CANNOT_LEAVE_PROJECT',
      'Project access changed or another active administrator is required'
    )
}
