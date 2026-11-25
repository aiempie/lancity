import { eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { user } from '@/db/schema/auth'
import { profiles } from '@/db/schema/identity'
import { workspaceMemberInvites, workspaces } from '@/db/schema/workspace'
import { getEnv, logJson, type InfraEnv } from '@/server/common/env'
import { enqueueJob, registerJobHandler } from '@/server/common/jobs'
import { sendMail } from '@/server/common/mail'
import { linkEmail } from '@/server/common/mail-templates'
import { getInviteLinkWorkspaceMemberInvite } from '@/server/workspace/presenters'
import { recordRecentVisit } from '@/server/workspace/recent-visit'
import { MAINTENANCE_WORKSPACE_SEED_JOB, workspaceSeed } from '@/server/maintenance/workspace-seed'
import { WORKSPACE_SEED_JOB } from '@/server/workspace/seed'
import type { RecordRecentVisit } from '@/types/workspace/schema'

export const WORKSPACE_INVITATION_JOB = 'workspace.send_invitation'
export const RECENT_VISIT_JOB = 'workspace.record_recent_visit'

type InvitationPayload = { invitationId: number; inviterId: number; baseUrl: string }
type RecentVisitPayload = RecordRecentVisit & { userId: number; workspaceId: number }

/** Queue one e-mail per created invitation (workspace_invitation.delay in Plane). */
export async function enqueueWorkspaceInvitationEmails(invitationIds: number[], inviterId: number, env = getEnv()) {
  const baseUrl = env.BETTER_AUTH_URL ?? ''
  for (const invitationId of invitationIds)
    try {
      await enqueueJob(env, { type: WORKSPACE_INVITATION_JOB, payload: { invitationId, inviterId, baseUrl } })
    } catch (error) {
      // The invitation row exists; a mail failure must not fail the request.
      logJson('error', 'workspace_invitation_enqueue', { invitationId, message: String(error) })
    }
}

/** New seeds run through the maintenance job (full Plane seed data). */
export const enqueueWorkspaceSeed = (workspaceId: number, env = getEnv()) =>
  enqueueJob(env, { type: MAINTENANCE_WORKSPACE_SEED_JOB, payload: { workspaceId } })

export const enqueueRecentVisit = (payload: RecentVisitPayload, env = getEnv()) =>
  enqueueJob(env, { type: RECENT_VISIT_JOB, payload })

/** bgtasks/workspace_invitation_task.py: render and send the invitation e-mail, then store its text as the message. */
export async function sendWorkspaceInvitation(payload: InvitationPayload, env: InfraEnv) {
  const db = getDb(env.DB)
  const [row] = await db
    .select({
      id: workspaceMemberInvites.id,
      email: workspaceMemberInvites.email,
      token: workspaceMemberInvites.token,
      message: workspaceMemberInvites.message,
      respondedAt: workspaceMemberInvites.respondedAt,
      deletedAt: workspaceMemberInvites.deletedAt,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      workspaceDeletedAt: workspaces.deletedAt
    })
    .from(workspaceMemberInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMemberInvites.workspaceId))
    .where(eq(workspaceMemberInvites.id, payload.invitationId))
  // Plane returns silently when the workspace or invitation is gone.
  if (!row || row.deletedAt || row.respondedAt || row.workspaceDeletedAt) return
  const [inviter] = await db
    .select({ name: user.name, email: user.email, firstName: profiles.firstName, username: user.username })
    .from(user)
    .leftJoin(profiles, eq(profiles.userId, user.id))
    .where(eq(user.id, payload.inviterId))
  const inviterName = inviter?.firstName || inviter?.username || inviter?.name || inviter?.email || 'Someone'
  const url = getInviteLinkWorkspaceMemberInvite(row, row.workspaceSlug, payload.baseUrl)
  const mail = linkEmail(
    `${inviterName} has invited you to join them in ${row.workspaceName} on Lancity`,
    `Join ${row.workspaceName}`,
    `${inviterName} has invited you to join ${row.workspaceName} on Lancity.`,
    'Accept invitation',
    url
  )
  const result = await sendMail({ to: row.email, ...mail }, env)
  logJson(result.sent ? 'info' : 'warn', 'workspace_invitation', { invitationId: row.id, sent: result.sent })
  if (!row.message)
    await db.update(workspaceMemberInvites).set({ message: mail.text }).where(eq(workspaceMemberInvites.id, row.id))
}

export function register(): void {
  registerJobHandler<InvitationPayload>(WORKSPACE_INVITATION_JOB, sendWorkspaceInvitation)
  registerJobHandler<{ workspaceId: number }>(WORKSPACE_SEED_JOB, async (payload, env) => {
    // Kept only to drain messages queued before the maintenance seed existed. `workspaceSeed` is idempotent.
    await workspaceSeed(getDb(env.DB), payload.workspaceId)
  })
  registerJobHandler<RecentVisitPayload>(RECENT_VISIT_JOB, async (payload, env) => {
    await recordRecentVisit(getDb(env.DB), payload)
  })
}
