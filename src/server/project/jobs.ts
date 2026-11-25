import { registerJobHandler } from '@/server/common/jobs'
import { sendMail } from '@/server/common/mail'
import type { MailContent } from '@/server/common/mail-templates'
import { PROJECT_SEND_MAIL } from '@/server/project/events'

type SendMailPayload = { to: string } & MailContent

export function register(): void {
  // Invitation and addition emails. Plane swallows send errors; here a configured SMTP failure is retried by Queues.
  registerJobHandler<SendMailPayload>(PROJECT_SEND_MAIL, async (payload, env) => {
    const result = await sendMail({ to: payload.to, subject: payload.subject, html: payload.html, text: payload.text }, env)
    if (!result.sent && env.GMAIL_USER && env.GMAIL_APP_PASSWORD) throw new Error('Project email was not sent')
  })
}
