import { and, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@/db/schema'
import { issueLinks } from '@/db/schema/issue'
import type { InfraEnv } from '@/server/common/env'
import { logIssueJob } from '@/server/issue/activity/index'
import type { LancityDb } from '@/types/database/schema'
import { linkCrawlJobSchema } from '@/types/issue/p1-issue-background-schema'

const DEFAULT_FAVICON =
  'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJsdWNpZGUgbHVjaWRlLWxpbmstaWNvbiBsdWNpZGUtbGluayI+PHBhdGggZD0iTTEwIDEzYTUgNSAwIDAgMCA3LjU0LjU0bDMtM2E1IDUgMCAwIDAtNy4wNy03LjA3bC0xLjcyIDEuNzEiLz48cGF0aCBkPSJNMTQgMTFhNSA1IDAgMCAwLTcuNTQtLjU0bC0zIDNhNSA1IDAgMCAwIDcuMDcgNy4wN2wxLjcxLTEuNzEiLz48L3N2Zz4='
const DEFAULT_FAVICON_URI = `data:image/svg+xml;base64,${DEFAULT_FAVICON}`
const MAX_REDIRECTS = 5
const MAX_TITLE_HTML_BYTES = 1024 * 1024
const MAX_FAVICON_BYTES = 100 * 1024
const MAX_BODY_READ_SECONDS = 10
const REQUEST_TIMEOUT_MS = 5000
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
}

export type HtmlLink = { rel: string; href: string | null }
export type LinkMetadata = {
  title: string | null
  favicon: string | null
  url: string
  favicon_url?: string | null
  error?: string
}

function ipv4Parts(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  const parts = m ? m.slice(1).map(Number) : null
  return parts && parts.every(n => n <= 255) ? parts : null
}

/** Expand an IPv6 literal to 8 groups. Returns null when it is not a valid address. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.split('%')[0].toLowerCase()
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)
  if (dotted) {
    const v4 = ipv4Parts(dotted[1])
    if (!v4) return null
    text =
      text.slice(0, -dotted[1].length) + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16)
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail].map(g =>
    /^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN
  )
  return groups.length === 8 && groups.every(g => !Number.isNaN(g)) ? groups : null
}

/** PD-1231 helper: port of Plane `is_blocked_ip`. Fails closed for anything it cannot parse. */
export function isBlockedIp(ip: string): boolean {
  const v4 = ipv4Parts(ip)
  if (v4) {
    const [a, b, c] = v4
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    )
  }
  const g = ipv6Groups(ip)
  if (!g) return true
  return (
    g[0] >> 8 === 0 || // ::/8 covers unspecified, loopback, IPv4-compatible and IPv4-mapped
    (g[0] & 0xfe00) === 0xfc00 || // unique local
    (g[0] & 0xffc0) === 0xfe80 || // link-local
    (g[0] & 0xffc0) === 0xfec0 || // deprecated site-local
    (g[0] & 0xff00) === 0xff00 || // multicast
    g[0] === 0x2002 || // 6to4
    (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0x0db8)) || // Teredo, documentation
    (g[0] === 0x64 && g[1] === 0xff9b) || // NAT64
    (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) // discard prefix
  )
}

async function resolveHost(hostname: string): Promise<string[]> {
  const addresses: string[] = []
  for (const type of ['A', 'AAAA']) {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(3000)
    })
    if (!res.ok) throw new Error('Hostname could not be resolved')
    const body = (await res.json()) as { Answer?: { type: number; data: string }[] }
    for (const answer of body.Answer ?? []) if (answer.type === 1 || answer.type === 28) addresses.push(answer.data)
  }
  return addresses
}

/**
 * PD-1231. Reject URLs that point to private or internal addresses. Workers cannot call `getaddrinfo`, so hostnames
 * are resolved through Cloudflare DNS over HTTPS and every answer is checked. Throws an Error on rejection.
 */
export async function validateUrlIp(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw new Error('Invalid URL scheme. Only HTTP and HTTPS are allowed')
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!hostname) throw new Error('Invalid URL: No hostname found')
  const blocked = new Error('Access to private/internal networks is not allowed')
  if (ipv4Parts(hostname) || hostname.includes(':')) {
    if (isBlockedIp(hostname)) throw blocked
    return
  }
  if (/(^|\.)(localhost|local|internal|localdomain)$/.test(hostname.toLowerCase())) throw blocked
  const addresses = await resolveHost(hostname)
  if (!addresses.length) throw new Error('No IP addresses found for the hostname')
  if (addresses.some(isBlockedIp)) throw blocked
}

/**
 * PD-1232. GET that validates every hop of a redirect chain. Workers cannot pin the connection to the validated IP,
 * so the DNS check is a pre-filter and the Workers network itself refuses private ranges.
 */
export async function safeGet(url: string, headers: Record<string, string> = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await validateUrlIp(current)
    const response = await fetch(current, { headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel()
      current = new URL(location, current).href
      continue
    }
    return { response, finalUrl: current }
  }
  throw new Error('Too many redirects')
}

/** Read at most `maxBytes` within `maxSeconds`. `truncated` is true when either cap stopped the read. */
export async function readCappedBody(response: Response, maxBytes: number, maxSeconds: number) {
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let truncated = false
  const deadline = Date.now() + maxSeconds * 1000
  while (reader) {
    if (Date.now() > deadline) {
      truncated = true
      break
    }
    const { done, value } = await reader.read()
    if (done) break
    const room = maxBytes - size
    chunks.push(value.length > room ? value.subarray(0, room) : value)
    size += Math.min(value.length, room)
    if (value.length >= room) {
      truncated = value.length > room || !(await reader.read().then(r => r.done))
      break
    }
  }
  await reader?.cancel().catch(() => undefined)
  const content = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    content.set(chunk, at)
    at += chunk.length
  }
  return { content, truncated }
}

