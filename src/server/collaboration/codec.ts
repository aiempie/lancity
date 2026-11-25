import * as Y from 'yjs'
import { decodeEntities } from '@/server/page/html-processor'
import { extractTextFromHTML } from '@/server/collaboration/title-utils'

/**
 * Yjs, ProseMirror JSON and HTML codecs for the Plane editor documents (PD-2048, PD-2061, PD-2062).
 * Plane builds these with TipTap schemas and a DOM. Workers have no DOM, so this module maps the editor node and
 * mark names directly. Fields: `default` holds the content, `title` holds the page title heading.
 */

export type PmMark = { type: string; attrs?: Record<string, unknown> }
export type PmNode = { type: string; attrs?: Record<string, unknown>; content?: PmNode[]; text?: string; marks?: PmMark[] }

const BLOCK_CONTAINERS = new Set(['doc', 'blockquote', 'listItem', 'taskItem', 'tableCell', 'tableHeader', 'calloutComponent'])
const TEXT_PARENTS = new Set(['paragraph', 'heading', 'codeBlock'])

// ------------------------------------------------------------------ Yjs -> ProseMirror JSON

function textNodes(text: Y.XmlText): PmNode[] {
  const nodes: PmNode[] = []
  for (const op of text.toDelta() as { insert: unknown; attributes?: Record<string, Record<string, unknown> | null> }[]) {
    if (typeof op.insert !== 'string' || !op.insert) continue
    const marks = Object.entries(op.attributes ?? {}).map(([name, attrs]) => ({
      type: name.replace(/--.*$/, ''),
      ...(attrs && Object.keys(attrs).length ? { attrs } : {})
    }))
    nodes.push({ type: 'text', text: op.insert, ...(marks.length ? { marks } : {}) })
  }
  return nodes
}

function childNodes(parent: Y.XmlFragment | Y.XmlElement): PmNode[] {
  const nodes: PmNode[] = []
  for (const child of parent.toArray()) {
    if (child instanceof Y.XmlText) nodes.push(...textNodes(child))
    else if (child instanceof Y.XmlElement) {
      const attrs = child.getAttributes() as Record<string, unknown>
      const content = childNodes(child)
      nodes.push({
        type: child.nodeName,
        ...(Object.keys(attrs).length ? { attrs } : {}),
        ...(content.length ? { content } : {})
      })
    }
  }
  return nodes
}

/** Equivalent of `yXmlFragmentToProseMirrorRootNode(fragment, schema).toJSON()`. */
export function fragmentToJson(fragment: Y.XmlFragment): PmNode {
  const content = childNodes(fragment)
  return { type: 'doc', ...(content.length ? { content } : {}) }
}

// ------------------------------------------------------------------ ProseMirror JSON -> Yjs

function toDelta(nodes: PmNode[]) {
  return nodes.map(node => ({
    insert: node.text ?? '',
    ...(node.marks?.length
      ? { attributes: Object.fromEntries(node.marks.map(mark => [mark.type, mark.attrs ?? {}])) }
      : {})
  }))
}

function toYNodes(nodes: PmNode[]): (Y.XmlElement | Y.XmlText)[] {
  const result: (Y.XmlElement | Y.XmlText)[] = []
  for (let index = 0; index < nodes.length; ) {
    if (nodes[index].type === 'text') {
      const run: PmNode[] = []
      while (index < nodes.length && nodes[index].type === 'text') run.push(nodes[index++])
      const text = new Y.XmlText()
      text.applyDelta(toDelta(run))
      result.push(text)
      continue
    }
    const node = nodes[index++]
    const element = new Y.XmlElement(node.type)
    for (const [key, value] of Object.entries(node.attrs ?? {}))
      if (value !== null && value !== undefined) element.setAttribute(key, value as string)
    if (node.content?.length) element.insert(0, toYNodes(node.content))
    result.push(element)
  }
  return result
}

/** Equivalent of `prosemirrorJSONToYXmlFragment`: replace the fragment content with the document nodes. */
export function jsonToFragment(fragment: Y.XmlFragment, doc: PmNode): void {
  if (fragment.length) fragment.delete(0, fragment.length)
  if (doc.content?.length) fragment.insert(0, toYNodes(doc.content))
}

/** PD-2087: the title heading used by the `title` field. */
export function generateTitleProsemirrorJson(text: string): PmNode {
  return {
    type: 'doc',
    content: [{ type: 'heading', attrs: { level: 1 }, ...(text ? { content: [{ type: 'text', text }] } : {}) }]
  }
}

// ------------------------------------------------------------------ ProseMirror JSON -> HTML

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

