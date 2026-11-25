import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { user } from '@/db/schema/auth'
import { projectMemberInvites, projectMembers, projects, workspaceMembers, workspaces } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import { appOrigin, queueProjectMail } from '@/server/project/events'
import { projectInvitationEmail } from '@/server/project/emails'
import { getDefaultProps, memberDefaults, userPropertyInsert } from '@/server/project/model-rules'
import { forbidden, hasPermissionProjectAdminPermission, loadProjectScope } from '@/server/project/permissions'
import { queryProjectInvitations, queryUserProjectInvitations } from '@/server/project/queries'
import { getWorkspace } from '@/server/workspace/service'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { CreateProjectInvitationsInput } from '@/types/project/schema'

const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')

/** PD-0759 `ProjectInvitationsViewset.list`. Project admins only. Tokens are never returned. */
export async function listProjectInvitations(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { workspace, access } = await loadProjectScope(db, actor, slug, projectId)
  forbidden(hasPermissionProjectAdminPermission(access))
  return queryProjectInvitations(db, workspace.id, projectId)
}

/** PD-0760 `ProjectInvitationsViewset.retrieve`. */
export async function getProjectInvitations(db: LancityDb, actor: Actor, slug: string, projectId: number, id: number) {
  const invitations = await listProjectInvitations(db, actor, slug, projectId)
  const invitation = invitations.find(row => row.id === id)
  if (!invitation) throw new ServiceError(404, 'INVITATION_NOT_FOUND', 'Invitation not found')
  return invitation
}

/** PD-0761 `ProjectInvitationsViewset.destroy`: soft delete. */
export async function deleteProjectInvitations(db: LancityDb, actor: Actor, slug: string, projectId: number, id: number) {
  const { workspace, access } = await loadProjectScope(db, actor, slug, projectId)
  forbidden(hasPermissionProjectAdminPermission(access))
  const [deleted] = await db
    .update(projectMemberInvites)
    .set({ deletedAt: new Date(), updatedById: actor.userId })
    .where(
      and(
        eq(projectMemberInvites.id, id),
        eq(projectMemberInvites.projectId, projectId),
        eq(projectMemberInvites.workspaceId, workspace.id),
        isNull(projectMemberInvites.deletedAt)
      )
    )
    .returning({ id: projectMemberInvites.id })
  if (!deleted) throw new ServiceError(404, 'INVITATION_NOT_FOUND', 'Invitation not found')
}

/**
 * PD-0762 `ProjectInvitationsViewset.create`: invite people by email (project admins only). An invitee who is already a
 * workspace guest or admin must get the same project role. A pending invitation for the same email is refreshed
 * instead of duplicated. One email job is queued per invitation.
 */
export async function createProjectInvitations(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  input: CreateProjectInvitationsInput
) {
  const { workspace, project, access } = await loadProjectScope(db, actor, slug, projectId)
  forbidden(hasPermissionProjectAdminPermission(access))
  const emails = [...new Map(input.emails.map(entry => [entry.email, entry.role])).entries()]
  const known = await db
    .select({ email: user.email, memberId: user.id, role: workspaceMembers.role })
    .from(user)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.memberId, user.id),
        eq(workspaceMembers.workspaceId, workspace.id),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt)
      )
    )
    .where(inArray(sql`lower(${user.email})`, emails.map(([email]) => email)))
  for (const [email, role] of emails) {
    const member = known.find(row => row.email.toLowerCase() === email)
    if (member && (member.role === 5 || member.role === 20) && member.role !== role)
      throw new ServiceError(400, 'INVALID_MEMBER_ROLE', 'You cannot invite a user with different role than workspace role')
    if (member) {
      const [active] = await db
        .select({ id: projectMembers.id })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.memberId, member.memberId),
            eq(projectMembers.isActive, true),
            isNull(projectMembers.deletedAt)
          )
        )
      if (active) throw new ServiceError(409, 'ALREADY_MEMBER', 'User is already a project member')
    }
  }
  const [inviter] = await db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, actor.userId))
  const origin = await appOrigin()
  for (const [email, role] of emails) {
    const [pending] = await db
      .select({ id: projectMemberInvites.id, token: projectMemberInvites.token })
      .from(projectMemberInvites)
      .where(
        and(
          eq(projectMemberInvites.projectId, projectId),
          sql`lower(${projectMemberInvites.email}) = ${email}`,
          isNull(projectMemberInvites.respondedAt),
          isNull(projectMemberInvites.deletedAt)
        )
      )
    const invitation = pending
      ? (
          await db
            .update(projectMemberInvites)
            .set({ role, updatedById: actor.userId })
            .where(eq(projectMemberInvites.id, pending.id))
            .returning({ id: projectMemberInvites.id, token: projectMemberInvites.token })
        )[0]
      : (
          await db
            .insert(projectMemberInvites)
            .values({
              email,
              role,
              token: randomToken(),
              projectId,
              workspaceId: workspace.id,
              createdById: actor.userId,
              updatedById: actor.userId
            })
            .returning({ id: projectMemberInvites.id, token: projectMemberInvites.token })
        )[0]
    await queueProjectMail(
      email,
      projectInvitationEmail({
        inviter: inviter?.name || inviter?.email || 'A teammate',
        projectName: project.name,
        origin,
        slug,
        projectId,
        invitationId: invitation.id,
        email,
        token: invitation.token
      })
    )
  }
  return { message: 'Email sent successfully' }
}

