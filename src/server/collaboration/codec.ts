import * as Y from 'yjs'
import { decodeEntities } from '@/server/page/html-processor'
import { EMOJI_GLYPHS } from '@/server/collaboration/emoji-glyphs'
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
//
// The HTML follows what the editor writes with `generateHTML` (src/components/editor, checked by
// tests/editor/codec-roundtrip.test.ts) so that the stored HTML reads back into the same document. Block ids that
// the live editors add (`UniqueID`) are written as `data-id`.

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

function htmlAttributes(attrs: Record<string, unknown> | undefined, skip: string[] = []): string {
  return Object.entries(attrs ?? {})
    .filter(
      ([key, value]) => !skip.includes(key) && value !== null && value !== undefined && value !== false && value !== ''
    )
    .map(([key, value]) => ` ${key.toLowerCase()}="${escapeHtml(String(value))}"`)
    .join('')
}

const attribute = (name: string, value: unknown) =>
  value === null || value === undefined || value === '' ? '' : ` ${name}="${escapeHtml(String(value))}"`

const dataId = (attrs?: Record<string, unknown>) => attribute('data-id', attrs?.id)

/** Inline styles are only written for plain color values, so a stored attribute cannot add other CSS. */
const CSS_COLOR = /^(?:#[0-9a-f]{3,8}|[a-z]{3,30}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%/]+\))$/i
/** Editor palette keys (`COLORS_LIST`): colored through `data-*` selectors in the editor CSS, not inline styles. */
const PRESET_COLORS = new Set(['gray', 'peach', 'pink', 'orange', 'green', 'light-blue', 'dark-blue', 'purple'])
const cssColor = (value: unknown) =>
  typeof value === 'string' && value !== 'none' && !PRESET_COLORS.has(value) && CSS_COLOR.test(value.trim())
    ? value.trim()
    : undefined

function styleAttribute(...declarations: (string | false | undefined)[]): string {
  const css = declarations.filter(Boolean).join('; ')
  return css ? ` style="${escapeHtml(css)}"` : ''
}

const textAlign = (attrs?: Record<string, unknown>) =>
  typeof attrs?.textAlign === 'string' && attrs.textAlign ? `text-align: ${attrs.textAlign}` : undefined

const colorStyle = (background: unknown, color: unknown) => {
  const backgroundCss = cssColor(background)
  const colorCss = cssColor(color)
  return styleAttribute(backgroundCss && `background-color: ${backgroundCss}`, colorCss && `color: ${colorCss}`)
}

function markHtml(mark: PmMark, inner: string): string {
  const attrs = mark.attrs ?? {}
  switch (mark.type) {
    case 'bold':
      return `<strong>${inner}</strong>`
    case 'italic':
      return `<em>${inner}</em>`
    case 'underline':
      return `<u>${inner}</u>`
    case 'strike':
      return `<s>${inner}</s>`
    case 'code':
      return `<code>${inner}</code>`
    case 'subscript':
      return `<sub>${inner}</sub>`
    case 'superscript':
      return `<sup>${inner}</sup>`
    case 'link':
      return `<a${htmlAttributes(attrs)}>${inner}</a>`
    case 'highlight':
      return `<mark${htmlAttributes(attrs.color ? { 'data-color': attrs.color } : undefined)}>${inner}</mark>`
    case 'customColor': {
      const color = cssColor(attrs.color)
      const background = cssColor(attrs.backgroundColor)
      return (
        `<span${attribute('data-text-color', attrs.color)}${attribute('data-background-color', attrs.backgroundColor)}` +
        `${styleAttribute(color && `color: ${color}`, background && `background-color: ${background}`)}>${inner}</span>`
      )
    }
    default:
      return inner
  }
}

/** Equivalent of TipTap `generateHTML` for the Plane node set. Unknown nodes render as `div[data-type]`. */
export function jsonToHtml(node: PmNode): string {
  if (node.type === 'text')
    return (node.marks ?? []).reduce((html, mark) => markHtml(mark, html), escapeHtml(node.text ?? ''))
  const inner = (node.content ?? []).map(jsonToHtml).join('')
  const attrs = node.attrs
  switch (node.type) {
    case 'doc':
      return inner
    case 'paragraph':
      return `<p${dataId(attrs)}${styleAttribute(textAlign(attrs))}>${inner}</p>`
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(attrs?.level) || 1))
      return `<h${level}${dataId(attrs)}${styleAttribute(textAlign(attrs))}>${inner}</h${level}>`
    }
    case 'blockquote':
      return `<blockquote${dataId(attrs)}>${inner}</blockquote>`
    case 'codeBlock':
      return `<pre${dataId(attrs)}><code${attrs?.language ? ` class="language-${escapeHtml(String(attrs.language))}"` : ''}>${inner}</code></pre>`
    case 'bulletList':
      return `<ul${dataId(attrs)}>${inner}</ul>`
    case 'orderedList':
      return `<ol${dataId(attrs)}${attrs?.start && Number(attrs.start) !== 1 ? ` start="${Number(attrs.start)}"` : ''}${attribute('type', attrs?.type)}>${inner}</ol>`
    case 'listItem':
      return `<li${dataId(attrs)}>${inner}</li>`
    case 'taskList':
      return `<ul${dataId(attrs)} data-type="taskList">${inner}</ul>`
    case 'taskItem': {
      const checked = attrs?.checked === true || attrs?.checked === 'true'
      return (
        `<li${dataId(attrs)} data-checked="${checked}" data-type="taskItem">` +
        `<label><input type="checkbox"${checked ? ' checked="checked"' : ''}><span></span></label><div>${inner}</div></li>`
      )
    }
    case 'horizontalRule':
      return `<hr${dataId(attrs)}>`
    case 'hardBreak':
      return '<br>'
    case 'table':
      return `<table${dataId(attrs)}><tbody>${inner}</tbody></table>`
    case 'tableRow':
      return `<tr${attribute('background', attrs?.background)}${attribute('textcolor', attrs?.textColor)}${colorStyle(attrs?.background, attrs?.textColor)}>${inner}</tr>`
    case 'tableHeader':
    case 'tableCell': {
      const tag = node.type === 'tableHeader' ? 'th' : 'td'
      const colwidth = Array.isArray(attrs?.colwidth) ? attrs.colwidth.join(',') : attrs?.colwidth
      return (
        `<${tag}${attribute('colspan', attrs?.colspan)}${attribute('rowspan', attrs?.rowspan)}${attribute('colwidth', colwidth)}` +
        `${attribute('background', attrs?.background)}${attribute('textcolor', attrs?.textColor)}` +
        `${colorStyle(attrs?.background, attrs?.textColor)}>${inner}</${tag}>`
      )
    }
    case 'image':
      return `<img${dataId(attrs)}${htmlAttributes(attrs, ['id'])}>`
    case 'imageComponent':
      return `<image-component${dataId(attrs)}${htmlAttributes(attrs)}></image-component>`
    case 'mention':
      return `<mention-component${htmlAttributes(attrs)}></mention-component>`
    // Like the editor: the glyph when the name is known, otherwise the shortcode. The node reads back from `data-name`.
    case 'emoji': {
      const name = String(attrs?.name ?? '')
      return `<span${attribute('data-name', attrs?.name)} data-type="emoji">${escapeHtml(EMOJI_GLYPHS[name] ?? `:${name}:`)}</span>`
    }
    case 'calloutComponent':
      return `<div${dataId(attrs)}${htmlAttributes({ ...attrs, 'data-block-type': 'callout-component' })}>${inner}</div>`
    case 'issue-embed-component':
      return `<issue-embed-component${dataId(attrs)}${htmlAttributes(attrs)}></issue-embed-component>`
    default:
      return `<div data-type="${escapeHtml(node.type)}"${htmlAttributes(attrs)}>${inner}</div>`
  }
}

