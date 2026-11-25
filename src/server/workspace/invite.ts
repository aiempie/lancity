import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core'
import { user } from '@/db/schema/auth'
import { profiles } from '@/db/schema/identity'
import { workspaceMemberInvites, workspaceMembers, workspaces } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import { logoUrlWorkspace } from '@/server/workspace/model-rules'
import { memberUserFields, toUserLite } from '@/server/workspace/presenters'
import {
  findWorkspaceInvitations,
  invitationFields,
  queryUserWorkspaceInvitations,
  queryWorkspaceInvitations
} from '@/server/workspace/queries'
import { getWorkspace } from '@/server/workspace/service'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type {
  CreateWorkspaceInvitationInput,
  CreateWorkspaceInvitationsBulkInput,
  WorkspaceRole
} from '@/types/workspace/schema'

// Tokens are never included in API output. The token only travels in the invitation e-mail.
const newToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')

async function verifiedAccount(db: LancityDb, actor: Actor) {
  const [account] = await db
    .select({ email: user.email, verified: user.emailVerified })
    .from(user)
    .where(eq(user.id, actor.userId))
  if (!account) throw new ServiceError(401, 'UNAUTHORIZED', 'Authentication required')
  if (!account.verified) throw new ServiceError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email to use invitations')
  return account.email.toLowerCase()
}

export async function listWorkspaceInvitations(db: LancityDb, actor: Actor, slug: string) {
  const { workspace } = await getWorkspace(db, actor, slug, 15)
  return queryWorkspaceInvitations(db, workspace.id)
}

export async function getWorkspaceInvitation(db: LancityDb, actor: Actor, slug: string, id: number) {
  const { workspace } = await getWorkspace(db, actor, slug, 15)
  const invite = await findWorkspaceInvitations(db, workspace.id, id)
  if (!invite) throw new ServiceError(404, 'INVITATION_NOT_FOUND', 'Invitation not found')
  return invite
}

async function activeMembersByEmail(db: LancityDb, workspaceId: number, emails: string[]) {
  return db
    .select({ id: workspaceMembers.id, role: workspaceMembers.role, ...memberUserFields })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.memberId))
    .leftJoin(profiles, eq(profiles.userId, user.id))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        inArray(sql`lower(${user.email})`, emails),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt)
      )
    )
}

/** Single invitation (mobile API). Returns the created invitation, the caller queues the e-mail. */
export async function createWorkspaceInvitation(
  db: LancityDb,
  actor: Actor,
  slug: string,
  input: CreateWorkspaceInvitationInput
) {
  const { workspace, membership } = await getWorkspace(db, actor, slug, 15)
  if (input.role > membership.role) throw new ServiceError(403, 'FORBIDDEN', 'Cannot invite a higher role')
  if ((await activeMembersByEmail(db, workspace.id, [input.email])).length)
    throw new ServiceError(409, 'ALREADY_MEMBER', 'User is already a workspace member')
  const [existing] = await db
    .select({ id: workspaceMemberInvites.id })
    .from(workspaceMemberInvites)
    .where(
      and(
        eq(workspaceMemberInvites.workspaceId, workspace.id),
        sql`lower(${workspaceMemberInvites.email}) = ${input.email}`,
        isNull(workspaceMemberInvites.deletedAt)
      )
    )
  if (existing) throw new ServiceError(409, 'INVITATION_EXISTS', 'Invitation already exists')
  try {
    const [invite] = await db
      .insert(workspaceMemberInvites)
      .values({
        email: input.email,
        role: input.role,
        message: input.message,
        token: newToken(),
        workspaceId: workspace.id,
        createdById: actor.userId,
        updatedById: actor.userId
      })
      .returning(invitationFields)
    return invite
  } catch (error) {
    const [duplicate] = await db
      .select({ id: workspaceMemberInvites.id })
      .from(workspaceMemberInvites)
      .where(
        and(
          eq(workspaceMemberInvites.workspaceId, workspace.id),
          eq(workspaceMemberInvites.email, input.email),
          isNull(workspaceMemberInvites.deletedAt)
        )
      )
    if (duplicate) throw new ServiceError(409, 'INVITATION_EXISTS', 'Invitation already exists')
    throw error
  }
}

/**
 * WorkspaceInvitationsViewset.create (app): bulk invite. Plane rejects the whole request when a role is higher
 * than the requester's or when someone is already a member, and ignores addresses that are already invited.
 */