function htmlAttributes(attrs: Record<string, unknown> | undefined, skip: string[] = []): string {
  return Object.entries(attrs ?? {})
    .filter(([key, value]) => !skip.includes(key) && value !== null && value !== undefined && value !== false && value !== '')
    .map(([key, value]) => ` ${key.toLowerCase()}="${escapeHtml(String(value))}"`)
    .join('')
}

const alignStyle = (attrs?: Record<string, unknown>) =>
  typeof attrs?.textAlign === 'string' && attrs.textAlign !== 'left' ? ` style="text-align: ${escapeHtml(attrs.textAlign)}"` : ''

function markHtml(mark: PmMark, inner: string): string {
  const attrs = mark.attrs ?? {}
  switch (mark.type) {
    case 'bold': return `<strong>${inner}</strong>`
    case 'italic': return `<em>${inner}</em>`
    case 'underline': return `<u>${inner}</u>`
    case 'strike': return `<s>${inner}</s>`
    case 'code': return `<code>${inner}</code>`
    case 'subscript': return `<sub>${inner}</sub>`
    case 'superscript': return `<sup>${inner}</sup>`
    case 'link': return `<a${htmlAttributes(attrs)}>${inner}</a>`
    case 'highlight': return `<mark${htmlAttributes(attrs.color ? { 'data-color': attrs.color } : undefined)}>${inner}</mark>`
    case 'textStyle': return attrs.color ? `<span style="color: ${escapeHtml(String(attrs.color))}">${inner}</span>` : inner
    case 'customColor': {
      const styles = [attrs.color && `color: ${attrs.color}`, attrs.backgroundColor && `background-color: ${attrs.backgroundColor}`]
      return `<span style="${escapeHtml(styles.filter(Boolean).join('; '))}">${inner}</span>`
    }
    default: return inner
  }
}

/** Equivalent of TipTap `generateHTML` for the Plane node set. Unknown nodes render as `div[data-type]`. */
export function jsonToHtml(node: PmNode): string {
  if (node.type === 'text') return (node.marks ?? []).reduce((html, mark) => markHtml(mark, html), escapeHtml(node.text ?? ''))
  const inner = (node.content ?? []).map(jsonToHtml).join('')
  const attrs = node.attrs
  switch (node.type) {
    case 'doc': return inner
    case 'paragraph': return `<p${alignStyle(attrs)}>${inner}</p>`
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(attrs?.level) || 1))
      return `<h${level}${alignStyle(attrs)}>${inner}</h${level}>`
    }
    case 'blockquote': return `<blockquote>${inner}</blockquote>`
    case 'codeBlock':
      return `<pre><code${attrs?.language ? ` class="language-${escapeHtml(String(attrs.language))}"` : ''}>${inner}</code></pre>`
    case 'bulletList': return `<ul>${inner}</ul>`
    case 'orderedList': return `<ol${attrs?.start && Number(attrs.start) !== 1 ? ` start="${Number(attrs.start)}"` : ''}>${inner}</ol>`
    case 'listItem': return `<li>${inner}</li>`
    case 'taskList': return `<ul data-type="taskList">${inner}</ul>`
    case 'taskItem': return `<li data-type="taskItem" data-checked="${attrs?.checked ? 'true' : 'false'}">${inner}</li>`
    case 'horizontalRule': return '<hr>'
    case 'hardBreak': return '<br>'
    case 'table': return `<table><tbody>${inner}</tbody></table>`
    case 'tableRow': return `<tr${htmlAttributes(attrs)}>${inner}</tr>`
    case 'tableHeader': return `<th${htmlAttributes(attrs)}>${inner}</th>`
    case 'tableCell': return `<td${htmlAttributes(attrs)}>${inner}</td>`
    case 'image': return `<img${htmlAttributes(attrs)}>`
    case 'imageComponent': return `<image-component${htmlAttributes(attrs)}></image-component>`
    case 'mention': return `<mention-component${htmlAttributes(attrs)}></mention-component>`
    default: return `<div data-type="${escapeHtml(node.type)}"${htmlAttributes(attrs)}>${inner}</div>`
  }
}

// ------------------------------------------------------------------ HTML -> ProseMirror JSON

type Frame = { node: PmNode; tag: string; marks: PmMark[] }
const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const VOID = new Set(['br', 'hr', 'img', 'input', 'col', 'wbr', 'meta', 'link'])
const SKIP = new Set(['script', 'style', 'head', 'title'])

function parseAttributes(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of raw.matchAll(ATTRIBUTE)) result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
  return result
}

