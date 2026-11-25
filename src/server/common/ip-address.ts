import { urlparse } from '@/server/common/url'

/** Raised for URLs and hostnames that must not be fetched (Python `ValueError` in `ip_address.py`). */
export class UrlSecurityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UrlSecurityError'
  }
}

export type ParsedIp = { version: 4 | 6; bytes: number[] }
export type IpNetwork = { version: 4 | 6; bytes: number[]; prefix: number }

function parseIpv4(text: string): number[] | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  const bytes: number[] = []
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255) return null
    bytes.push(Number(part))
  }
  return bytes
}

function parseIpv6(text: string): number[] | null {
  let source = text
  const lastColon = source.lastIndexOf(':')
  if (source.includes('.')) {
    const v4 = parseIpv4(source.slice(lastColon + 1))
    if (!v4) return null
    source = `${source.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`
  }
  const halves = source.split('::')
  if (halves.length > 2) return null
  const toGroups = (part: string): number[] | null => {
    if (part === '') return []
    const groups: number[] = []
    for (const group of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null
      groups.push(parseInt(group, 16))
    }
    return groups
  }
  const head = toGroups(halves[0])
  const tail = halves.length === 2 ? toGroups(halves[1]) : []
  if (!head || !tail) return null
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  const groups = [...head, ...new Array<number>(halves.length === 2 ? missing : 0).fill(0), ...tail]
  return groups.flatMap(group => [group >> 8, group & 255])
}

/** Parse an IPv4 or IPv6 literal. A zone id (`%eth0`) is not accepted, strip it first. */
export function parseIp(text: string): ParsedIp | null {
  const value = text.trim()
  if (value.includes(':')) {
    const bytes = parseIpv6(value)
    return bytes ? { version: 6, bytes } : null
  }
  const bytes = parseIpv4(value)
  return bytes ? { version: 4, bytes } : null
}

/** Parse `a.b.c.d/len` or an IPv6 CIDR. A bare address counts as a host network. */
export function parseNetwork(text: string): IpNetwork | null {
  const [address, length] = text.trim().split('/')
  const ip = parseIp(address)
  if (!ip) return null
  const max = ip.version === 4 ? 32 : 128
  const prefix = length === undefined ? max : /^\d+$/.test(length) ? Number(length) : -1
  return prefix >= 0 && prefix <= max ? { ...ip, prefix } : null
}

/** Parse a comma separated list of CIDRs (e.g. WEBHOOK_ALLOWED_IPS), ignoring entries that are not valid. */
export function parseNetworks(csv: string | undefined): IpNetwork[] {
  return (csv ?? '')
    .split(',')
    .map(parseNetwork)
    .filter((network): network is IpNetwork => network !== null)
}

function inNetwork(ip: ParsedIp, net: IpNetwork): boolean {
  if (ip.version !== net.version) return false
  let remaining = net.prefix
  for (let i = 0; remaining > 0; i++, remaining -= 8) {
    const bits = Math.min(8, remaining)
    const mask = (0xff << (8 - bits)) & 0xff
    if ((ip.bytes[i] & mask) !== (net.bytes[i] & mask)) return false
  }
  return true
}

const net = (cidr: string): IpNetwork => parseNetwork(cidr)!

/** Networks the stdlib may misclassify (Plane `_BLOCKED_NETWORKS`). */
const BLOCKED_NETWORKS = [
  '0.0.0.0/8',
  '100.64.0.0/10',
  '169.254.0.0/16',
  '255.255.255.255/32',
  '::ffff:0:0/96',
  '64:ff9b::/96',
  '64:ff9b:1::/48',
  '2002::/16',
  '2001::/32',
  'fec0::/10'
].map(net)

/**
 * Special-purpose ranges (Python `ip.is_private` plus `is_reserved`, `is_multicast`, `is_link_local`).
 * The few globally routable exceptions Python carves out of `is_private` stay blocked here, which fails closed.
 */
const SPECIAL_NETWORKS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/29',
  '192.0.0.170/31',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '255.255.255.255/32',
  '::/128',
  '::1/128',
  '::ffff:0:0/96',
  '64:ff9b:1::/48',
  '100::/64',
  '2001::/23',
  '2001:db8::/32',
  '2002::/16',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
  '::/8',
  '100::/8',
  '200::/7',
  '400::/6',
  '800::/5',
  '1000::/4',
  '4000::/3',
  '6000::/3',
  '8000::/3',
  'a000::/3',
  'c000::/3',
  'e000::/4',
  'f000::/5',
  'f800::/6',
  'fe00::/9'
].map(net)

/** IPv4 addresses carried inside IPv6 transition formats (Plane `_embedded_ipv4`). */
export function embeddedIpv4(ip: ParsedIp): ParsedIp[] {
  if (ip.version !== 6) return []
  const found: ParsedIp[] = []
  const v4 = (bytes: number[]): ParsedIp => ({ version: 4, bytes })
  const b = ip.bytes
  if (b.slice(0, 10).every(x => x === 0) && b[10] === 0xff && b[11] === 0xff) found.push(v4(b.slice(12)))
  if (b[0] === 0x20 && b[1] === 0x02) found.push(v4(b.slice(2, 6)))
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) {
    found.push(v4(b.slice(4, 8)), v4(b.slice(12).map(x => x ^ 0xff)))
  }
  if (inNetwork(ip, net('64:ff9b::/96'))) found.push(v4(b.slice(12)))
  return found
}

