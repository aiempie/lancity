export type MailContent = { subject: string; html: string; text: string }

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)

/** Wrap a paragraph list and optional call-to-action in the shared email layout. */
export function renderEmail(input: {
  subject: string
  heading: string
  paragraphs: string[]
  action?: { label: string; url: string }
  footer?: string
}): MailContent {
  const body = input.paragraphs.map(p => `<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(p)}</p>`).join('')
  const button = input.action
    ? `<p style="margin:20px 0"><a href="${escapeHtml(input.action.url)}" style="background:#3f76ff;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(input.action.label)}</a></p>`
    : ''
  const footer = input.footer ? `<p style="margin:24px 0 0;color:#6b7280;font-size:12px">${escapeHtml(input.footer)}</p>` : ''
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827"><div style="max-width:560px;margin:24px auto;background:#fff;border-radius:8px;padding:28px"><h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(input.heading)}</h1>${body}${button}${footer}</div></body></html>`
  const text = [input.heading, ...input.paragraphs, input.action ? `${input.action.label}: ${input.action.url}` : '', input.footer ?? '']
    .filter(Boolean)
    .join('\n\n')
  return { subject: input.subject, html, text }
}

/** Email with a one-time code, for magic link, password reset and email change flows. */
export const codeEmail = (subject: string, heading: string, code: string): MailContent =>
  renderEmail({ subject, heading, paragraphs: ['Your verification code is:', code, 'The code expires soon. Ignore this email if you did not request it.'] })

/** Email with a single link, for invitations and password reset. */
export const linkEmail = (subject: string, heading: string, paragraph: string, label: string, url: string): MailContent =>
  renderEmail({ subject, heading, paragraphs: [paragraph], action: { label, url } })