function styleValue(style: string | undefined, property: string): string | undefined {
  return style
    ?.split(';')
    .map(part => part.split(':'))
    .find(([key]) => key.trim().toLowerCase() === property)?.[1]
    ?.trim()
}

/** Map an HTML element to a block node, an inline mark or neither (transparent container). */
function classify(tag: string, a: Record<string, string>): { node?: PmNode; mark?: PmMark } {
  const num = (value: string | undefined, fallback: number) => (value && Number.isFinite(Number(value)) ? Number(value) : fallback)
  switch (tag) {
    case 'p': return { node: { type: 'paragraph', ...(styleValue(a.style, 'text-align') ? { attrs: { textAlign: styleValue(a.style, 'text-align') } } : {}) } }
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return { node: { type: 'heading', attrs: { level: Number(tag[1]) } } }
    case 'blockquote': return { node: { type: 'blockquote' } }
    case 'pre': return { node: { type: 'codeBlock', ...(a.language ? { attrs: { language: a.language } } : {}) } }
    case 'ul': return { node: { type: a['data-type'] === 'taskList' ? 'taskList' : 'bulletList' } }
    case 'ol': return { node: { type: 'orderedList', attrs: { start: num(a.start, 1) } } }
    case 'li':
      return { node: a['data-type'] === 'taskItem' ? { type: 'taskItem', attrs: { checked: a['data-checked'] === 'true' } } : { type: 'listItem' } }
    case 'hr': return { node: { type: 'horizontalRule' } }
    case 'br': return { node: { type: 'hardBreak' } }
    case 'table': return { node: { type: 'table' } }
    case 'tr': return { node: { type: 'tableRow' } }
    case 'th': case 'td':
      return {
        node: {
          type: tag === 'th' ? 'tableHeader' : 'tableCell',
          attrs: { colspan: num(a.colspan, 1), rowspan: num(a.rowspan, 1), ...(a.colwidth ? { colwidth: a.colwidth.split(',').map(Number) } : {}), ...(a.background ? { background: a.background } : {}) }
        }
      }
    case 'img': return { node: { type: 'image', attrs: { src: a.src ?? null, alt: a.alt ?? null, width: a.width ?? null, height: a.height ?? null } } }
    case 'image-component':
      return { node: { type: 'imageComponent', attrs: { id: a.id ?? null, src: a.src ?? null, width: a.width ?? null, height: a.height ?? null, aspectRatio: a.aspectratio ?? null, alignment: a.alignment ?? null, status: a.status ?? null } } }
    case 'mention-component':
      return { node: { type: 'mention', attrs: { id: a.id ?? null, entity_identifier: a.entity_identifier ?? null, entity_name: a.entity_name ?? null, entity_type: a.entity_type ?? null } } }
    case 'div': return a['data-type'] === 'calloutComponent' ? { node: { type: 'calloutComponent' } } : {}
    case 'strong': case 'b': return { mark: { type: 'bold' } }
    case 'em': case 'i': return { mark: { type: 'italic' } }
    case 'u': return { mark: { type: 'underline' } }
    case 's': case 'strike': case 'del': return { mark: { type: 'strike' } }
    case 'code': return { mark: { type: 'code' } }
    case 'sub': return { mark: { type: 'subscript' } }
    case 'sup': return { mark: { type: 'superscript' } }
    case 'a': return { mark: { type: 'link', attrs: { href: a.href ?? null, target: a.target ?? '_blank', rel: a.rel ?? 'noopener noreferrer nofollow' } } }
    case 'mark': return { mark: { type: 'highlight', attrs: { color: a['data-color'] ?? styleValue(a.style, 'background-color') ?? null } } }
    case 'span': {
      const color = styleValue(a.style, 'color')
      return color ? { mark: { type: 'textStyle', attrs: { color } } } : {}
    }
    default: return {}
  }
}

/** Group inline children under paragraphs where the parent only accepts blocks (ProseMirror content rules). */
function normalize(node: PmNode): PmNode {
  if (!node.content) return node
  const content = node.content.map(normalize)
  if (!BLOCK_CONTAINERS.has(node.type)) return { ...node, content }
  const result: PmNode[] = []
  let run: PmNode[] = []
  const flush = () => {
    if (run.some(item => item.type !== 'text' || item.text?.trim())) result.push({ type: 'paragraph', content: run })
    run = []
  }
  for (const child of content) {
    if (child.type === 'text' || child.type === 'hardBreak' || child.type === 'mention') run.push(child)
    else {
      flush()
      result.push(child)
    }
  }
  flush()
  return { ...node, content: result.length ? result : [{ type: 'paragraph' }] }
}

