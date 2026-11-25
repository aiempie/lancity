export type ParsedUrl = {
  scheme: string
  netloc: string
  path: string
  params: string
  query: string
  fragment: string
  hostname: string | null
  port: number | null
  username: string | null
  password: string | null
}

const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/

/**
 * Lenient URL split that follows Python's `urllib.parse.urlparse` (no validation, never throws).
 * `params` (the `;` segment) is always empty because no caller depends on it.
 */
export function urlparse(url: string): ParsedUrl {
  let rest = url.trim()
  let scheme = ''
  const schemeMatch = SCHEME.exec(rest)
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase()
    rest = rest.slice(schemeMatch[0].length)
  }
  let fragment = ''
  const hashAt = rest.indexOf('#')
  if (hashAt >= 0) {
    fragment = rest.slice(hashAt + 1)
    rest = rest.slice(0, hashAt)
  }
  let query = ''
  const queryAt = rest.indexOf('?')
  if (queryAt >= 0) {
    query = rest.slice(queryAt + 1)
    rest = rest.slice(0, queryAt)
  }
  let netloc = ''
  if (rest.startsWith('//')) {
    const end = rest.slice(2).search(/\//)
    netloc = end < 0 ? rest.slice(2) : rest.slice(2, 2 + end)
    rest = end < 0 ? '' : rest.slice(2 + end)
  }
  const at = netloc.lastIndexOf('@')
  const userinfo = at >= 0 ? netloc.slice(0, at) : null
  const hostport = at >= 0 ? netloc.slice(at + 1) : netloc
  let hostname: string | null = null
  let port: number | null = null
  const bracket = /^\[([^\]]*)\](?::(\d*))?$/.exec(hostport)
  if (bracket) {
    hostname = bracket[1].toLowerCase()
    port = bracket[2] ? Number(bracket[2]) : null
  } else if (hostport) {
    const colon = hostport.lastIndexOf(':')
    const host = colon >= 0 ? hostport.slice(0, colon) : hostport
    const portText = colon >= 0 ? hostport.slice(colon + 1) : ''
    hostname = host ? host.toLowerCase() : null
    port = /^\d+$/.test(portText) ? Number(portText) : null
  }
  const colonAt = userinfo?.indexOf(':') ?? -1
  return {
    scheme,
    netloc,
    path: rest,
    params: '',
    query,
    fragment,
    hostname,
    port: port !== null && port <= 65535 ? port : null,
    username: userinfo === null ? null : colonAt >= 0 ? userinfo.slice(0, colonAt) : userinfo,
    password: userinfo === null || colonAt < 0 ? null : userinfo.slice(colonAt + 1)
  }
}

/** Python `urlunparse` for the pieces `urlparse` returns. */
export function urlunparse(parts: Pick<ParsedUrl, 'scheme' | 'netloc' | 'path' | 'query' | 'fragment'>): string {
  let path = parts.path
  let url = ''
  if (parts.netloc) {
    if (path && !path.startsWith('/')) path = `/${path}`
    url = `//${parts.netloc}${path}`
  } else url = path
  if (parts.scheme) url = `${parts.scheme}:${url}`
  if (parts.query) url += `?${parts.query}`
  if (parts.fragment) url += `#${parts.fragment}`
  return url
}

/** Python `urllib.parse.unquote`: percent-decode as UTF-8, replacing invalid sequences. */
export function unquote(value: string): string {
  return value.replace(/(?:%[0-9a-fA-F]{2})+/g, run => {
    const bytes = Uint8Array.from(run.match(/%[0-9a-fA-F]{2}/g)!, hex => parseInt(hex.slice(1), 16))
    return new TextDecoder().decode(bytes)
  })
}

/** Python `urllib.parse.urlencode` for flat records (spaces become `+`). */
export function urlencode(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) search.append(key, String(value))
  return search.toString()
}

const URL_PATTERN = new RegExp(
  '(?:' +
    'https?://[^\\s]+' +
    '|' +
    'www\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*' +
    '|' +
    '(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,6}' +
    '|' +
    '(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)' +
    ')',
  'i'
)

/** Plane `contains_url`. Inputs over 1000 chars are treated as URL free and each line is cut to 500 chars (ReDoS guard). */
export function containsUrl(value: string): boolean {
  if (value.length > 1000) return false
  return value.split('\n').some(line => URL_PATTERN.test(line.length > 500 ? line.slice(0, 500) : line))
}

/** Plane `is_valid_url`: a URL needs both scheme and network location. */
export function isValidUrl(url: string): boolean {
  if (typeof url !== 'string') return false
  const { scheme, netloc } = urlparse(url)
  return Boolean(scheme && netloc)
}

/** Plane `get_url_components`: null when the URL is not valid. */
export function getUrlComponents(url: string): Pick<ParsedUrl, 'scheme' | 'netloc' | 'path' | 'params' | 'query' | 'fragment'> | null {
  if (!isValidUrl(url)) return null
  const { scheme, netloc, path, params, query, fragment } = urlparse(url)
  return { scheme, netloc, path, params, query, fragment }
}

/** Plane `normalize_url_path`: collapse repeated slashes in the path only. */
export function normalizeUrlPath(url: string): string {
  const parts = urlparse(url)
  return urlunparse({ ...parts, path: parts.path.replace(/\/+/g, '/') })
}