/** SSRF check: true when `ip` must never be an outbound target. Unparseable input is blocked. */
export function isBlockedIp(ip: ParsedIp | string): boolean {
  const parsed = typeof ip === 'string' ? parseIp(ip) : ip
  if (!parsed) return true
  if ([...SPECIAL_NETWORKS, ...BLOCKED_NETWORKS].some(network => inNetwork(parsed, network))) return true
  return embeddedIpv4(parsed).some(isBlockedIp)
}

/** True when `ip` is inside an operator-trusted allowlist network (Plane `_is_allowed_ip`). */
export function isAllowedIp(ip: ParsedIp, allowedIps?: IpNetwork[]): boolean {
  return Boolean(allowedIps?.length) && allowedIps!.some(network => inNetwork(ip, network))
}

export type HostResolver = (hostname: string) => Promise<string[]>

type DohAnswer = { type: number; data: string }

/** Resolve A and AAAA records over DNS-over-HTTPS (Workers has no `getaddrinfo`). */
export const resolveHostname: HostResolver = async hostname => {
  const lookup = async (type: 'A' | 'AAAA'): Promise<string[]> => {
    const url = new URL('https://cloudflare-dns.com/dns-query')
    url.searchParams.set('name', hostname)
    url.searchParams.set('type', type)
    const response = await fetch(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error(`DNS lookup failed with ${response.status}`)
    const body = (await response.json()) as { Answer?: DohAnswer[] }
    return (body.Answer ?? []).filter(answer => answer.type === (type === 'A' ? 1 : 28)).map(answer => answer.data)
  }
  const settled = await Promise.allSettled([lookup('A'), lookup('AAAA')])
  if (settled.every(result => result.status === 'rejected')) throw new Error('Hostname could not be resolved')
  return settled.flatMap(result => (result.status === 'fulfilled' ? result.value : []))
}

/**
 * Resolve `hostname` and, unless `requireSafe` is false, reject any address that is internal.
 * Returns the unique resolved addresses in resolver order (Plane `resolve_and_validate`).
 */
export async function resolveAndValidate(
  hostname: string,
  options: { allowedIps?: IpNetwork[]; requireSafe?: boolean; resolver?: HostResolver } = {}
): Promise<string[]> {
  const { allowedIps, requireSafe = true, resolver = resolveHostname } = options
  let addresses: string[]
  const literal = parseIp(hostname.replace(/^\[|\]$/g, ''))
  if (literal) addresses = [hostname.replace(/^\[|\]$/g, '')]
  else {
    try {
      addresses = await resolver(new URL(`http://${hostname}`).hostname)
    } catch {
      throw new UrlSecurityError('Hostname could not be resolved')
    }
  }
  if (!addresses.length) throw new UrlSecurityError('No IP addresses found for the hostname')
  const validated: string[] = []
  for (const address of addresses) {
    const text = address.split('%')[0]
    const ip = parseIp(text)
    if (requireSafe && (!ip || (!isAllowedIp(ip, allowedIps) && isBlockedIp(ip)))) {
      throw new UrlSecurityError('Access to private/internal networks is not allowed')
    }
    if (!validated.includes(text)) validated.push(text)
  }
  return validated
}

/**
 * Plane `validate_url`: reject URLs that are not http(s) or that resolve to internal addresses.
 * Hosts in `allowedHosts` (exact, case-insensitive) skip the IP check.
 */
export async function validateUrl(
  url: string,
  options: { allowedIps?: IpNetwork[]; allowedHosts?: Iterable<string | null | undefined>; resolver?: HostResolver } = {}
): Promise<void> {
  const parsed = urlparse(url)
  if (!parsed.hostname) throw new UrlSecurityError('Invalid URL: No hostname found')
  if (parsed.scheme !== 'http' && parsed.scheme !== 'https') {
    throw new UrlSecurityError('Invalid URL scheme. Only HTTP and HTTPS are allowed')
  }
  const normalized = parsed.hostname.replace(/\.$/, '').toLowerCase()
  const trusted = new Set([...(options.allowedHosts ?? [])].filter(Boolean).map(host => host!.replace(/\.$/, '').toLowerCase()))
  if (trusted.has(normalized)) return
  await resolveAndValidate(parsed.hostname, { allowedIps: options.allowedIps, resolver: options.resolver })
}

/**
 * Plane `get_client_ip`. Cloudflare sets `CF-Connecting-IP` itself, so it wins over `X-Forwarded-For`
 * (first entry), which clients can forge. Returns null when neither header exists.
 */
export function getClientIp(source: Request | Headers): string | null {
  const headers = source instanceof Request ? source.headers : source
  const cf = headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || null
}
