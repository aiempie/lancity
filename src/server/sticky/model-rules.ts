import { sql } from 'drizzle-orm'
import { stickies } from '@/db/schema/notification'
import { ServiceError } from '@/server/common/errors'
import { sanitizeHtml, stripTags } from '@/server/issue/comment-html'

const MAX_BINARY_BYTES = 10 * 1024 * 1024
const SUSPICIOUS_BINARY_PATTERNS = ['<html', '<!doctype', '<script', 'javascript:', 'data:', '<iframe']

/** `Sticky.save` (PD-1490): the search text is the description with tags removed, null for empty HTML. */
export function stickyDescriptionStripped(html: string | null | undefined): string | null {
  return html === '' || html === null || html === undefined ? null : stripTags(html)
}

/** `Sticky.save` on insert: one step after the largest sort order of the workspace, 65535 for the first sticky. */
export function nextStickySortOrder(workspaceId: number) {
  return sql<number>`coalesce((select max(s.sort_order) from ${stickies} s where s.workspace_id = ${workspaceId} and s.deleted_at is null) + 10000, 65535)`
}

/** `StickySerializer.validate` (PD-0047), HTML part: sanitise, or answer 400 when the content is refused. */
export function validateStickyHtml(html: string | undefined): string | undefined {
  if (!html) return html
  try {
    return sanitizeHtml(html)
  } catch (error) {
    if (error instanceof ServiceError) throw error
    throw new ServiceError(400, 'VALIDATION_ERROR', 'html content is not valid')
  }
}

/** `validate_binary_data`: decode base64 and refuse oversized, tiny or HTML-looking content. */
export function validateStickyBinary(value: string | null | undefined): Uint8Array | null | undefined {
  if (!value) return value === null ? null : undefined
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0))
  } catch {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid base64 encoding', {
      description_binary: 'Invalid binary data'
    })
  }
  const invalid = (message: string) =>
    new ServiceError(400, 'VALIDATION_ERROR', message, { description_binary: 'Invalid binary data' })
  if (bytes.length > MAX_BINARY_BYTES) throw invalid('Binary data exceeds maximum size limit (10MB)')
  if (bytes.length < 4) throw invalid('Binary data too short to be valid document format')
  const head = new TextDecoder().decode(bytes.slice(0, 200)).toLowerCase()
  if (SUSPICIOUS_BINARY_PATTERNS.some(pattern => head.includes(pattern)))
    throw invalid('Binary data contains suspicious content patterns')
  return bytes
}