/** PD-0763 `UserProjectInvitationsViewset.list` and PD-0764: the actor's own invitations in this workspace. */
export async function listUserProjectInvitations(db: LancityDb, actor: Actor, slug: string) {
  const { workspace } = await getWorkspace(db, actor, slug)
  const [account] = await db
    .select({ email: user.email, verified: user.emailVerified })
    .from(user)
    .where(eq(user.id, actor.userId))
  if (!account) throw new ServiceError(401, 'UNAUTHORIZED', 'Authentication required')
  if (!account.verified) throw new ServiceError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email to use invitations')
  return queryUserProjectInvitations(db, account.email, workspace.id).orderBy(desc(projectMemberInvites.createdAt))
}

/**
 * PD-0765 `UserProjectInvitationsViewset.create`: a workspace admin or member joins several projects at once with their
 * workspace role. Secret projects need a workspace admin. A previous inactive membership is reactivated with that role.
 */
export async function createUserProjectInvitations(db: LancityDb, actor: Actor, slug: string, projectIds: number[]) {
  const { workspace, membership } = await getWorkspace(db, actor, slug)
  forbidden(membership.role >= 15, 'Insufficient workspace permissions')
  const ids = [...new Set(projectIds)]
  const rows = ids.length
    ? await db
        .select({ id: projects.id, network: projects.network })
        .from(projects)
        .where(and(inArray(projects.id, ids), eq(projects.workspaceId, workspace.id), isNull(projects.deletedAt)))
    : []
  if (rows.some(row => row.network === 0 && membership.role !== 20))
    throw new ServiceError(403, 'FORBIDDEN', 'Only workspace admins can join private project')
  const statements = rows.flatMap(({ id }) => [
    db
      .update(projectMembers)
      .set({ isActive: true, role: membership.role, updatedById: actor.userId })
      .where(
        and(
          eq(projectMembers.projectId, id),
          eq(projectMembers.memberId, actor.userId),
          eq(projectMembers.isActive, false),
          isNull(projectMembers.deletedAt)
        )
      ),
    db
      .insert(projectMembers)
      .values({
        projectId: id,
        workspaceId: workspace.id,
        memberId: actor.userId,
        role: membership.role,
        ...memberDefaults(),
        createdById: actor.userId
      })
      .onConflictDoNothing(),
    userPropertyInsert(db, { projectId: id, userId: actor.userId, actorId: actor.userId })
  ])
  if (statements.length) await db.batch(statements as unknown as Parameters<typeof db.batch>[0])
  return { message: 'Projects joined successfully' }
}

/** Fields of Plane `ProjectMemberInvitePublicSerializer`. The email and the token are left out. */
async function publicInvitation(db: LancityDb, workspaceSlug: string, projectId: number, id: number) {
  const [row] = await db
    .select({
      id: projectMemberInvites.id,
      role: projectMemberInvites.role,
      message: projectMemberInvites.message,
      accepted: projectMemberInvites.accepted,
      respondedAt: projectMemberInvites.respondedAt,
      email: projectMemberInvites.email,
      token: projectMemberInvites.token,
      workspaceId: projectMemberInvites.workspaceId,
      projectId: projects.id,
      projectName: projects.name,
      projectIdentifier: projects.identifier,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug
    })
    .from(projectMemberInvites)
    .innerJoin(projects, eq(projects.id, projectMemberInvites.projectId))
    .innerJoin(workspaces, eq(workspaces.id, projectMemberInvites.workspaceId))
    .where(
      and(
        eq(projectMemberInvites.id, id),
        eq(projectMemberInvites.projectId, projectId),
        eq(workspaces.slug, workspaceSlug),
        isNull(projectMemberInvites.deletedAt),
        isNull(projects.deletedAt)
      )
    )
  if (!row) throw new ServiceError(404, 'INVITATION_NOT_FOUND', 'Invitation not found')
  return row
}

/**
 * PD-0767 `ProjectJoinEndpoint.get`: public view of an invitation. Ids are sequential here, so the invitation token is
 * required as well, which Plane's random ids made unnecessary.
 */
