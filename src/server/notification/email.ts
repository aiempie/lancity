import { escapeHtml, stripTags } from '@/server/issue/comment-html'

const STYLE_OPEN = /<style/gi
const STYLE_CLOSE = /<\/style>/gi

function searchFrom(pattern: RegExp, text: string, from: number) {
  pattern.lastIndex = from
  return pattern.exec(text)
}

/** Plane `_remove_style_blocks` (PD-1729): drop `<style ...>...</style>` blocks in one forward scan. */
export function removeStyleBlocks(html: string): string {
  const parts: string[] = []
  let pos = 0
  for (;;) {
    const start = searchFrom(STYLE_OPEN, html, pos)
    if (!start) break
    const tagEnd = html.indexOf('>', start.index + start[0].length)
    if (tagEnd === -1) break
    const close = searchFrom(STYLE_CLOSE, html, tagEnd + 1)
    if (!close) break
    parts.push(html.slice(pos, start.index))
    pos = close.index + close[0].length
  }
  parts.push(html.slice(pos))
  return parts.join('')
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

/** The subset of Python `html.unescape` that email templates produce (named basics and numeric references). */
function unescapeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] !== '#') return NAMED_ENTITIES[entity.toLowerCase()] ?? match
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
  })
}

/**
 * Plane `generate_plain_text_from_html` (PD-1730): remove style blocks and tags, decode character references,
 * collapse runs of blank lines and surround the text with two newlines.
 */
export function generatePlainTextFromHtml(html: string): string {
  const text = unescapeHtml(stripTags(removeStyleBlocks(html))).replace(/\n\s*\n\s*\n+/g, '\n\n')
  return `\n\n${text.trim()}\n\n`
}

export type IssueEmailChange = { old_value?: string[]; new_value?: string[] }
export type IssueEmailContext = {
  issueIdentifier: string
  issueName: string
  issueUrl: string
  projectUrl: string
  workspace: string
  project: string
  preferenceUrl: string
  receiverEmail: string
  entityType: string
  summary: string
  actorsInvolved: number
  updates: { actorName: string; activityTime: string; changes: Record<string, IssueEmailChange> }[]
  comments: { actorName: string; values: string[] }[]
}

const shown = (values: string[] | undefined) => (values ?? []).filter(value => value !== '' && value !== 'None')
const label = (field: string) => field.replace(/_/g, ' ')

function changeRow(field: string, change: IssueEmailChange): string {
  const added = shown(change.new_value)
  const removed = shown(change.old_value)
  const pills = (values: string[], style: string) =>
    values.map(value => `<span style="${style}">${escapeHtml(value)}</span>`).join(' ')
  return `<tr><td style="padding:2px 8px 2px 0;font-size:13px;color:#60646c;text-transform:capitalize">${escapeHtml(label(field))}</td><td style="font-size:13px">${pills(
    removed,
    'color:#641723;text-decoration:line-through;margin-right:4px'
  )} ${pills(added, 'color:#0d74ce;font-weight:500')}</td></tr>`
}

/** Plane `emails/notifications/issue-updates.html`: updates grouped by actor, then comments, then a link. */
export function renderIssueUpdatesEmail(ctx: IssueEmailContext): string {
  const first = ctx.updates[0]?.actorName ?? ctx.comments[0]?.actorName ?? 'Someone'
  const updates = ctx.updates
    .map(
      update => `<div style="border:1px solid #e0e1e6;border-radius:6px;padding:12px;margin:12px 0">
<p style="margin:0 0 8px;font-size:13px"><strong>${escapeHtml(update.actorName)}</strong> <span style="color:#80838d">${escapeHtml(update.activityTime)}</span></p>
<table role="presentation" cellspacing="0" cellpadding="0">${Object.entries(update.changes)
        .map(([field, change]) => changeRow(field, change))
        .join('')}</table></div>`
    )
    .join('')
  const comments = ctx.comments.length
    ? `<div style="border:1px solid #e0e1e6;border-radius:6px;padding:12px;margin:12px 0">${ctx.comments
        .map(
          comment =>
            `<p style="margin:0 0 4px;font-size:13px"><strong>${escapeHtml(comment.actorName)}</strong></p>${comment.values
              .map(value => `<p style="margin:0 0 8px;font-size:14px">${escapeHtml(stripTags(value))}</p>`)
              .join('')}`
        )
        .join('')}</div>`
    : ''
  const link = (url: string, text: string) =>
    `<a href="${escapeHtml(url)}" style="color:#3a5bc7;text-decoration:none">${escapeHtml(text)}</a>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>Updates on ${escapeHtml(ctx.entityType)}</title></head><body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2d5c"><div style="max-width:600px;margin:24px auto;background:#fff;border-radius:8px;padding:28px">
<p style="margin:0 0 4px;font-weight:600">${escapeHtml(ctx.issueIdentifier)} updates</p>
<p style="margin:0 0 16px;font-weight:500">${escapeHtml(ctx.workspace)}/${link(ctx.projectUrl, ctx.project)}/${link(ctx.issueUrl, ctx.issueIdentifier)}: ${escapeHtml(ctx.issueName)}</p>
<p style="margin:0 0 8px">${escapeHtml(ctx.summary)} <strong>${escapeHtml(first)}</strong>${ctx.actorsInvolved > 1 ? ' and others' : ''}.</p>
${updates}${comments}
<p style="margin:20px 0"><a href="${escapeHtml(ctx.issueUrl)}" style="background:#3e63dd;color:#fff;padding:10px 15px;border-radius:4px;text-decoration:none;font-size:13px;display:inline-block">View ${escapeHtml(ctx.entityType)}</a></p>
<p style="margin:24px 0 0;color:#6b7280;font-size:12px">This email was sent to ${escapeHtml(ctx.receiverEmail)}. If you would rather not receive this kind of email, you can ${link(ctx.issueUrl, `unsubscribe from the ${ctx.entityType}`)} or ${link(ctx.preferenceUrl, 'manage your email preferences')}.</p>
</div></body></html>`
}
