import { sanitizeHtml } from '@/server/issue/comment-html'

/** Port of plane/utils/content_validator.py. Other domains import `validateHtmlContent` from here. */

/** Maximum size of binary data and HTML content (10 MB). */
export const MAX_SIZE = 10 * 1024 * 1024

export const SUSPICIOUS_BINARY_PATTERNS = ['<html', '<!doctype', '<script', 'javascript:', 'data:', '<iframe']

export type BinaryValidationResult = { isValid: boolean; error: string | null }
export type HtmlValidationResult = { isValid: boolean; error: string | null; cleanHtml: string | null }
export type HtmlSanitizationDiff = { removedTags: Record<string, number>; removedAttributes: Record<string, string[]> }

/** Decode base64 like Python `b64decode` (characters outside the alphabet are ignored). Null when malformed. */
export function decodeBase64(value: string): Uint8Array | null {
  const cleaned = value.replace(/[^A-Za-z0-9+/=]/g, '')
  if (cleaned.length % 4 !== 0) return null
  try {
    const binary = atob(cleaned)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/** Validate Yjs/binary document data given as bytes or a base64 string (PD-1712). Empty data is valid. */
export function validateBinaryData(data: Uint8Array | string | null | undefined): BinaryValidationResult {
  if (!data || (typeof data !== 'string' && data.length === 0)) return { isValid: true, error: null }
  const bytes = typeof data === 'string' ? decodeBase64(data) : data
  if (!bytes) return { isValid: false, error: 'Invalid base64 encoding' }
  if (bytes.length > MAX_SIZE) return { isValid: false, error: 'Binary data exceeds maximum size limit (10MB)' }
  if (bytes.length < 4) return { isValid: false, error: 'Binary data too short to be valid document format' }
  // Python decodes with errors="ignore", which drops invalid sequences instead of keeping U+FFFD.
  const head = new TextDecoder().decode(bytes).replaceAll('\ufffd', '').slice(0, 200).toLowerCase()
  if (SUSPICIOUS_BINARY_PATTERNS.some(pattern => head.includes(pattern)))
    return { isValid: false, error: 'Binary data contains suspicious content patterns' }
  return { isValid: true, error: null }
}

const TAG = /<!--[\s\S]*?-->|<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g

function collect(html: string) {
  const counts = new Map<string, number>()
  const attributes = new Map<string, Set<string>>()
  for (const match of html.matchAll(TAG)) {
    if (!match[1]) continue
    const tag = match[1].toLowerCase()
    counts.set(tag, (counts.get(tag) ?? 0) + 1)
    const names = attributes.get(tag) ?? new Set<string>()
    for (const attribute of match[2].matchAll(ATTRIBUTE)) names.add(attribute[1].toLowerCase())
    attributes.set(tag, names)
  }
  return { counts, attributes }
}

/** Coarse diff between the original and sanitized HTML: removed tag counts and removed attribute names (PD-1713, PD-1714). */
export function computeHtmlSanitizationDiff(beforeHtml: string, afterHtml: string): HtmlSanitizationDiff {
  try {
    const before = collect(beforeHtml || '')
    const after = collect(afterHtml || '')
    const removedTags: Record<string, number> = {}
    for (const [tag, count] of before.counts) {
      const remaining = after.counts.get(tag) ?? 0
      if (remaining < count) removedTags[tag] = count - remaining
    }
    const removedAttributes: Record<string, string[]> = {}
    for (const [tag, names] of before.attributes) {
      const kept = after.attributes.get(tag)
      const removed = [...names].filter(name => !kept?.has(name)).sort()
      if (removed.length) removedAttributes[tag] = removed
    }
    return { removedTags, removedAttributes }
  } catch {
    // Best effort only; a failed diff never blocks the request.
    return { removedTags: {}, removedAttributes: {} }
  }
}

/**
 * Sanitize HTML with the shared allow-list (Plane uses nh3). Returns `cleanHtml: null` for empty input,
 * which callers treat as "keep the original value" (PD-1715).
 */
export function validateHtmlContent(htmlContent: string | null | undefined): HtmlValidationResult {
  if (!htmlContent) return { isValid: true, error: null, cleanHtml: null }
  if (new TextEncoder().encode(htmlContent).length > MAX_SIZE)
    return { isValid: false, error: 'HTML content exceeds maximum size limit (10MB)', cleanHtml: null }
  try {
    const cleanHtml = sanitizeHtml(htmlContent)
    const diff = computeHtmlSanitizationDiff(htmlContent, cleanHtml)
    if (Object.keys(diff.removedTags).length || Object.keys(diff.removedAttributes).length)
      console.warn(
        JSON.stringify({ level: 'warn', label: 'content-validator', message: 'HTML sanitization removals', diff })
      )
    return { isValid: true, error: null, cleanHtml }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        label: 'content-validator',
        message: error instanceof Error ? error.message : String(error)
      })
    )
    return { isValid: false, error: 'Failed to sanitize HTML', cleanHtml: null }
  }
}

/** True when the value has at least one letter or digit in any script (PD-1716). */
export function hasAlphanumeric(value: string | null | undefined): boolean {
  return /[\p{L}\p{N}]/u.test(value ?? '')
}
