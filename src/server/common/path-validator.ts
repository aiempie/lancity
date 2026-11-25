import { unquote, urlencode, urlparse } from '@/server/common/url'
import type { HostEnv } from '@/server/common/host'

/**
 * Plane `sanitize_filename`: strip control characters, directory parts, `..` and leading dots.
 * Returns null for empty or missing input so callers can still require a filename.
 */
export function sanitizeFilename(filename: unknown): string | null {
  if (!filename || typeof filename !== 'string') return null
  let name = filename.replace(/[\u0000-\u001f\u007f]/g, '')
  name = name.replaceAll('\\', '/')
  name = name.slice(name.lastIndexOf('/') + 1)
  name = name.replaceAll('..', '').trim().replace(/^\.+/, '').trim()
  return name || null
}

const SUSPICIOUS_PATTERNS = [
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'ftp:',
  '%2e%2e',
  '%2f%2f',
  '%5c%5c',
  '<script',
  '<iframe',
  '<object',
  '<embed',
  '<form',
  'onload=',
  'onerror=',
  'onclick='
]

/** Plane `_contains_suspicious_patterns`. */
export function containsSuspiciousPatterns(path: string): boolean {
  const lower = path.toLowerCase()
  return SUSPICIOUS_PATTERNS.some(pattern => lower.includes(pattern))
}

/** Plane `get_allowed_hosts`: the host (with port) of every configured base URL, without duplicates. */
export function getAllowedHosts(env: HostEnv): string[] {
  const hosts: string[] = []
  for (const url of [env.WEB_URL, env.APP_BASE_URL, env.ADMIN_BASE_URL, env.SPACE_BASE_URL, env.BETTER_AUTH_URL]) {
    if (!url) continue
    const host = urlparse(url).netloc
    if (host && !hosts.includes(host)) hosts.push(host)
  }
  return hosts
}

/** Plane `validate_next_path`: returns `next_path` when it is a safe relative path, otherwise an empty string. */
export function validateNextPath(nextPath: unknown): string {
  if (!nextPath || typeof nextPath !== 'string' || nextPath.length > 500) return ''
  // Browsers treat backslashes as slashes and drop tab, CR and LF before parsing a URL.
  let path = nextPath.replaceAll('\\', '').replace(/[\t\r\n]/g, '')
  const parsed = urlparse(path)
  if (parsed.scheme || parsed.netloc) path = parsed.path
  if (!path || !path.startsWith('/')) return ''
  if (path.startsWith('//')) return ''
  if (path.includes('..')) return ''
  if (containsSuspiciousPatterns(path)) return ''
  // The reader percent-decodes the value, so its decoded form must pass unchanged. Three rounds cover real nesting.
  let decoded = path
  for (let i = 0; i < 3; i++) decoded = unquote(decoded)
  if (unquote(decoded) !== decoded) return ''
  if (decoded !== path && validateNextPath(decoded) !== decoded) return ''
  return path
}

/**
 * Django `url_has_allowed_host_and_scheme`: true when the URL is relative or points at one of `allowedHosts`
 * with an http(s) scheme (https only when `requireHttps`).
 */
export function urlHasAllowedHostAndScheme(url: string, allowedHosts: string[], requireHttps = false): boolean {
  const value = url.trim()
  if (!value || value.startsWith('///')) return false
  const info = urlparse(value)
  if (!info.netloc && info.scheme) return false
  if (/^[\u0000-\u001f\u007f-\u009f]/.test(value)) return false
  const scheme = !info.scheme && info.netloc ? 'http' : info.scheme
  const validSchemes = requireHttps ? ['https'] : ['http', 'https']
  return (!info.netloc || allowedHosts.includes(info.netloc)) && (!scheme || validSchemes.includes(scheme))
}

/** Plane `get_safe_redirect_url`: build `base_url/?next_path=...&params` and fall back to the bare base URL if unsafe. */
export function getSafeRedirectUrl(env: HostEnv, baseUrl: string, nextPath = '', params: Record<string, unknown> = {}): string {
  const validated = validateNextPath(nextPath)
  const base = baseUrl.replace(/\/+$/, '')
  const parts: string[] = []
  if (validated) parts.push(urlencode({ next_path: validated }))
  const hasParams = Object.keys(params).length > 0
  const encoded = hasParams ? urlencode(params) : ''
  if (encoded) parts.push(encoded)
  const url = parts.length ? `${base}/?${parts.join('&')}` : base
  if (urlHasAllowedHostAndScheme(url, getAllowedHosts(env))) return url
  return base + (encoded ? `?${encoded}` : '')
}