export async function createWorkspaceInvitations(
  db: LancityDb,
  actor: Actor,
  slug: string,
  input: CreateWorkspaceInvitationsBulkInput
) {
  const { workspace, membership } = await getWorkspace(db, actor, slug, 15)
  if (input.emails.some(item => item.role > membership.role))
    throw new ServiceError(403, 'FORBIDDEN', 'You cannot invite a user with higher role')
  const unique = [...new Map(input.emails.map(item => [item.email, item])).values()]
  const members = await activeMembersByEmail(
    db,
    workspace.id,
    unique.map(item => item.email)
  )
  if (members.length)
    throw new ServiceError(400, 'ALREADY_MEMBER', 'Some users are already member of workspace', {
      workspace_users: members.map(member => ({ id: member.id, role: member.role, member: toUserLite(member, true) }))
    })
  const created = await db
    .insert(workspaceMemberInvites)
    .values(
      unique.map(item => ({
        email: item.email,
        role: item.role,
        token: newToken(),
        workspaceId: workspace.id,
        createdById: actor.userId,
        updatedById: actor.userId
      }))
    )
    .onConflictDoNothing()
    .returning(invitationFields)
  return created
}

export async function updateWorkspaceInvitation(
  db: LancityDb,
  actor: Actor,
  slug: string,
  id: number,
  role: WorkspaceRole
) {
  const { membership } = await getWorkspace(db, actor, slug, 15)
  if (role > membership.role) throw new ServiceError(403, 'FORBIDDEN', 'Cannot invite a higher role')
  const invite = await getWorkspaceInvitation(db, actor, slug, id)
  if (invite.respondedAt) throw new ServiceError(409, 'INVITATION_RESPONDED', 'Invitation already responded')
  const [updated] = await db
    .update(workspaceMemberInvites)
    .set({ role, updatedById: actor.userId })
    .where(
      and(
        eq(workspaceMemberInvites.id, id),
        eq(workspaceMemberInvites.workspaceId, invite.workspaceId),
        isNull(workspaceMemberInvites.respondedAt),
        isNull(workspaceMemberInvites.deletedAt)
      )
    )
    .returning(invitationFields)
  if (!updated) throw new ServiceError(409, 'INVITATION_RESPONDED', 'Invitation already responded')
  return updated
}

export async function deleteWorkspaceInvitation(db: LancityDb, actor: Actor, slug: string, id: number) {
  const invite = await getWorkspaceInvitation(db, actor, slug, id)
  if (invite.respondedAt) throw new ServiceError(409, 'INVITATION_RESPONDED', 'Invitation already responded')
  const [deleted] = await db
    .update(workspaceMemberInvites)
    .set({ deletedAt: new Date(), updatedById: actor.userId })
    .where(
      and(
        eq(workspaceMemberInvites.id, id),
        eq(workspaceMemberInvites.workspaceId, invite.workspaceId),
        isNull(workspaceMemberInvites.respondedAt),
        isNull(workspaceMemberInvites.deletedAt)
      )
    )
    .returning({ id: workspaceMemberInvites.id })
  if (!deleted) throw new ServiceError(409, 'INVITATION_RESPONDED', 'Invitation already responded')
}

/** UserWorkspaceInvitationsViewSet.list: pending invitations addressed to the verified e-mail of the actor. */
export async function listPendingWorkspaceInvitations(db: LancityDb, actor: Actor) {
  const email = await verifiedAccount(db, actor)
  const rows = await queryUserWorkspaceInvitations(db, email)
  return rows.filter(row => !row.respondedAt)
}
export const listUserWorkspaceInvitations = listPendingWorkspaceInvitations

const dialect = new SQLiteAsyncDialect()
async function runBatch(db: LancityDb, statements: ReturnType<typeof sql>[]) {
  return db.$client.batch(
    statements.map(query => {
      const compiled = dialect.sqlToQuery(query)
      return db.$client.prepare(compiled.sql).bind(...compiled.params)
    })
  )
}

/**
 * Accept or decline pending invitations of the actor atomically. `scope` narrows the invitation rows.
 * Accepting also reactivates a suspended membership and points profiles.last_workspace_id at the workspace
 * (WorkspaceJoinEndpoint.post). The last statement decides whether anything matched.
 */
