import { Hono } from 'hono'
import { apiV1Routes } from '@/data/linkto'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import {
  createUserWorkspaceInvitations,
  createWorkspaceInvitation,
  createWorkspaceInvitations,
  createWorkspaceJoin,
  deleteWorkspaceInvitation,
  getWorkspaceInvitation,
  getWorkspaceJoin,
  listPendingWorkspaceInvitations,
  listWorkspaceInvitations,
  respondWorkspaceInvitation,
  updateWorkspaceInvitation
} from '@/server/workspace/invite'
import { enqueueWorkspaceInvitationEmails } from '@/server/workspace/jobs'
import { workspaceApiRoutes as paths } from '@/server/workspace/routes'
import type { ApiEnv } from '@/types/api/schema'
import {
  acceptUserWorkspaceInvitationsSchema,
  inviteWorkspaceMembersSchema,
  joinWorkspaceInvitationSchema,
  joinWorkspaceInvitationTokenQuerySchema,
  respondWorkspaceInvitationSchema,
  updateWorkspaceInvitationSchema,
  workspaceMemberIdSchema
} from '@/types/workspace/schema'

const num = (value: string) => parseInput(workspaceMemberIdSchema, value)

export const workspaceInvitationsRoutes = new Hono<ApiEnv>()
workspaceInvitationsRoutes.use('*', authenticate)
workspaceInvitationsRoutes.get(apiV1Routes.pendingInvitations, async c =>
  c.json(await listPendingWorkspaceInvitations(getDb(), c.get('actor')))
)
workspaceInvitationsRoutes.post(apiV1Routes.invitationResponse, async c => {
  const input = await readJson(c, respondWorkspaceInvitationSchema)
  return c.json(
    await respondWorkspaceInvitation(getDb(), c.get('actor'), num(c.req.param('invitationId')), input.accepted)
  )
})
workspaceInvitationsRoutes.get(apiV1Routes.workspaceInvitations, async c =>
  c.json(await listWorkspaceInvitations(getDb(), c.get('actor'), c.req.param('slug')))
)
// Body is either one { email, role, message } or Plane's bulk { emails: [{ email, role }] }. Mail goes out as jobs.
workspaceInvitationsRoutes.post(apiV1Routes.workspaceInvitations, async c => {
  const actor = c.get('actor')
  const input = await readJson(c, inviteWorkspaceMembersSchema)
  if ('emails' in input) {
    const created = await createWorkspaceInvitations(getDb(), actor, c.req.param('slug'), input)
    await enqueueWorkspaceInvitationEmails(
      created.map(invite => invite.id),
      actor.userId
    )
    return c.json({ message: 'Emails sent successfully' })
  }
  const invite = await createWorkspaceInvitation(getDb(), actor, c.req.param('slug'), input)
  await enqueueWorkspaceInvitationEmails([invite.id], actor.userId)
  return c.json(invite, 201)
})
workspaceInvitationsRoutes.get(apiV1Routes.workspaceInvitation, async c =>
  c.json(await getWorkspaceInvitation(getDb(), c.get('actor'), c.req.param('slug'), num(c.req.param('invitationId'))))
)
workspaceInvitationsRoutes.on(['PATCH', 'PUT'], apiV1Routes.workspaceInvitation, async c => {
  const input = await readJson(c, updateWorkspaceInvitationSchema)
  return c.json(
    await updateWorkspaceInvitation(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      num(c.req.param('invitationId')),
      input.role
    )
  )
})
workspaceInvitationsRoutes.delete(apiV1Routes.workspaceInvitation, async c => {
  await deleteWorkspaceInvitation(getDb(), c.get('actor'), c.req.param('slug'), num(c.req.param('invitationId')))
  return c.body(null, 204)
})

/**
 * Invitation link endpoints (WorkspaceJoinEndpoint). The GET is public but needs the e-mailed token, the POST needs a
 * session. Mount this router BEFORE workspacesRoutes: those routers authenticate every /workspaces/* path.
 */
export const workspaceJoinRoutes = new Hono<ApiEnv>()
workspaceJoinRoutes.get(paths.workspaceInvitationJoin, async c =>
  c.json(
    await getWorkspaceJoin(
      getDb(),
      c.req.param('slug'),
      num(c.req.param('invitationId')),
      parseInput(joinWorkspaceInvitationTokenQuerySchema, c.req.query()).token
    )
  )
)
workspaceJoinRoutes.post(paths.workspaceInvitationJoin, authenticate, async c =>
  c.json(
    await createWorkspaceJoin(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      num(c.req.param('invitationId')),
      await readJson(c, joinWorkspaceInvitationSchema)
    )
  )
)

/** /users/me/workspaces/invitations: invitations addressed to the caller. Mount at linkto.users. */
export const userWorkspaceInvitationsRoutes = new Hono<ApiEnv>({ strict: false })
userWorkspaceInvitationsRoutes.get(paths.userWorkspaceInvitations, authenticate, async c =>
  c.json(await listPendingWorkspaceInvitations(getDb(), c.get('actor')))
)
userWorkspaceInvitationsRoutes.post(paths.userWorkspaceInvitations, authenticate, async c => {
  const input = await readJson(c, acceptUserWorkspaceInvitationsSchema)
  await createUserWorkspaceInvitations(getDb(), c.get('actor'), input.invitations)
  return c.body(null, 204)
})
