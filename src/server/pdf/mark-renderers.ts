import {
  BACKGROUND_COLORS,
  CODE_COLORS,
  EDITOR_BACKGROUND_COLORS,
  EDITOR_TEXT_COLORS,
  LINK_COLORS,
  resolveColorForPdf,
  safeCssColor
} from '@/server/pdf/colors'
import type { TipTapMark } from '@/types/content/p4-pdf-schema'

/** Port of Plane `lib/pdf/mark-renderers.ts`. A mark maps the current inline style (CSS properties) to a new one. */
export type CssStyle = Record<string, string>
export type PdfMarkRenderer = (mark: TipTapMark, style: CssStyle) => CssStyle

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/** Resolve a colour value from a mark attribute: colour key, CSS variable, hex or rgb. Unsafe values give null. */
function resolveMarkColor(value: string | undefined, type: 'text' | 'background'): string | null {
  if (!value) return null
  const resolved = resolveColorForPdf(value, type)
  if (resolved) return resolved
  if (value.startsWith('rgb')) return safeCssColor(value)
  const keys = type === 'text' ? EDITOR_TEXT_COLORS : EDITOR_BACKGROUND_COLORS
  return Object.hasOwn(keys, value) ? keys[value as keyof typeof keys] : null
}

export const markRenderers: Record<string, PdfMarkRenderer> = {
  /** PD-2165 */
  bold: (_mark, style) => ({ ...style, 'font-weight': 'bold' }),
  /** PD-2166 */
  italic: (_mark, style) => ({ ...style, 'font-style': 'italic' }),
  /** PD-2167 */
  underline: (_mark, style) => ({ ...style, 'text-decoration': 'underline' }),
  /** PD-2168 */
  strike: (_mark, style) => ({ ...style, 'text-decoration': 'line-through' }),
  /** PD-2169 */
  code: (_mark, style) => ({
    ...style,
    'font-family': "'Courier New', Courier, monospace",
    'font-size': '10pt',
    'background-color': BACKGROUND_COLORS.layer1,
    color: CODE_COLORS.text
  }),
  /** PD-2170 */
  link: (_mark, style) => ({ ...style, color: LINK_COLORS.primary, 'text-decoration': 'underline' }),
  /** PD-2171 */
  textStyle: (mark, style) => {
    const next = { ...style }
    const color = safeCssColor(text(mark.attrs?.color))
    const background = safeCssColor(text(mark.attrs?.backgroundColor))
    if (color) next.color = color
    if (background) next['background-color'] = background
    return next
  },
  /** PD-2172 */
  highlight: (mark, style) => ({
    ...style,
    'background-color': safeCssColor(text(mark.attrs?.color)) ?? EDITOR_BACKGROUND_COLORS.purple
  }),
  /** PD-2173 */
  subscript: (_mark, style) => ({ ...style, 'font-size': '8pt', 'vertical-align': 'sub' }),
  /** PD-2174 */
  superscript: (_mark, style) => ({ ...style, 'font-size': '8pt', 'vertical-align': 'super' }),
  /** PD-2175: colours stored as keys, hex values or `var(--editor-colors-*)` references. */
  customColor: (mark, style) => {
    const next = { ...style }
    const color = resolveMarkColor(text(mark.attrs?.color), 'text')
    const background = resolveMarkColor(text(mark.attrs?.backgroundColor), 'background')
    if (color) next.color = color
    if (background) next['background-color'] = background
    return next
  }
}

/** PD-2176 `applyMarks` (PD-2177): fold every mark of a text node over the base style. Unknown marks are ignored. */
export function applyMarks(marks: TipTapMark[] | undefined, baseStyle: CssStyle = {}): CssStyle {
  if (!marks?.length) return baseStyle
  return marks.reduce((style, mark) => {
    const renderer = Object.hasOwn(markRenderers, mark.type) ? markRenderers[mark.type] : undefined
    return renderer ? renderer(mark, style) : style
  }, baseStyle)
}

/** Serialize a style object to a `style="..."` attribute value (keys are fixed, values come from validated sources). */
export function styleToString(style: CssStyle): string {
  return Object.entries(style)
    .map(([key, value]) => `${key}:${value.replaceAll(/["<>;]/g, '')}`)
    .join(';')
}