export async function getProjectJoin(db: LancityDb, slug: string, projectId: number, id: number, token: string | undefined) {
  const row = await publicInvitation(db, slug, projectId, id)
  if (!token || token !== row.token) throw new ServiceError(404, 'INVITATION_NOT_FOUND', 'Invitation not found')
  return {
    id: row.id,
    role: row.role,
    message: row.message,
    accepted: row.accepted,
    respondedAt: row.respondedAt,
    project: { id: row.projectId, name: row.projectName, identifier: row.projectIdentifier },
    workspace: { id: row.workspaceId, name: row.workspaceName, slug: row.workspaceSlug }
  }
}

/**
 * PD-0766 `ProjectJoinEndpoint.post`: the invited user accepts or declines. The token and the signed-in email must match.
 * Accepting adds the user to the workspace when needed (member role for 15 and above, otherwise the invited role),
 * then to the project with the invited role, reactivating an old row. A response is accepted once.
 */
export async function createProjectJoin(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  id: number,
  input: { token: string; accepted: boolean }
) {
  const invite = await publicInvitation(db, slug, projectId, id)
  if (input.token !== invite.token)
    throw new ServiceError(403, 'FORBIDDEN', 'You do not have permission to join the project')
  const [account] = await db
    .select({ email: user.email, verified: user.emailVerified })
    .from(user)
    .where(eq(user.id, actor.userId))
  if (!account) throw new ServiceError(401, 'UNAUTHORIZED', 'Authentication required')
  // Same rule as the workspace join: an unverified address must not claim an invitation sent to it.
  if (!account.verified) throw new ServiceError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email to use invitations')
  if (account.email.toLowerCase() !== invite.email.toLowerCase())
    throw new ServiceError(403, 'FORBIDDEN', 'You do not have permission to accept this invitation')
  if (invite.respondedAt) throw new ServiceError(400, 'ALREADY_RESPONDED', 'You have already responded to the invitation request')
  const unanswered = sql`exists (select 1 from project_member_invites i where i.id = ${id} and i.responded_at is null and i.deleted_at is null)`
  const workspaceRole = invite.role >= 15 ? 15 : invite.role
  const accept = input.accepted
    ? [
        db
          .update(workspaceMembers)
          .set({ isActive: true, updatedById: actor.userId })
          .where(
            and(
              eq(workspaceMembers.workspaceId, invite.workspaceId),
              eq(workspaceMembers.memberId, actor.userId),
              isNull(workspaceMembers.deletedAt),
              unanswered
            )
          ),
        db.run(sql`insert into workspace_members (workspace_id, member_id, role, created_by_id, updated_by_id)
          select ${invite.workspaceId}, ${actor.userId}, ${workspaceRole}, ${actor.userId}, ${actor.userId}
          where ${unanswered}
            and not exists (select 1 from workspace_members wm where wm.workspace_id = ${invite.workspaceId}
              and wm.member_id = ${actor.userId} and wm.deleted_at is null)`),
        db
          .update(projectMembers)
          .set({ isActive: true, role: invite.role, updatedById: actor.userId })
          .where(
            and(
              eq(projectMembers.projectId, projectId),
              eq(projectMembers.memberId, actor.userId),
              isNull(projectMembers.deletedAt),
              unanswered
            )
          ),
        db.run(sql`insert into project_members (workspace_id, project_id, member_id, role, view_props, default_props, preferences, created_by_id, updated_by_id)
          select ${invite.workspaceId}, ${projectId}, ${actor.userId}, ${invite.role}, ${JSON.stringify(getDefaultProps())},
            ${JSON.stringify(getDefaultProps())}, ${JSON.stringify(memberDefaults().preferences)},
            ${actor.userId}, ${actor.userId}
          where ${unanswered}
            and not exists (select 1 from project_members pm where pm.project_id = ${projectId}
              and pm.member_id = ${actor.userId} and pm.deleted_at is null)`),
        db.run(sql`insert into project_user_properties (workspace_id, project_id, user_id, sort_order, created_by_id, updated_by_id)
          select ${invite.workspaceId}, ${projectId}, ${actor.userId},
            coalesce((select min(up.sort_order) - 10000 from project_user_properties up
              where up.workspace_id = ${invite.workspaceId} and up.user_id = ${actor.userId} and up.deleted_at is null), 65535),
            ${actor.userId}, ${actor.userId}
          where ${unanswered}
          on conflict do nothing`)
      ]
    : []
  const results = await db.batch([
    ...accept,
    db
      .update(projectMemberInvites)
      .set({ accepted: input.accepted, respondedAt: new Date(), updatedById: actor.userId })
      .where(and(eq(projectMemberInvites.id, id), isNull(projectMemberInvites.respondedAt)))
      .returning({ id: projectMemberInvites.id })
  ] as unknown as Parameters<typeof db.batch>[0])
  if (!(results[results.length - 1] as unknown as unknown[]).length)
    throw new ServiceError(400, 'ALREADY_RESPONDED', 'You have already responded to the invitation request')
  return { message: input.accepted ? 'Project Invitation Accepted' : 'Project Invitation was not accepted' }
}