async function respondInvitations(
  db: LancityDb,
  actor: Actor,
  email: string,
  accepted: boolean,
  scope: ReturnType<typeof sql>
) {
  const now = Date.now()
  const pending = sql`${scope} and lower(email) = ${email} and responded_at is null and deleted_at is null and exists (select 1 from workspaces w where w.id = workspace_member_invites.workspace_id and w.deleted_at is null)`
  const statements = accepted
    ? [
        sql`insert into workspace_members (workspace_id, member_id, role, created_by_id, updated_by_id) select workspace_id, ${actor.userId}, role, created_by_id, ${actor.userId} from workspace_member_invites where ${pending} on conflict do nothing`,
        sql`update workspace_members set is_active = 1, role = case when exists (select 1 from workspaces where id = workspace_members.workspace_id and owner_id = ${actor.userId}) then 20 else (select role from workspace_member_invites where workspace_id = workspace_members.workspace_id and ${pending} limit 1) end, updated_by_id = ${actor.userId}, updated_at = ${now} where member_id = ${actor.userId} and is_active = 0 and deleted_at is null and workspace_id in (select workspace_id from workspace_member_invites where ${pending})`,
        sql`update profiles set last_workspace_id = (select workspace_id from workspace_member_invites where ${pending} order by id desc limit 1), updated_at = ${now} where user_id = ${actor.userId} and exists (select 1 from workspace_member_invites where ${pending})`,
        sql`update workspace_member_invites set accepted = 1, responded_at = ${now}, updated_by_id = ${actor.userId}, updated_at = ${now} where ${pending}`
      ]
    : [
        sql`update workspace_member_invites set accepted = 0, responded_at = ${now}, updated_by_id = ${actor.userId}, updated_at = ${now} where ${pending}`
      ]
  const results = await runBatch(db, statements)
  return results.at(-1)?.meta.changes ?? 0
}

export async function respondWorkspaceInvitation(db: LancityDb, actor: Actor, id: number, accepted: boolean) {
  const email = await verifiedAccount(db, actor)
  const changed = await respondInvitations(db, actor, email, accepted, sql`id = ${id}`)
  if (!changed) throw new ServiceError(404, 'INVITATION_NOT_FOUND', 'Pending invitation not found')
  return { accepted }
}

/** UserWorkspaceInvitationsViewSet.create: accept several invitations at once. */
export async function createUserWorkspaceInvitations(db: LancityDb, actor: Actor, ids: number[]) {
  const email = await verifiedAccount(db, actor)
  const list = sql.join(
    ids.map(id => sql`${id}`),
    sql`, `
  )
  await respondInvitations(db, actor, email, true, sql`id in (${list})`)
}

async function loadJoinInvite(db: LancityDb, slug: string, id: number) {
  const [invite] = await db
    .select({
      ...invitationFields,
      token: workspaceMemberInvites.token,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      workspaceLogo: workspaces.logo,
      workspaceLogoAssetId: workspaces.logoAssetId
    })
    .from(workspaceMemberInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMemberInvites.workspaceId))
    .where(
      and(
        eq(workspaceMemberInvites.id, id),
        eq(workspaces.slug, slug),
        isNull(workspaceMemberInvites.deletedAt),
        isNull(workspaces.deletedAt)
      )
    )
  if (!invite) throw new ServiceError(404, 'INVITATION_NOT_FOUND', 'Invitation not found')
  return invite
}

/**
 * WorkspaceJoinEndpoint.get: public view of an invitation (WorkSpaceMemberInvitePublicSerializer, no token).
 * Ids are sequential here, so the e-mailed token is required to read it.
 */
export async function getWorkspaceJoin(db: LancityDb, slug: string, id: number, token: string) {
  const invite = await loadJoinInvite(db, slug, id)
  if (invite.token !== token)
    throw new ServiceError(403, 'FORBIDDEN', 'You do not have permission to read this invitation')
  const { workspaceName, workspaceSlug, workspaceLogo, workspaceLogoAssetId, ...rest } = invite
  return {
    ...rest,
    token: undefined, // never returned
    workspace: {
      id: invite.workspaceId,
      name: workspaceName,
      slug: workspaceSlug,
      logo_url: logoUrlWorkspace({ slug: workspaceSlug, logo: workspaceLogo, logoAssetId: workspaceLogoAssetId })
    }
  }
}

/** WorkspaceJoinEndpoint.post: the invited, signed-in user answers with the e-mailed token. */
export async function createWorkspaceJoin(
  db: LancityDb,
  actor: Actor,
  slug: string,
  id: number,
  input: { token: string; accepted: boolean }
) {
  const invite = await loadJoinInvite(db, slug, id)
  if (!input.token || invite.token !== input.token)
    throw new ServiceError(403, 'FORBIDDEN', 'You do not have permission to join the workspace')
  const email = await verifiedAccount(db, actor)
  if (email !== invite.email.toLowerCase())
    throw new ServiceError(403, 'FORBIDDEN', 'You do not have permission to accept this invitation')
  if (invite.respondedAt)
    throw new ServiceError(400, 'INVITATION_RESPONDED', 'You have already responded to the invitation request')
  await respondWorkspaceInvitation(db, actor, id, input.accepted)
  return { message: input.accepted ? 'Workspace Invitation Accepted' : 'Workspace Invitation was not accepted' }
}