/** Title and `<link>` tags of an HTML document (replaces BeautifulSoup). */
async function parseHtml(content: Uint8Array): Promise<{ title: string | null; links: HtmlLink[] }> {
  const links: HtmlLink[] = []
  let titles = 0
  let title = ''
  const rewriter = new HTMLRewriter()
    .on('title', {
      element() {
        titles++
      },
      text(chunk) {
        if (titles === 1) title += chunk.text
      }
    })
    .on('link', {
      element(el) {
        const rel = el.getAttribute('rel')
        if (rel !== null) links.push({ rel, href: el.getAttribute('href') })
      }
    })
  await rewriter.transform(new Response(content as BodyInit)).arrayBuffer()
  return { title: titles ? title.trim() : null, links }
}

const FAVICON_RELS = ['icon', 'shortcut icon', 'apple-touch-icon', 'apple-touch-icon-precomposed']

/** PD-1234. Favicon URL from `<link>` tags, else `/favicon.ico` when it answers a HEAD with 200. */
export async function findFaviconUrl(links: HtmlLink[] | null, baseUrl: string): Promise<string | null> {
  if (links) {
    for (const wanted of FAVICON_RELS) {
      // Like `select_one`, only the first tag with the exact rel is considered.
      const tag = links.find(l => l.rel.trim().split(/\s+/).join(' ').toLowerCase() === wanted)
      if (tag?.href) {
        const href = new URL(tag.href, baseUrl).href
        await validateUrlIp(href)
        return href
      }
    }
  }
  const parsed = new URL(baseUrl)
  const fallback = `${parsed.protocol}//${parsed.host}/favicon.ico`
  try {
    await validateUrlIp(fallback)
    const response = await fetch(fallback, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(2000) })
    return response.status === 200 ? fallback : null
  } catch (error) {
    logIssueJob('warn', 'issue.link.favicon', { message: String(error) })
    return null
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** PD-1235 */
export async function fetchAndEncodeFavicon(headers: Record<string, string>, links: HtmlLink[] | null, url: string) {
  try {
    const faviconUrl = await findFaviconUrl(links, url)
    if (faviconUrl === null) return { favicon_url: null, favicon_base64: DEFAULT_FAVICON_URI }
    const { response } = await safeGet(faviconUrl, headers)
    const contentType = response.headers.get('content-type') ?? 'image/x-icon'
    const { content, truncated } = await readCappedBody(response, MAX_FAVICON_BYTES, MAX_BODY_READ_SECONDS)
    if (truncated) throw new Error('Favicon is too large or took too long to download')
    return { favicon_url: faviconUrl, favicon_base64: `data:${contentType};base64,${toBase64(content)}` }
  } catch (error) {
    logIssueJob('warn', 'issue.link.favicon', { message: `Failed to fetch favicon: ${error}` })
    return { favicon_url: null, favicon_base64: DEFAULT_FAVICON_URI }
  }
}

/** PD-1233 */
export async function crawlWorkItemLinkTitleAndFavicon(url: string): Promise<LinkMetadata> {
  try {
    let title: string | null = null
    let links: HtmlLink[] | null = null
    let finalUrl = url
    try {
      const result = await safeGet(url, HEADERS)
      finalUrl = result.finalUrl
      // A page larger than the cap is parsed up to the cap.
      const { content } = await readCappedBody(result.response, MAX_TITLE_HTML_BYTES, MAX_BODY_READ_SECONDS)
      ;({ title, links } = await parseHtml(content))
    } catch (error) {
      logIssueJob('warn', 'issue.link.crawl', { message: `Failed to fetch HTML for title: ${error}` })
    }
    // The final URL (after redirects) resolves relative favicon hrefs correctly.
    const favicon = await fetchAndEncodeFavicon(HEADERS, links, finalUrl)
    return { title, favicon: favicon.favicon_base64, url, favicon_url: favicon.favicon_url }
  } catch (error) {
    logIssueJob('error', 'issue.link.crawl', { message: String(error) })
    return { error: `Unexpected error: ${error}`, title: null, favicon: null, url }
  }
}

/** PD-1236. Store the crawl result in the link metadata. Safe to repeat. */
export async function crawlWorkItemLinkTitle(env: InfraEnv, raw: unknown): Promise<void> {
  const parsed = linkCrawlJobSchema.safeParse(raw)
  if (!parsed.success) return logIssueJob('error', 'issue.link.crawl', { message: 'Invalid payload' })
  const { id, url } = parsed.data
  const metadata = await crawlWorkItemLinkTitleAndFavicon(url)
  const db = drizzle(env.DB, { schema }) as unknown as LancityDb
  const rows = await db
    .update(issueLinks)
    .set({ metadata: metadata as unknown as Record<string, string>, updatedAt: new Date() })
    .where(and(eq(issueLinks.id, id), isNull(issueLinks.deletedAt)))
    .returning({ id: issueLinks.id })
  if (!rows.length)
    logIssueJob('warn', 'issue.link.crawl', { message: `IssueLink not found for the id ${id} and the url ${url}` })
}
