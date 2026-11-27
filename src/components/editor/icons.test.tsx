import { isValidElement } from 'react'
import { describe, expect, it } from 'vitest'
import * as icons from './icons'

// Every name the ported editor, Blocks and Propel code imports from this module.
const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./icons.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>
const required = [
  ...new Set(
    Object.values(sources).flatMap(code =>
      [...code.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]@\/components\/editor\/icons['"]/g)].flatMap(m =>
        m[1]
          .split(',')
          .map(
            n =>
              n
                .trim()
                .replace(/^type\s+/, '')
                .split(/\s+as\s+/)[0]
          )
          .filter(Boolean)
      )
    )
  )
].filter(name => !['SvgIconProps', 'ISvgIcons'].includes(name)) as (keyof typeof icons)[]

describe('editor icons', () => {
  it('export every icon name the editor uses', () => {
    expect(required.length).toBeGreaterThan(50)
    const missing = required.filter(name => !(name in icons))
    expect(missing).toEqual([])
  })

  it('are React components', () => {
    for (const name of required) {
      const Glyph = icons[name] as unknown as React.ComponentType
      expect(typeof Glyph === 'function' || (typeof Glyph === 'object' && Glyph !== null), name).toBe(true)
      expect(isValidElement(<Glyph />)).toBe(true)
    }
  })
})
