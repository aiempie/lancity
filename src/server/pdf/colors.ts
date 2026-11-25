/** Port of Plane `lib/pdf/colors.ts`: editor colour tokens mapped to hex values so the PDF matches the editor. */

export const EDITOR_TEXT_COLORS = {
  gray: '#5c5e63',
  peach: '#ff5b59',
  pink: '#f65385',
  orange: '#fd9038',
  green: '#0fc27b',
  'light-blue': '#17bee9',
  'dark-blue': '#266df0',
  purple: '#9162f9'
} as const

export const EDITOR_BACKGROUND_COLORS_LIGHT = {
  gray: '#d6d6d8',
  peach: '#ffd5d7',
  pink: '#fdd4e3',
  orange: '#ffe3cd',
  green: '#c3f0de',
  'light-blue': '#c5eff9',
  'dark-blue': '#c9dafb',
  purple: '#e3d8fd'
} as const

export const EDITOR_BACKGROUND_COLORS_DARK = {
  gray: '#404144',
  peach: '#593032',
  pink: '#562e3d',
  orange: '#583e2a',
  green: '#1d4a3b',
  'light-blue': '#1f495c',
  'dark-blue': '#223558',
  purple: '#3d325a'
} as const

/** Light colours are used for exports. */
export const EDITOR_BACKGROUND_COLORS = EDITOR_BACKGROUND_COLORS_LIGHT

export type EditorColorKey = keyof typeof EDITOR_TEXT_COLORS

/** PD-2143 `getTextColorHex`. */
export function getTextColorHex(colorKey: string): string | null {
  return Object.hasOwn(EDITOR_TEXT_COLORS, colorKey) ? EDITOR_TEXT_COLORS[colorKey as EditorColorKey] : null
}

/** PD-2144 `getBackgroundColorHex`. */
export function getBackgroundColorHex(colorKey: string): string | null {
  return Object.hasOwn(EDITOR_BACKGROUND_COLORS, colorKey) ? EDITOR_BACKGROUND_COLORS[colorKey as EditorColorKey] : null
}

/** PD-2145 `isCssVariable`: a `var(...)` reference. */
export function isCssVariable(value: string): boolean {
  return value.startsWith('var(')
}

/** PD-2146 `extractColorKeyFromCssVariable`: `var(--editor-colors-light-blue-background)` gives `light-blue`. */
export function extractColorKeyFromCssVariable(cssVar: string): string | null {
  return /var\(--editor-colors-([\w-]+)-(text|background)\)/.exec(cssVar)?.[1] ?? null
}

/** A colour that is safe to put in a style attribute: hex, rgb(a) or a plain keyword. Anything else is dropped. */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%]+\)|[a-z]{3,20})$/i
export function safeCssColor(value: string | null | undefined): string | null {
  return value && SAFE_COLOR.test(value.trim()) ? value.trim() : null
}

/** PD-2147 `resolveColorForPdf`: hex values, CSS variables and colour keys resolve to a hex string. */
export function resolveColorForPdf(value: string | null | undefined, type: 'text' | 'background'): string | null {
  if (!value) return null
  if (value.startsWith('#')) return safeCssColor(value)
  if (isCssVariable(value)) {
    const key = extractColorKeyFromCssVariable(value)
    if (key) return type === 'text' ? getTextColorHex(key) : getBackgroundColorHex(key)
    return null
  }
  return type === 'text' ? getTextColorHex(value) : getBackgroundColorHex(value)
}

export const NEUTRAL_COLORS = {
  white: '#ffffff',
  100: '#fafafa',
  200: '#f5f5f5',
  300: '#f0f0f0',
  400: '#ebebeb',
  500: '#e5e5e5',
  600: '#d9d9d9',
  700: '#cccccc',
  800: '#8c8c8c',
  900: '#7a7a7a',
  1000: '#636363',
  1100: '#4d4d4d',
  1200: '#1f1f1f',
  black: '#0f0f0f'
} as const

export const BRAND_COLORS = {
  default: '#3f76ff',
  100: '#f5f8ff',
  900: '#2952b3'
} as const

export const TEXT_COLORS = {
  primary: NEUTRAL_COLORS[1200],
  secondary: NEUTRAL_COLORS[1100],
  tertiary: NEUTRAL_COLORS[1000],
  placeholder: NEUTRAL_COLORS[900],
  disabled: NEUTRAL_COLORS[800],
  accentPrimary: BRAND_COLORS.default,
  linkPrimary: BRAND_COLORS.default
} as const

export const BACKGROUND_COLORS = {
  canvas: NEUTRAL_COLORS[300],
  surface1: NEUTRAL_COLORS.white,
  surface2: NEUTRAL_COLORS[100],
  layer1: NEUTRAL_COLORS[200],
  layer2: NEUTRAL_COLORS.white,
  layer3: NEUTRAL_COLORS[300],
  accentSubtle: BRAND_COLORS[100]
} as const

export const BORDER_COLORS = {
  subtle: NEUTRAL_COLORS[400],
  subtle1: NEUTRAL_COLORS[500],
  strong: NEUTRAL_COLORS[600],
  strong1: NEUTRAL_COLORS[700],
  accentStrong: BRAND_COLORS.default
} as const

export const CODE_COLORS = {
  background: NEUTRAL_COLORS[200],
  text: '#dc2626',
  blockText: NEUTRAL_COLORS[1200]
} as const

export const LINK_COLORS = { primary: BRAND_COLORS.default, hover: BRAND_COLORS[900] } as const
export const MENTION_COLORS = { background: '#e0e9ff', text: BRAND_COLORS.default } as const