// ------------------------------------------------------------------ HTML -> ProseMirror JSON

/** `leaf`: an atom node whose HTML children are presentation only (emoji glyph, horizontal rule inner div). */
type Frame = { node: PmNode; tag: string; marks: PmMark[]; leaf?: boolean }
const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const VOID = new Set(['br', 'hr', 'img', 'input', 'col', 'wbr', 'meta', 'link'])
const SKIP = new Set(['script', 'style', 'head', 'title'])
/** Inline nodes: grouped under a paragraph when they sit directly in a block container. */
const INLINE_NODES = new Set(['text', 'hardBreak', 'mention', 'emoji'])
/** Callout attributes (`ECalloutAttributeNames` of the editor), kept as `data-*` names like the editor does. */
const CALLOUT_ATTRIBUTES = [
  'data-icon-color',
  'data-icon-name',
  'data-emoji-unicode',
  'data-emoji-url',
  'data-logo-in-use',
  'data-background',
  'data-block-type'
]

function parseAttributes(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of raw.matchAll(ATTRIBUTE))
    result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
  return result
}

function styleValue(style: string | undefined, property: string): string | undefined {
  return style
    ?.split(';')
    .map(part => part.split(':'))
    .find(([key]) => key.trim().toLowerCase() === property)?.[1]
    ?.trim()
}

