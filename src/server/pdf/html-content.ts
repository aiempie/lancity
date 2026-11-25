import { escapeHtml, sanitizeHtml } from '@/server/issue/comment-html'
import type { PdfExportMetadata, TipTapNode } from '@/types/content/p4-pdf-schema'

/**
 * Lancity stores page content as sanitized HTML (`pages.description_html`) next to the Yjs binary. Plane renders
 * from the editor JSON, so HTML pages get a second path: editor components are rewritten to plain HTML and the rest
 * passes through the same allow-list sanitizer as page writes.
 */

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

function attributesOf(raw: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const match of raw.matchAll(ATTRIBUTE))
    result.set(
      match[1].toLowerCase(),
      (match[2] ?? match[3] ?? match[4] ?? '').replaceAll('&quot;', '"').replaceAll('&amp;', '&')
    )
  return result
}

/** Asset ids (`image-component`) and external image URLs (`img`) found in stored HTML, in document order. */
export function collectHtmlImageRefs(html: string): string[] {
  const refs = new Set<string>()
  for (const tag of html.matchAll(TAG)) {
    const name = tag[2].toLowerCase()
    if (tag[1] || (name !== 'image-component' && name !== 'img')) continue
    const src = attributesOf(tag[3]).get('src')
    if (src) refs.add(src)
  }
  return [...refs]
}

/** User ids of `mention-component` tags whose `entity_name` is `user_mention`. */
export function collectHtmlUserMentionIds(html: string): string[] {
  const ids = new Set<string>()
  for (const tag of html.matchAll(TAG)) {
    if (tag[1] || tag[2].toLowerCase() !== 'mention-component') continue
    const attrs = attributesOf(tag[3])
    const id = attrs.get('entity_identifier')
    if (id && ['user_mention', 'user'].includes(attrs.get('entity_name') ?? '')) ids.add(id)
  }
  return [...ids]
}

/** Image asset ids (`imageComponent`, `image`) found in an editor JSON tree (Plane `extractImageAssetIds`, PD-2299). */
export function collectJsonImageRefs(doc: TipTapNode): string[] {
  const refs = new Set<string>()
  const walk = (node: TipTapNode) => {
    // PD-2300 `traverse`
    if ((node.type === 'imageComponent' || node.type === 'image') && node.attrs?.src !== undefined) {
      const src = String(node.attrs.src)
      if (src && !src.startsWith('data:')) refs.add(src)
    }
    for (const child of node.content ?? []) walk(child)
  }
  walk(doc)
  return [...refs]
}

/** User mention ids found in an editor JSON tree. */
export function collectJsonUserMentionIds(doc: TipTapNode): string[] {
  const ids = new Set<string>()
  const walk = (node: TipTapNode) => {
    if (node.type === 'mention') {
      const name = String(node.attrs?.entity_name ?? '')
      const id = node.attrs?.entity_identifier ?? node.attrs?.id
      if (['user_mention', 'user'].includes(name) && id !== undefined && id !== null) ids.add(String(id))
    }
    for (const child of node.content ?? []) walk(child)
  }
  walk(doc)
  return [...ids]
}

const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i

/** Rewrite editor components of stored HTML and inline the resolved images. Unresolved images are dropped. */
export function renderStoredHtml(html: string, metadata: PdfExportMetadata = {}): string {
  const clean = sanitizeHtml(html)
  return clean.replace(TAG, (whole, closing: string, rawName: string, rawAttrs: string) => {
    const name = rawName.toLowerCase()
    if (name === 'image-component' || name === 'img') {
      if (closing) return ''
      if (metadata.noAssets) return ''
      const attrs = attributesOf(rawAttrs)
      const src = attrs.get('src') ?? ''
      const resolved = metadata.resolvedImageUrls?.[src]
      if (!resolved || !DATA_IMAGE.test(resolved))
        return `<div class="img-placeholder">[Image: ${escapeHtml(src.slice(0, 8))}...]</div>`
      const width = Number.parseInt(attrs.get('width') ?? '', 10)
      const alignment = attrs.get('alignment')
      const justify = alignment === 'center' ? 'center' : alignment === 'right' ? 'flex-end' : 'flex-start'
      const size = width > 0 ? `width:${width}px;max-height:500px;` : 'max-width:400px;max-height:500px;'
      return `<div class="img-block" style="justify-content:${justify}"><img src="${resolved}" style="${size}" alt=""/></div>`
    }
    if (name === 'mention-component') {
      if (closing) return '</span>'
      const attrs = attributesOf(rawAttrs)
      const entity = attrs.get('entity_name') ?? ''
      const id = attrs.get('entity_identifier') ?? ''
      const user = metadata.userMentions?.find(u => u.id === id)
      return `<span class="mention">@${escapeHtml(user?.display_name ?? (entity || id))}`
    }
    return whole
  })
}
