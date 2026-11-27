import { ServiceError } from '@/server/common/errors'

/** Allow-list HTML sanitizer for comment bodies. Port of Plane `validate_html_content` (nh3 tags + editor components). */
const maxHtmlBytes = 10 * 1024 * 1024
const allowedTags = new Set(
  (
    'a abbr acronym area article aside b bdi bdo blockquote br caption center cite code col colgroup data dd del details dfn ' +
    'div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup hr i img ins kbd li map mark nav ol p pre q rp rt ' +
    'rtc ruby s samp small span strike strong sub summary sup table tbody td tfoot th thead time tr tt u ul var wbr ' +
    'mention-component label input image-component issue-embed-component'
  ).split(' ')
)
const voidTags = new Set(['area', 'br', 'col', 'hr', 'img', 'input', 'wbr'])
const dropContentTags = new Set(['script', 'style'])
// Plane `ATTRIBUTES["*"]` (content_validator.py:82-113). nh3 has no `data-*` wildcard, so only these 15 keys pass.
const globalAttributes = new Set(
  (
    'class id title role aria-label aria-hidden style start type xmlns ' +
    'data-tight data-node-type data-type data-checked data-background-color data-text-color data-name data-id ' +
    'data-icon-name data-icon-color data-background data-emoji-unicode data-emoji-url data-logo-in-use data-block-type'
  ).split(' ')
)
const tagAttributes: Record<string, Set<string>> = {
  a: new Set(['href', 'target']),
  'image-component': new Set(['width', 'height', 'aspectratio', 'src', 'alignment', 'status']),
  img: new Set(['width', 'height', 'aspectratio', 'alignment', 'src', 'alt']),
  'mention-component': new Set(['entity_identifier', 'entity_name']),
  // Lancity: the work item embed of the document editor (Plane drops it). Pages rebuild their content from this HTML
  // when duplicated or restored from a version, so the embed has to survive sanitizing.
  'issue-embed-component': new Set(['entity_identifier', 'project_identifier', 'workspace_identifier', 'entity_name']),
  th: new Set(['colspan', 'rowspan', 'colwidth', 'background']),
  td: new Set(['colspan', 'rowspan', 'colwidth', 'background', 'textcolor']),
  tr: new Set(['background', 'textcolor']),
  pre: new Set(['language']),
  code: new Set(['language', 'spellcheck']),
  input: new Set(['checked'])
}
const safeProtocols = new Set(['http', 'https', 'mailto', 'tel'])
const tagPattern = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g
const attributePattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

const namedEntities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  colon: ':',
  tab: '\t',
  newline: '\n',
  lpar: '(',
  rpar: ')',
  sol: '/',
  bsol: '\\',
  num: '#',
  equals: '=',
  quest: '?',
  plus: '+',
  comma: ',',
  period: '.',
  semi: ';',
  excl: '!',
  percnt: '%',
  lsqb: '[',
  rsqb: ']',
  lbrack: '[',
  rbrack: ']',
  lowbar: '_',
  hyphen: '-',
  dash: '-',
  commat: '@',
  dollar: '$',
  ast: '*',
  midast: '*',
  vert: '|',
  grave: '`'
}
// Legacy entities that browsers also decode without the trailing semicolon.
const legacyEntities = new Set(['amp', 'lt', 'gt', 'quot', 'nbsp'])
const entityPattern = /&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|([A-Za-z][A-Za-z0-9]*));?/g

/** Decode character references the way a browser does in attribute values (decimal, hex, named, optional `;`). */
export function decodeEntities(value: string): string {
  return value.replace(
    entityPattern,
    (whole, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
      if (hex !== undefined || dec !== undefined) {
        const code = hex !== undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec as string, 10)
        if (!Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
          return '\ufffd'
        return String.fromCodePoint(code)
      }
      const key = (name as string).toLowerCase()
      const known = Object.hasOwn(namedEntities, name as string) ? namedEntities[name as string] : namedEntities[key]
      if (known === undefined) return whole
      // Without a semicolon only the legacy entities decode.
      if (!whole.endsWith(';') && !legacyEntities.has(key)) return whole
      return known
    }
  )
}

function safeUrl(value: string) {
  const compact = decodeEntities(value)
    .replace(/[\u0000-\u0020\u007f-\u009f\u00a0\u1680\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff]/g, '')
    .toLowerCase()
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(compact)
  return !scheme || safeProtocols.has(scheme[1])
}
function escapeAttribute(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
function renderAttributes(tag: string, raw: string) {
  const allowedForTag = tagAttributes[tag]
  const seen = new Set<string>()
  let out = ''
  for (const match of raw.matchAll(attributePattern)) {
    const name = match[1].toLowerCase()
    if (seen.has(name)) continue // html5 parsing keeps the first duplicate
    seen.add(name)
    const rawValue = match[2] ?? match[3] ?? match[4]
    const value = rawValue === undefined ? undefined : decodeEntities(rawValue)
    const allowed = globalAttributes.has(name) || allowedForTag?.has(name)
    if (!allowed || name.startsWith('on')) continue
    if (['href', 'src'].includes(name) && rawValue !== undefined && !safeUrl(rawValue)) continue
    if (name === 'style' && value !== undefined && /url\s*\(|expression|javascript:|@import|\\|\/\*/i.test(value))
      continue
    out += value === undefined ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`
  }
  // nh3 `link_rel` defaults to "noopener noreferrer" on every <a>.
  if (tag === 'a') out += ' rel="noopener noreferrer"'
  return out
}
function escapeText(text: string) {
  return text.replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** Return sanitized HTML. Throws 400 when the content exceeds 10 MiB. */
export function sanitizeHtml(html: string): string {
  if (new TextEncoder().encode(html).length > maxHtmlBytes)
    throw new ServiceError(400, 'VALIDATION_ERROR', 'HTML content exceeds maximum size limit (10MB)')
  let out = ''
  let cursor = 0
  let skipUntil: string | null = null
  for (const match of html.matchAll(tagPattern)) {
    const index = match.index ?? 0
    if (skipUntil === null) out += escapeText(html.slice(cursor, index))
    cursor = index + match[0].length
    if (!match[2]) continue
    const tag = match[2].toLowerCase()
    const closing = match[1] === '/'
    if (skipUntil !== null) {
      if (closing && tag === skipUntil) skipUntil = null
      continue
    }
    if (dropContentTags.has(tag)) {
      if (!closing) skipUntil = tag
      continue
    }
    if (!allowedTags.has(tag)) continue
    if (closing) {
      if (!voidTags.has(tag)) out += `</${tag}>`
    } else out += `<${tag}${renderAttributes(tag, match[3])}>`
  }
  if (skipUntil === null) out += escapeText(html.slice(cursor))
  return out
}

/** Port of Django `strip_tags` as used by `IssueComment.save`. */
export function stripTags(html: string): string {
  let previous: string
  let value = html
  do {
    previous = value
    value = value.replace(/<[^>]*>/g, '')
  } while (value !== previous)
  return value
}

export function escapeHtml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
