import { and, eq, isNull, sql } from 'drizzle-orm'
import { draftIssues } from '@/db/schema/planning'
import { projectMembers, projects, workspaceMembers } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import { pageEnvelope, pageWindow } from '@/server/workspace/pagination'
import { queryWorkspaceMember } from '@/server/workspace/queries'
import { toUserLite } from '@/server/workspace/presenters'
import { getWorkspace } from '@/server/workspace/service'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { WorkspaceRole } from '@/types/workspace/schema'

type MemberRow = Awaited<ReturnType<typeof queryWorkspaceMember>>[number]
/** Guests get id, member and role. Others also get is_active and created_at, plus e-mail inside `member`. */
function presentMember(row: MemberRow, guest: boolean) {
  const base = { id: row.id, memberId: row.memberId, role: row.role, member: toUserLite(row, !guest) }
  return guest ? base : { ...base, isActive: row.isActive, createdAt: row.createdAt }
}

/** WorkSpaceMemberViewSet.list. */
export async function listWorkspaceMembers(db: LancityDb, actor: Actor, slug: string, search?: string) {
  const { workspace, membership } = await getWorkspace(db, actor, slug)
  const rows = await queryWorkspaceMember(db, workspace.id, search)
  return rows.map(row => presentMember(row, membership.role === 5))
}

/** WorkSpaceMemberViewSet.retrieve. */
export async function getWorkspaceMember(db: LancityDb, actor: Actor, slug: string, id: number) {
  const { workspace, membership } = await getWorkspace(db, actor, slug)
  const member = (await queryWorkspaceMember(db, workspace.id)).find(row => row.id === id)
  if (!member) throw new ServiceError(404, 'MEMBER_NOT_FOUND', 'Workspace member not found')
  return presentMember(member, membership.role === 5)
}

/** WorkspaceMemberLiteAPIEndpoint.get: flat, paginated member directory (admins and members only). */
export async function listWorkspaceMembersLite(
  db: LancityDb,
  actor: Actor,
  slug: string,
  query: { cursor?: string; per_page?: number }
) {
  const { workspace } = await getWorkspace(db, actor, slug, 15)
  const win = pageWindow(query.cursor, query.per_page ?? 20, 100)
  const all = await queryWorkspaceMember(db, workspace.id)
  const rows = all.slice(win.offset, win.offset + win.limit + 1).map(row => ({
    ...toUserLite(row, true),
    id: row.memberId,
    avatar: row.image,
    role: row.role,
    is_active: row.isActive
  }))
  return pageEnvelope(rows, all.length, win)
}

/** WorkspaceMemberUserEndpoint.get: the actor's own membership with the count of their drafts. */
export async function getWorkspaceMemberUser(db: LancityDb, actor: Actor, slug: string) {
  const { workspace, membership } = await getWorkspace(db, actor, slug)
  const [draft] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(draftIssues)
    .where(
      and(
        eq(draftIssues.createdById, actor.userId),
        eq(draftIssues.workspaceId, workspace.id),
        isNull(draftIssues.deletedAt)
      )
    )
  return { ...membership, draftIssueCount: draft?.count ?? 0 }
}

/** WorkspaceMemberUserViewsEndpoint.post: store the member's saved view props. */
export async function createWorkspaceMemberUserViews(
  db: LancityDb,
  actor: Actor,
  slug: string,
  viewProps: Record<string, unknown>
) {
  const { membership } = await getWorkspace(db, actor, slug)
  await db
    .update(workspaceMembers)
    .set({ viewProps: viewProps as never, updatedById: actor.userId })
    .where(eq(workspaceMembers.id, membership.id))
}

/**
 * WorkspaceProjectMemberEndpoint.get: members of every project the actor belongs to, keyed by project id.
 * Each entry is { id, role, member, original_role, created_at }.
 */