/** Parse editor HTML into a ProseMirror document. Tolerant: unknown tags are transparent, text is entity-decoded. */
export function htmlToJson(html: string): PmNode {
  const root: Frame = { node: { type: 'doc', content: [] }, tag: '', marks: [] }
  const stack: Frame[] = [root]
  let skipUntil: string | null = null
  let index = 0
  /** Nearest real node: mark and wrapper frames pass their content to it. */
  const top = () => [...stack].reverse().find(frame => frame.node.type) ?? root
  const addText = (raw: string) => {
    const inCode = stack.some(frame => frame.node.type === 'codeBlock')
    const text = inCode ? decodeEntities(raw) : decodeEntities(raw).replace(/\s+/g, ' ')
    if (!text) return
    const parent = top().node
    if (!inCode && !text.trim() && !TEXT_PARENTS.has(parent.type)) return
    const marks = stack.flatMap(frame => frame.marks)
    ;(parent.content ??= []).push({ type: 'text', text, ...(marks.length ? { marks } : {}) })
  }
  for (const match of html.matchAll(TOKEN)) {
    if (match.index > index && !skipUntil) addText(html.slice(index, match.index))
    index = match.index + match[0].length
    if (match[0].startsWith('<!--')) continue
    const closing = match[1] === '/'
    const tag = match[2].toLowerCase()
    if (skipUntil) {
      if (closing && tag === skipUntil) skipUntil = null
      continue
    }
    if (closing) {
      for (let depth = stack.length - 1; depth > 0; depth--)
        if (stack[depth].tag === tag) {
          stack.length = depth
          break
        }
      continue
    }
    if (SKIP.has(tag)) {
      skipUntil = tag
      continue
    }
    const attrs = parseAttributes(match[3])
    const { node, mark } = classify(tag, attrs)
    // `<pre><code>` is one code block: the inner `code` mark is dropped inside it.
    const insidePre = stack.some(frame => frame.node.type === 'codeBlock')
    const frame: Frame = { node: node ?? { type: '' }, tag, marks: mark && !(tag === 'code' && insidePre) ? [mark] : [] }
    if (tag === 'code' && insidePre && attrs.class?.startsWith('language-')) {
      const block = [...stack].reverse().find(item => item.node.type === 'codeBlock')
      if (block) block.node.attrs = { language: attrs.class.slice('language-'.length) }
    }
    if (node) (top().node.content ??= []).push(node)
    if (!VOID.has(tag) && !match[4]) stack.push(frame)
  }
  if (!skipUntil && index < html.length) addText(html.slice(index))
  const doc = normalize(root.node)
  return doc.content?.length ? doc : { type: 'doc', content: [{ type: 'paragraph' }] }
}

// ------------------------------------------------------------------ document formats

export type DocumentFormats = {
  contentBinaryEncoded: string
  contentJSON: PmNode
  contentHTML: string
  titleHTML?: string
}

export const encodeBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
export const decodeBase64 = (value: string) => new Uint8Array(Buffer.from(value, 'base64'))

/** PD-2062: all stored formats of a Yjs state (`getAllDocumentFormatsFromDocumentEditorBinaryData`). */
export function getAllDocumentFormatsFromBinary(binary: Uint8Array, updateTitle = false): DocumentFormats {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, binary)
  const contentJSON = fragmentToJson(doc.getXmlFragment('default'))
  const result: DocumentFormats = { contentBinaryEncoded: encodeBase64(binary), contentJSON, contentHTML: jsonToHtml(contentJSON) }
  if (updateTitle) result.titleHTML = extractTextFromHTML(jsonToHtml(fragmentToJson(doc.getXmlFragment('title'))))
  return result
}

/** PD-2061: Yjs state for HTML content, optionally merged with the title field. */
export function getBinaryDataFromHtml(html: string | null | undefined, title?: string | null): Uint8Array {
  const doc = new Y.Doc()
  jsonToFragment(doc.getXmlFragment('default'), htmlToJson(html || '<p></p>'))
  if (title !== undefined && title !== null) jsonToFragment(doc.getXmlFragment('title'), generateTitleProsemirrorJson(title))
  return Y.encodeStateAsUpdate(doc)
}

/** PD-2048: HTML to every stored format. `rich` and `document` share the field layout. */
export function convertHtmlDocumentToAllFormats(html: string) {
  const { contentBinaryEncoded, contentHTML, contentJSON } = getAllDocumentFormatsFromBinary(getBinaryDataFromHtml(html))
  return { description_json: contentJSON, description_html: contentHTML, description_binary: contentBinaryEncoded }
}
