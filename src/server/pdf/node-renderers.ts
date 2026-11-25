import { escapeHtml } from '@/server/issue/comment-html'
import {
  BACKGROUND_COLORS,
  EDITOR_BACKGROUND_COLORS,
  resolveColorForPdf,
  safeCssColor,
  TEXT_COLORS
} from '@/server/pdf/colors'
import { checkIcon, clipboardIcon, documentIcon, globeIcon, lightbulbIcon, linkIcon } from '@/server/pdf/icons'
import { applyMarks, styleToString } from '@/server/pdf/mark-renderers'
import type { PdfExportMetadata, TipTapNode } from '@/types/content/p4-pdf-schema'

/**
 * Port of Plane `lib/pdf/node-renderers.tsx`. react-pdf elements become HTML strings; the Chromium print engine
 * (Cloudflare Browser Rendering) lays them out. Differences: lists use native `ul`/`ol` (no manual bullet or
 * index context), and React keys (`createKeyGenerator`) are not needed.
 */

export type NodeRenderContext = { metadata?: PdfExportMetadata }
export type PdfNodeRenderer = (node: TipTapNode, children: string, ctx: NodeRenderContext) => string

const SAFE_LINK = /^(https?:|mailto:|tel:|#|\/)/i
const ALIGNMENTS = new Set(['left', 'right', 'center', 'justify'])
const attr = (value: string) => escapeHtml(value)
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/** PD-2178 `getCalloutIcon`: emoji logo, or a named icon, defaulting to the lightbulb. */
export function getCalloutIcon(node: TipTapNode, color: string): string {
  const logoInUse = str(node.attrs?.['data-logo-in-use'])
  const iconName = str(node.attrs?.['data-icon-name'])
  const iconColor = str(node.attrs?.['data-icon-color']) || color

  if (logoInUse === 'emoji') {
    const emoji = str(node.attrs?.['data-emoji-unicode'])
    if (emoji) return `<span style="font-size:14pt">${escapeHtml(emoji)}</span>`
  }
  switch (iconName) {
    case 'FileText':
    case 'File':
      return documentIcon({ size: 16, color: iconColor })
    case 'Link':
      return linkIcon({ size: 16, color: iconColor })
    case 'Globe':
      return globeIcon({ size: 16, color: iconColor })
    case 'Clipboard':
      return clipboardIcon({ size: 16, color: iconColor })
    case 'CheckSquare':
    case 'Check':
      return checkIcon({ size: 16, color: iconColor })
    case 'Lightbulb':
    default:
      return lightbulbIcon({ size: 16, color: iconName ? iconColor : color })
  }
}

/** PD-2181 `renderTextWithMarks` (PD-2182 `hasLink`): a text node wrapped in a styled span or a link. */
export function renderTextWithMarks(node: TipTapNode): string {
  const style = styleToString(applyMarks(node.marks, {}))
  const link = node.marks?.find(mark => mark.type === 'link')
  const content = escapeHtml(node.text ?? '')
  if (link) {
    const href = str(link.attrs?.href) || '#'
    const safeHref = SAFE_LINK.test(href) ? href : '#'
    return `<a href="${attr(safeHref)}" style="${style}">${content}</a>`
  }
  return style ? `<span style="${style}">${content}</span>` : content
}

/** PD-2183 `getTextAlignStyle`. */
export function getTextAlignStyle(textAlign: unknown): string {
  return typeof textAlign === 'string' && ALIGNMENTS.has(textAlign) ? `text-align:${textAlign};` : ''
}

/** PD-2184 `getFlexAlignStyle`: used for blocks that shrink to their content (images). */
export function getFlexAlignStyle(textAlign: unknown): string {
  if (textAlign === 'right') return 'align-items:flex-end;'
  if (textAlign === 'center') return 'align-items:center;'
  return ''
}

function backgroundStyle(value: unknown): string {
  const color = typeof value === 'string' && value !== 'default' ? resolveColorForPdf(value, 'background') : null
  return color ? `background-color:${color};` : ''
}

function cellStyle(node: TipTapNode): string {
  const colwidth = node.attrs?.colwidth
  const width = Array.isArray(colwidth) && typeof colwidth[0] === 'number' ? Math.round(colwidth[0]) : 0
  return `${width > 0 ? `width:${width}px;` : ''}${backgroundStyle(node.attrs?.background)}`
}

function cellSpans(node: TipTapNode): string {
  const span = (name: string) => {
    const value = Number(node.attrs?.[name])
    return Number.isInteger(value) && value > 1 && value <= 100 ? ` ${name}="${value}"` : ''
  }
  return span('colspan') + span('rowspan')
}

/** Plane `imageAlignment`: an image block that is aligned left, centre or right. */
function imageBlock(node: TipTapNode, src: string, width: number | undefined): string {
  const alignment = str(node.attrs?.alignment) || 'left'
  const justify = alignment === 'center' ? 'center' : alignment === 'right' ? 'flex-end' : 'flex-start'
  const size = width && width > 0 ? `width:${width}px;max-height:500px;` : 'max-width:400px;max-height:500px;'
  return `<div class="img-block" style="justify-content:${justify}"><img src="${attr(src)}" style="${size}" alt=""/></div>`
}

const isDataImage = (src: string) => /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(src)

function imagePlaceholder(label: string): string {
  return `<div class="img-placeholder">[Image: ${escapeHtml(label.slice(0, 8))}...]</div>`
}

export const nodeRenderers: Record<string, PdfNodeRenderer> = {
  /** PD-2185 */
  doc: (_node, children) => `<div>${children}</div>`,
  /** PD-2186 */
  text: node => renderTextWithMarks(node),
  /** PD-2187 */
  paragraph: (node, children) => {
    const align = getTextAlignStyle(node.attrs?.textAlign)
    const background = backgroundStyle(node.attrs?.backgroundColor)
    return `<p style="${align}${background}">${children}</p>`
  },
  /** PD-2188 */
  heading: (node, children) => {
    const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6)
    return `<h${level} style="${getTextAlignStyle(node.attrs?.textAlign)}">${children}</h${level}>`
  },
  /** PD-2189 */
  blockquote: (_node, children) => `<blockquote>${children}</blockquote>`,
  /** PD-2190 (PD-2191): the code text is the concatenation of the child text nodes. */
  codeBlock: node => `<pre>${escapeHtml(node.content?.map(child => child.text ?? '').join('') ?? '')}</pre>`,
  /** PD-2192 */
  bulletList: (_node, children) => `<ul>${children}</ul>`,
  /** PD-2193 */
  orderedList: (node, children) => {
    const start = Number(node.attrs?.start)
    return `<ol${Number.isInteger(start) && start > 1 ? ` start="${start}"` : ''}>${children}</ol>`
  },
  /** PD-2194 */
  listItem: (_node, children) => `<li>${children}</li>`,
  /** PD-2195 */
  taskList: (_node, children) => `<ul class="task-list">${children}</ul>`,
  /** PD-2196 */
  taskItem: (node, children) => {
    const checked = node.attrs?.checked === true
    const box = `<span class="task-box${checked ? ' checked' : ''}">${checked ? checkIcon({ size: 8, color: '#ffffff' }) : ''}</span>`
    return `<li class="task-item">${box}<div class="task-content">${children}</div></li>`
  },
  /** PD-2197 */
  table: (_node, children) => `<table><tbody>${children}</tbody></table>`,
  /** PD-2198: a row made of header cells gets the header background. */
  tableRow: (node, children) =>
    `<tr${node.content?.some(child => child.type === 'tableHeader') ? ' class="header-row"' : ''}>${children}</tr>`,
  /** PD-2199 */
  tableHeader: (node, children) => `<th${cellSpans(node)} style="${cellStyle(node)}">${children}</th>`,
  /** PD-2200 */
  tableCell: (node, children) => `<td${cellSpans(node)} style="${cellStyle(node)}">${children}</td>`,
  /** PD-2201 */
  horizontalRule: () => '<hr/>',
  /** PD-2202 */
  hardBreak: () => '<br/>',
  /** PD-2203: an `image` node holds a URL or `data:` URI; other URLs were inlined by the service. */
  image: (node, _children, ctx) => {
    if (ctx.metadata?.noAssets) return ''
    const src = str(node.attrs?.src)
    if (!src) return ''
    const resolved = ctx.metadata?.resolvedImageUrls?.[src] ?? src
    if (!isDataImage(resolved)) return imagePlaceholder(src)
    const width = Number(node.attrs?.width)
    return imageBlock(node, resolved, Number.isFinite(width) ? width : undefined)
  },
  /** PD-2204: `src` is an asset id, replaced by the `data:` URI the service resolved from R2. */
  imageComponent: (node, _children, ctx) => {
    if (ctx.metadata?.noAssets) return ''
    const assetId = str(node.attrs?.src) || (typeof node.attrs?.src === 'number' ? String(node.attrs.src) : '')
    if (!assetId) return ''
    const resolved = ctx.metadata?.resolvedImageUrls?.[assetId] ?? assetId
    if (!isDataImage(resolved)) return imagePlaceholder(assetId)
    const rawWidth = node.attrs?.width
    const width = typeof rawWidth === 'string' ? Number.parseInt(rawWidth, 10) : (rawWidth as number | undefined)
    return imageBlock(node, resolved, width && !Number.isNaN(width) ? width : undefined)
  },
  /** PD-2205 */
  calloutComponent: (node, children) => {
    const key = str(node.attrs?.['data-background']) || 'gray'
    const background = Object.hasOwn(EDITOR_BACKGROUND_COLORS, key)
      ? EDITOR_BACKGROUND_COLORS[key as keyof typeof EDITOR_BACKGROUND_COLORS]
      : BACKGROUND_COLORS.layer3
    return (
      `<div class="callout" style="background-color:${safeCssColor(background) ?? BACKGROUND_COLORS.layer3}">` +
      `<div class="callout-icon">${getCalloutIcon(node, TEXT_COLORS.primary)}</div>` +
      `<div class="callout-content">${children}</div></div>`
    )
  },
  /** PD-2206 (PD-2207 `userMention`): user mentions show the resolved display name. */
  mention: (node, _children, ctx) => {
    const id = str(node.attrs?.id)
    const entityIdentifier = str(node.attrs?.entity_identifier)
    const entityName = str(node.attrs?.entity_name)
    let display = entityName || id || entityIdentifier
    if (ctx.metadata && (entityName === 'user_mention' || entityName === 'user')) {
      const user = ctx.metadata.userMentions?.find(u => u.id === entityIdentifier || u.id === id)
      if (user) display = user.display_name
    }
    return `<span class="mention">@${escapeHtml(display)}</span>`
  }
}

/** PD-2208 `renderNodeWithContext` (PD-2209, PD-2210): render children first, then the node itself. */
function renderNodeWithContext(node: TipTapNode, ctx: NodeRenderContext): string {
  const children = node.content?.map(child => renderNodeWithContext(child, ctx)).join('') ?? ''
  const renderer = Object.hasOwn(nodeRenderers, node.type) ? nodeRenderers[node.type] : undefined
  // Unknown nodes keep their children, as in Plane (a bare View).
  return renderer ? renderer(node, children, ctx) : children ? `<div>${children}</div>` : ''
}

/** PD-2211 `renderNode`. */
export function renderNode(node: TipTapNode, metadata?: PdfExportMetadata): string {
  return renderNodeWithContext(node, { metadata })
}