export async function getWorkspaceProjectMember(db: LancityDb, actor: Actor, slug: string) {
  const { workspace } = await getWorkspace(db, actor, slug)
  const rows = await db
    .select({
      id: projectMembers.id,
      projectId: projectMembers.projectId,
      role: projectMembers.role,
      member: projectMembers.memberId,
      createdAt: projectMembers.createdAt
    })
    .from(projectMembers)
    .innerJoin(projects, and(eq(projects.id, projectMembers.projectId), isNull(projects.deletedAt)))
    .where(
      and(
        eq(projectMembers.workspaceId, workspace.id),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt),
        sql`${projectMembers.projectId} in (select project_id from project_members where member_id = ${actor.userId}
          and is_active = 1 and deleted_at is null)`
      )
    )
  const byProject: Record<
    string,
    { id: number; role: number; member: number | null; original_role: number; created_at: Date }[]
  > = {}
  for (const row of rows)
    (byProject[String(row.projectId)] ??= []).push({
      id: row.id,
      role: row.role,
      member: row.member,
      original_role: row.role,
      created_at: row.createdAt
    })
  return byProject
}

/**
 * is_sole_admin_of_any_project (plane/app/views/workspace/member.py:31): the user is an admin and the only member of a
 * project of the workspace. Plane does not block an admin who merely has no admin peer. Only active rows are counted.
 */
export async function isSoleAdminOfAnyProject(db: LancityDb, workspaceId: number, userId: number) {
  const [row] = await db.all<{ n: number }>(sql`select 1 as n from project_members target
    join projects p on p.id = target.project_id and p.workspace_id = target.workspace_id and p.deleted_at is null
    where target.workspace_id = ${workspaceId} and target.member_id = ${userId} and target.role = 20
      and target.is_active = 1 and target.deleted_at is null
      and (select count(*) from project_members all_members
        where all_members.project_id = target.project_id and all_members.is_active = 1 and all_members.deleted_at is null) = 1
    limit 1`)
  return Boolean(row)
}

async function targetMember(db: LancityDb, workspaceId: number, memberId: number) {
  const [member] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.id, memberId),
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt)
      )
    )
  if (!member) throw new ServiceError(404, 'MEMBER_NOT_FOUND', 'Workspace member not found')
  return member
}

/** SQL predicate: the user is not the only member (an admin) of any project of the workspace. */
function notSoleProjectAdmin(workspaceId: number, userId: number) {
  return sql`not exists (
    select 1 from project_members target
    join projects p on p.id = target.project_id and p.workspace_id = target.workspace_id
      and p.deleted_at is null
    where target.workspace_id = ${workspaceId} and target.member_id = ${userId}
      and target.role = 20 and target.is_active = 1 and target.deleted_at is null
      and (select count(*) from project_members all_members
        where all_members.project_id = target.project_id and all_members.is_active = 1
          and all_members.deleted_at is null) = 1
  )`
}

async function changeWorkspaceMember(
  db: LancityDb,
  actor: Actor,
  slug: string,
  memberId: number,
  role: WorkspaceRole | null
) {
  const { workspace } = await getWorkspace(db, actor, slug, 20)
  const member = await targetMember(db, workspace.id, memberId)
  if (member.memberId === actor.userId || member.memberId === workspace.ownerId)
    throw new ServiceError(400, 'PROTECTED_MEMBER', 'Cannot change this workspace member')
  const changesProjectMembership = role === null || role === 5
  const workspaceWrite = db
    .update(workspaceMembers)
    .set({
      ...(role === null ? { isActive: false } : { role }),
      updatedById: actor.userId
    })
    .where(
      and(
        eq(workspaceMembers.id, member.id),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt),
        sql`exists (select 1 from workspace_members current_admin
      join workspaces current_workspace on current_workspace.id = current_admin.workspace_id
      where current_admin.workspace_id = ${workspace.id} and current_workspace.deleted_at is null
        and current_workspace.owner_id != ${member.memberId} and current_admin.member_id = ${actor.userId}
        and current_admin.role = 20 and current_admin.is_active = 1 and current_admin.deleted_at is null)`,
        changesProjectMembership ? notSoleProjectAdmin(workspace.id, member.memberId) : undefined
      )
    )
    .returning()

  if (changesProjectMembership) {
    // D1 evaluates the sole-admin predicate in the write transaction. The second statement runs only if the first changed a row.
    const [updated] = await db.batch([
      workspaceWrite,
      db
        .update(projectMembers)
        .set({
          ...(role === null ? { isActive: false } : { role }),
          updatedById: actor.userId
        })
        .where(
          and(
            eq(projectMembers.workspaceId, workspace.id),
            eq(projectMembers.memberId, member.memberId),
            isNull(projectMembers.deletedAt),
            sql`changes() = 1`
          )
        )
    ])
    if (updated[0]) return updated[0]
    await getWorkspace(db, actor, slug, 20)
    await targetMember(db, workspace.id, member.id)
    throw new ServiceError(400, 'SOLE_PROJECT_ADMIN', 'Assign another project admin first')
  }
  const [updated] = await workspaceWrite
  if (!updated) throw new ServiceError(409, 'MEMBER_CHANGED', 'Workspace membership changed')
  return updated
}

