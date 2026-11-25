import { lt } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { authCounters } from '@/db/schema/ext-p1-auth'
import { enqueueJob, registerJobHandler, registerScheduled } from '@/server/common/jobs'
import { getEnv } from '@/server/common/env'
import { sendMail } from '@/server/common/mail'
import type { MailContent } from '@/server/common/mail-templates'

export const SEND_MAIL = 'identity.send_mail'

type SendMailPayload = { to: string } & MailContent

/** Queue one transactional auth email (retried by Queues, idempotent enough: a retry may resend). */
export function queueAuthMail(to: string, content: MailContent): Promise<void> {
  return enqueueJob(getEnv(), { type: SEND_MAIL, payload: { to, ...content } satisfies SendMailPayload })
}

export function register(): void {
  registerJobHandler<SendMailPayload>(SEND_MAIL, async (payload, env) => {
    const result = await sendMail({ to: payload.to, subject: payload.subject, html: payload.html, text: payload.text }, env)
    if (!result.sent && env.GMAIL_USER && env.GMAIL_APP_PASSWORD) throw new Error('Auth email was not sent')
  })
  // Drop expired throttle windows; the table is also pruned opportunistically on writes.
  registerScheduled('15 3 * * *', async env => {
    await getDb(env.DB).delete(authCounters).where(lt(authCounters.expiresAt, new Date()))
  }, 'identity.prune_auth_counters')
}