/** Node or mark with the attributes that are present. Missing ones are left out so the editor applies its defaults. */
function withAttrs<T extends PmNode | PmMark>(type: string, attrs: Record<string, unknown>): T {
  const present = Object.fromEntries(Object.entries(attrs).filter(([, value]) => value !== undefined))
  return (Object.keys(present).length ? { type, attrs: present } : { type }) as T
}

/** Map an HTML element to a block node, an inline mark or neither (transparent container). */
function classify(tag: string, a: Record<string, string>): { node?: PmNode; mark?: PmMark; leaf?: boolean } {
  const num = (value: string | undefined, fallback?: number) =>
    value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback
  const id = a['data-id']
  const align = styleValue(a.style, 'text-align')
  switch (tag) {
    case 'p':
      return { node: withAttrs('paragraph', { id, textAlign: align }) }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return { node: withAttrs('heading', { id, level: Number(tag[1]), textAlign: align }) }
    case 'blockquote':
      return { node: withAttrs('blockquote', { id }) }
    case 'pre':
      return { node: withAttrs('codeBlock', { id, language: a.language }) }
    case 'ul':
      return { node: withAttrs(a['data-type'] === 'taskList' ? 'taskList' : 'bulletList', { id }) }
    case 'ol':
      return { node: withAttrs('orderedList', { id, start: num(a.start, 1), type: a.type }) }
    case 'li':
      return {
        node:
          a['data-type'] === 'taskItem'
            ? withAttrs('taskItem', { id, checked: a['data-checked'] === 'true' })
            : withAttrs('listItem', { id })
      }
    case 'hr':
      return { node: withAttrs('horizontalRule', { id }) }
    case 'br':
      return { node: { type: 'hardBreak' } }
    case 'table':
      return { node: withAttrs('table', { id }) }
    case 'tr':
      return { node: withAttrs('tableRow', { background: a.background, textColor: a.textcolor }) }
    case 'th':
    case 'td':
      return {
        node: withAttrs(tag === 'th' ? 'tableHeader' : 'tableCell', {
          colspan: num(a.colspan, 1),
          rowspan: num(a.rowspan, 1),
          colwidth: a.colwidth ? a.colwidth.split(',').map(Number).filter(Number.isFinite) : undefined,
          background: a.background,
          ...(tag === 'td' ? { textColor: a.textcolor } : {})
        })
      }
    case 'img':
      return {
        node: withAttrs('image', {
          id,
          src: a.src,
          alt: a.alt,
          title: a.title,
          width: a.width,
          height: a.height,
          aspectRatio: num(a.aspectratio),
          alignment: a.alignment
        })
      }
    case 'image-component':
      return {
        leaf: true,
        node: withAttrs('imageComponent', {
          id: a.id ?? id,
          src: a.src,
          alt: a.alt,
          title: a.title,
          width: a.width,
          height: a.height,
          aspectRatio: num(a.aspectratio),
          alignment: a.alignment,
          status: a.status
        })
      }
    case 'mention-component':
      return {
        leaf: true,
        node: withAttrs('mention', { id: a.id, entity_identifier: a.entity_identifier, entity_name: a.entity_name })
      }
    case 'issue-embed-component':
      return {
        leaf: true,
        node: withAttrs('issue-embed-component', {
          id: a.id ?? id,
          entity_identifier: a.entity_identifier,
          project_identifier: a.project_identifier,
          workspace_identifier: a.workspace_identifier,
          entity_name: a.entity_name
        })
      }
    case 'div':
      if (a['data-type'] === 'horizontalRule') return { leaf: true, node: withAttrs('horizontalRule', { id }) }
      // `data-type="calloutComponent"` is what earlier Lancity versions wrote.
      if (a['data-block-type'] === 'callout-component' || a['data-type'] === 'calloutComponent')
        return {
          node: withAttrs('calloutComponent', {
            id: a.id ?? id,
            ...Object.fromEntries(CALLOUT_ATTRIBUTES.map(name => [name, a[name]])),
            'data-block-type': 'callout-component'
          })
        }
      return {}
    case 'strong':
    case 'b':
      return { mark: { type: 'bold' } }
    case 'em':
    case 'i':
      return { mark: { type: 'italic' } }
    case 'u':
      return { mark: { type: 'underline' } }
    case 's':
    case 'strike':
    case 'del':
      return { mark: { type: 'strike' } }
    case 'code':
      return { mark: { type: 'code' } }
    case 'a':
      return {
        mark: withAttrs('link', {
          href: a.href ?? null,
          target: a.target ?? '_blank',
          rel: a.rel ?? 'noopener noreferrer nofollow',
          class: a.class
        })
      }
    case 'span': {
      if (a['data-type'] === 'emoji') return { leaf: true, node: withAttrs('emoji', { name: a['data-name'] }) }
      // The editor colors text with `data-*` (palette keys and CSS colors). Pasted HTML may only carry a style.
      const color = a['data-text-color'] ?? styleValue(a.style, 'color')
      const background = a['data-background-color'] ?? styleValue(a.style, 'background-color')
      return color || background
        ? { mark: { type: 'customColor', attrs: { color: color ?? null, backgroundColor: background ?? null } } }
        : {}
    }
    default:
      return {}
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
    if (INLINE_NODES.has(child.type)) run.push(child)
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
  const insideLeaf = () => stack.some(frame => frame.leaf)
  const addText = (raw: string) => {
    if (insideLeaf()) return
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
    const selfClosing = VOID.has(tag) || Boolean(match[4])
    // Children of an atom node only render it: keep their frames to match the closing tags, add nothing.
    if (insideLeaf()) {
      if (!selfClosing) stack.push({ node: { type: '' }, tag, marks: [] })
      continue
    }
    const attrs = parseAttributes(match[3])
    const { node, mark, leaf } = classify(tag, attrs)
    // `<pre><code>` is one code block: the inner `code` mark is dropped inside it.
    const insidePre = stack.some(frame => frame.node.type === 'codeBlock')
    const frame: Frame = {
      node: node ?? { type: '' },
      tag,
      marks: mark && !(tag === 'code' && insidePre) ? [mark] : [],
      leaf
    }
    if (tag === 'code' && insidePre && attrs.class?.startsWith('language-')) {
      const block = [...stack].reverse().find(item => item.node.type === 'codeBlock')
      if (block) block.node.attrs = { ...block.node.attrs, language: attrs.class.slice('language-'.length) }
    }
    if (node) (top().node.content ??= []).push(node)
    if (!selfClosing) stack.push(frame)
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
