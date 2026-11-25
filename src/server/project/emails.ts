import { linkto } from '@/data/linkto'
import { renderEmail, type MailContent } from '@/server/common/mail-templates'

/** Path of the page that lets an invited user accept or decline a project invitation. */
export const PROJECT_INVITATION_PATH = linkto.projectInvitations

/** Plane `project_invitation` task: the email carries a link to the invitation page. */
export function projectInvitationEmail(input: {
  inviter: string
  projectName: string
  origin: string
  slug: string
  projectId: number
  invitationId: number
  email: string
  token: string
}): MailContent {
  const query = new URLSearchParams({
    invitation_id: String(input.invitationId),
    email: input.email,
    token: input.token,
    slug: input.slug,
    project_id: String(input.projectId)
  })
  return renderEmail({
    subject: `${input.inviter} invited you to join ${input.projectName} on Lancity`,
    heading: `Join ${input.projectName}`,
    paragraphs: [`${input.inviter} invited you to join the project ${input.projectName} on Lancity.`],
    action: { label: 'View invitation', url: `${input.origin}${PROJECT_INVITATION_PATH}?${query}` }
  })
}

/** Plane `project_add_user_email` task: tells a user that an admin added them to a project. */
export function projectAdditionEmail(input: {
  inviter: string
  projectName: string
  workspaceName: string
  projectUrl: string
}): MailContent {
  return renderEmail({
    subject: 'You have been added to a Lancity project',
    heading: `You were added to ${input.projectName}`,
    paragraphs: [`${input.inviter} added you to the project ${input.projectName} in ${input.workspaceName}.`],
    action: { label: 'Open project', url: input.projectUrl }
  })
}
