import { resolveAndValidate, type HostResolver, type IpNetwork } from '@/server/common/ip-address'
import { urlparse } from '@/server/common/url'

/**
 * SSRF-safe outbound HTTP (Plane `url_security.py`).
 *
 * Limit: Python pins the socket to the validated IP to defeat DNS rebinding. A Worker cannot connect to
 * an IP literal while keeping the original Host and TLS name, so the host is resolved and validated once
 * (DNS over HTTPS) and `fetch` then resolves it again. Cloudflare's network refuses subrequests to
 * private and loopback addresses, which closes the rebinding window for internal targets.
 * Redirects are never followed by `fetch`; `pinnedFetchFollowingRedirects` re-validates every hop.
 */

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export type SecureFetchOptions = {
  allowedIps?: IpNetwork[]
  allowedHosts?: Iterable<string | null | undefined>
  headers?: HeadersInit
  /** Seconds, like Plane. */
  timeout?: number
  body?: BodyInit | null
  resolver?: HostResolver
}

export type UrlTarget = {
  scheme: 'http' | 'https'
  hostname: string
  port: number
  path: string
  auth: [string, string] | null
}

/** Plane `_split_target`: the pieces of a URL needed to build a request. Credentials move to `auth`. */
export function splitTarget(url: string): UrlTarget {
  const parts = urlparse(url)
  if (parts.scheme !== 'http' && parts.scheme !== 'https') {
    throw new Error('Invalid URL scheme. Only HTTP and HTTPS are allowed')
  }
  if (!parts.hostname) throw new Error('Invalid URL: No hostname found')
  const decode = (value: string) => decodeURIComponent(value)
  return {
    scheme: parts.scheme as 'http' | 'https',
    hostname: parts.hostname,
    port: parts.port ?? (parts.scheme === 'https' ? 443 : 80),
    path: (parts.path || '/') + (parts.query ? `?${parts.query}` : ''),
    auth: parts.username !== null || parts.password !== null ? [decode(parts.username ?? ''), decode(parts.password ?? '')] : null
  }
}

/**
 * Plane `_request_to_ip` and `_fetch_validated_hop`: resolve and validate the host, then issue one request
 * without following redirects. Hosts in `allowedHosts` skip the internal-address check.
 */
export async function fetchValidatedHop(
  method: string,
  url: string,
  options: SecureFetchOptions = {}
): Promise<{ response: Response; normalizedHost: string }> {
  const target = splitTarget(url)
  const normalizedHost = target.hostname.replace(/\.$/, '').toLowerCase()
  const trusted = new Set([...(options.allowedHosts ?? [])].filter(Boolean).map(host => host!.replace(/\.$/, '').toLowerCase()))
  await resolveAndValidate(target.hostname, {
    allowedIps: options.allowedIps,
    requireSafe: !trusted.has(normalizedHost),
    resolver: options.resolver
  })
  const headers = new Headers(options.headers)
  if (target.auth && !headers.has('authorization')) {
    headers.set('authorization', `Basic ${btoa(`${target.auth[0]}:${target.auth[1]}`)}`)
  }
  const defaultPort = target.scheme === 'https' ? 443 : 80
  const host = target.hostname.includes(':') ? `[${target.hostname}]` : target.hostname
  const response = await fetch(`${target.scheme}://${host}${target.port === defaultPort ? '' : `:${target.port}`}${target.path}`, {
    method,
    headers,
    body: options.body,
    redirect: 'manual',
    signal: AbortSignal.timeout((options.timeout ?? 30) * 1000)
  })
  return { response, normalizedHost }
}

/** Plane `pinned_fetch`: SSRF-safe single request that does not follow redirects. */
export async function pinnedFetch(method: string, url: string, options: SecureFetchOptions = {}): Promise<Response> {
  return (await fetchValidatedHop(method, url, options)).response
}

/** Plane `pinned_fetch_following_redirects`: follow redirects by hand, validating every hop. */
export async function pinnedFetchFollowingRedirects(
  method: string,
  url: string,
  options: SecureFetchOptions & { maxRedirects?: number } = {}
): Promise<{ response: Response; finalUrl: string }> {
  const maxRedirects = options.maxRedirects ?? 5
  let currentUrl = url
  for (let redirects = 0; ; redirects++) {
    const { response } = await fetchValidatedHop(method, currentUrl, options)
    const location = response.headers.get('location')
    if (!REDIRECT_STATUSES.has(response.status) || !location) return { response, finalUrl: currentUrl }
    await response.body?.cancel()
    if (redirects >= maxRedirects) throw new Error(`Exceeded ${maxRedirects} redirects for URL: ${url}`)
    currentUrl = new URL(location, currentUrl).toString()
  }
}

/**
 * Plane `read_capped_body`: read at most `maxBytes`, stopping early after `maxSeconds`.
 * Returns the content and whether it was cut short. The response body is always released.
 */
export async function readCappedBody(
  response: Response,
  maxBytes: number,
  maxSeconds: number
): Promise<{ content: Uint8Array; truncated: boolean }> {
  const reader = response.body?.getReader()
  if (!reader) return { content: new Uint8Array(), truncated: false }
  const deadline = Date.now() + maxSeconds * 1000
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.byteLength
      if (size > maxBytes || Date.now() > deadline) {
        return { content: concat(chunks, size).slice(0, maxBytes), truncated: true }
      }
    }
    return { content: concat(chunks, size), truncated: false }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}
