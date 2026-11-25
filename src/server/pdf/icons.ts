import { safeCssColor } from '@/server/pdf/colors'

/** Port of Plane `lib/pdf/icons.tsx`: react-pdf `Svg` components become inline SVG strings. */

type IconOptions = { size?: number; color?: string }
const stroke = (extra = '') => `fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}`

/** Wrap SVG children. `color` is validated; an unsafe colour falls back to `fallback`. */
function svg(inner: (c: string) => string, size: number, color: string, fallback: string): string {
  const c = safeCssColor(color) ?? fallback
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${inner(c)}</svg>`
}
const path = (d: string, c: string, fill = 'none') => `<path d="${d}" ${stroke()} stroke="${c}" fill="${fill}"/>`
const rect = (attrs: string, c: string) => `<rect ${attrs} fill="none" stroke="${c}" stroke-width="2"/>`
const circle = (attrs: string, c: string, filled = false) =>
  `<circle ${attrs} fill="${filled ? c : 'none'}" stroke="${filled ? 'none' : c}" stroke-width="2"/>`

/** PD-2148 */
export const lightbulbIcon = ({ size = 16, color = '#ffffff' }: IconOptions = {}) =>
  svg(
    c =>
      path(
        'M9 21h6M12 3a6 6 0 0 0-6 6c0 2.22 1.21 4.16 3 5.19V17a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2.81c1.79-1.03 3-2.97 3-5.19a6 6 0 0 0-6-6z',
        c
      ),
    size,
    color,
    '#ffffff'
  )
/** PD-2149 */
export const documentIcon = ({ size = 12, color = '#1e40af' }: IconOptions = {}) =>
  svg(
    c =>
      path('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', c) +
      path('M14 2v6h6', c) +
      path('M16 13H8M16 17H8M10 9H8', c),
    size,
    color,
    '#1e40af'
  )
/** PD-2150 */
export const linkIcon = ({ size = 12, color = '#2563eb' }: IconOptions = {}) =>
  svg(
    c =>
      path('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', c) +
      path('M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71', c),
    size,
    color,
    '#2563eb'
  )
/** PD-2151 */
export const paperclipIcon = ({ size = 16, color = '#374151' }: IconOptions = {}) =>
  svg(
    c =>
      path(
        'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
        c
      ),
    size,
    color,
    '#374151'
  )
/** PD-2152 */
export const imageIcon = ({ size = 16, color = '#374151' }: IconOptions = {}) =>
  svg(
    c =>
      rect('x="3" y="3" width="18" height="18" rx="2" ry="2"', c) +
      circle('cx="8.5" cy="8.5" r="1.5"', c, true) +
      path('M21 15l-5-5L5 21', c),
    size,
    color,
    '#374151'
  )
/** PD-2153 */
export const videoIcon = ({ size = 16, color = '#374151' }: IconOptions = {}) =>
  svg(
    c => rect('x="2" y="4" width="15" height="16" rx="2" ry="2"', c) + path('M17 10l5-3v10l-5-3z', c),
    size,
    color,
    '#374151'
  )
/** PD-2154 */
export const musicIcon = ({ size = 16, color = '#374151' }: IconOptions = {}) =>
  svg(
    c => path('M9 18V5l12-2v13', c) + circle('cx="6" cy="18" r="3"', c) + circle('cx="18" cy="16" r="3"', c),
    size,
    color,
    '#374151'
  )
/** PD-2155 */
export const fileTextIcon = ({ size = 16, color = '#374151' }: IconOptions = {}) =>
  svg(
    c =>
      path('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', c) +
      path('M14 2v6h6M16 13H8M16 17H8M10 9H8', c),
    size,
    color,
    '#374151'
  )
/** PD-2156 */
export const tableIcon = ({ size = 16, color = '#374151' }: IconOptions = {}) =>
  svg(
    c => rect('x="3" y="3" width="18" height="18" rx="2"', c) + path('M3 9h18M3 15h18M9 3v18M15 3v18', c),
    size,
    color,
    '#374151'
  )
/** PD-2157 */
export const presentationIcon = ({ size = 16, color = '#374151' }: IconOptions = {}) =>
  svg(
    c => rect('x="2" y="3" width="20" height="14" rx="2"', c) + path('M8 21l4-4 4 4M12 17v-4', c),
    size,
    color,
    '#374151'
  )
/** PD-2158 */
export const archiveIcon = ({ size = 16, color = '#374151' }: IconOptions = {}) =>
  svg(
    c => path('M21 8v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8', c) + path('M23 3H1v5h22V3zM10 12h4', c),
    size,
    color,
    '#374151'
  )
/** PD-2159 */
export const globeIcon = ({ size = 12, color = '#374151' }: IconOptions = {}) =>
  svg(
    c =>
      circle('cx="12" cy="12" r="10"', c) +
      `<path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" fill="none" stroke="${c}" stroke-width="2"/>`,
    size,
    color,
    '#374151'
  )
/** PD-2160 */
export const clipboardIcon = ({ size = 12, color = '#6b7280' }: IconOptions = {}) =>
  svg(
    c =>
      path('M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2', c) +
      rect('x="8" y="2" width="8" height="4" rx="1"', c),
    size,
    color,
    '#6b7280'
  )
/** PD-2161 */
export const diagramIcon = ({ size = 12, color = '#6b7280' }: IconOptions = {}) =>
  svg(
    c =>
      path('M14 3v4a1 1 0 0 0 1 1h4', c) +
      path('M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z', c) +
      path('M9 9h1M9 13h6M9 17h6', c),
    size,
    color,
    '#6b7280'
  )
/** PD-2162 */
export const taskIcon = ({ size = 14, color = '#374151' }: IconOptions = {}) =>
  svg(c => rect('x="3" y="3" width="18" height="18" rx="2"', c) + path('M9 12l2 2 4-4', c), size, color, '#374151')
/** PD-2163 */
export const checkIcon = ({ size = 10, color = '#ffffff' }: IconOptions = {}) =>
  svg(
    c =>
      `<path d="M20 6L9 17l-5-5" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
    size,
    color,
    '#ffffff'
  )

/** PD-2164 `getFileIcon`: icon for a MIME type. */
export function getFileIcon(fileType: string, size = 16, color = '#374151'): string {
  if (fileType.startsWith('image/')) return imageIcon({ size, color })
  if (fileType.startsWith('video/')) return videoIcon({ size, color })
  if (fileType.startsWith('audio/')) return musicIcon({ size, color })
  if (fileType.includes('pdf')) return fileTextIcon({ size, color: '#dc2626' })
  if (fileType.includes('spreadsheet') || fileType.includes('excel')) return tableIcon({ size, color: '#16a34a' })
  if (fileType.includes('document') || fileType.includes('word')) return fileTextIcon({ size, color: '#2563eb' })
  if (fileType.includes('presentation') || fileType.includes('powerpoint'))
    return presentationIcon({ size, color: '#ea580c' })
  if (fileType.includes('zip') || fileType.includes('archive')) return archiveIcon({ size, color })
  return paperclipIcon({ size, color })
}