export async function updateWorkspaceMember(
  db: LancityDb,
  actor: Actor,
  slug: string,
  memberId: number,
  role: WorkspaceRole
) {
  return changeWorkspaceMember(db, actor, slug, memberId, role)
}

export async function removeWorkspaceMember(db: LancityDb, actor: Actor, slug: string, memberId: number) {
  await changeWorkspaceMember(db, actor, slug, memberId, null)
}

/**
 * WorkSpaceMemberViewSet.leave: deactivate the actor's membership. Refused for the last workspace admin, the
 * workspace owner and the sole admin of a project. The guard runs inside the write so races cannot bypass it.
 */
export async function leaveWorkspaceMember(db: LancityDb, actor: Actor, slug: string) {
  const { workspace, membership } = await getWorkspace(db, actor, slug)
  if (workspace.ownerId === actor.userId)
    throw new ServiceError(400, 'OWNER_CANNOT_LEAVE', 'The workspace owner cannot leave. Delete the workspace instead')
  const anotherAdmin = sql`(${membership.role} != 20 or exists (select 1 from workspace_members other
    where other.workspace_id = ${workspace.id} and other.role = 20 and other.is_active = 1 and other.deleted_at is null
      and other.member_id != ${actor.userId}))`
  const [updated] = await db.batch([
    db
      .update(workspaceMembers)
      .set({ isActive: false, updatedById: actor.userId })
      .where(
        and(
          eq(workspaceMembers.id, membership.id),
          eq(workspaceMembers.isActive, true),
          isNull(workspaceMembers.deletedAt),
          anotherAdmin,
          notSoleProjectAdmin(workspace.id, actor.userId)
        )
      )
      .returning({ id: workspaceMembers.id }),
    db
      .update(projectMembers)
      .set({ isActive: false, updatedById: actor.userId })
      .where(
        and(
          eq(projectMembers.workspaceId, workspace.id),
          eq(projectMembers.memberId, actor.userId),
          isNull(projectMembers.deletedAt),
          sql`changes() = 1`
        )
      )
  ])
  if (updated[0]) return
  if (membership.role === 20 && !(await hasOtherAdmin(db, workspace.id, actor.userId)))
    throw new ServiceError(
      400,
      'SOLE_WORKSPACE_ADMIN',
      'You are the only admin of the workspace. Promote another admin or delete it'
    )
  if (await isSoleAdminOfAnyProject(db, workspace.id, actor.userId))
    throw new ServiceError(
      400,
      'SOLE_PROJECT_ADMIN',
      'You are the only admin of a project. Leave it or promote another admin'
    )
  throw new ServiceError(409, 'MEMBER_CHANGED', 'Workspace membership changed')
}

async function hasOtherAdmin(db: LancityDb, workspaceId: number, userId: number) {
  const [row] = await db.all<{ n: number }>(sql`select 1 as n from workspace_members where workspace_id = ${workspaceId}
    and role = 20 and is_active = 1 and deleted_at is null and member_id != ${userId} limit 1`)
  return Boolean(row)
}
