import { getEnv, type InfraEnv } from '@/server/common/env'

export type MailInput = {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  replyTo?: string
}

type MailEnv = Pick<InfraEnv, 'GMAIL_USER' | 'GMAIL_APP_PASSWORD' | 'MAIL_FROM'>

/** True when Gmail SMTP credentials are configured. */
export function isMailConfigured(env: MailEnv = getEnv()): boolean {
  return Boolean(env.GMAIL_USER && env.GMAIL_APP_PASSWORD)
}

/**
 * Send one email through Gmail SMTP (smtp.gmail.com:465, implicit TLS) with nodemailer.
 * Needs the `nodejs_compat` flag because nodemailer uses node:net and node:tls.
 * When credentials are missing the message is logged and skipped, so local dev works without SMTP.
 */
export async function sendMail(input: MailInput, env: MailEnv = getEnv()): Promise<{ sent: boolean; messageId?: string }> {
  if (!input.html && !input.text) throw new Error('sendMail requires html or text')
  if (!isMailConfigured(env)) {
    console.warn(JSON.stringify({ level: 'warn', label: 'mail', message: 'SMTP not configured, email skipped', subject: input.subject }))
    return { sent: false }
  }
  const { createTransport } = await import('nodemailer')
  const transport = createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD }
  })
  try {
    const info = await transport.sendMail({
      from: env.MAIL_FROM || env.GMAIL_USER,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo
    })
    return { sent: true, messageId: info.messageId }
  } finally {
    transport.close()
  }
}
