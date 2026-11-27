import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '../src/data/i18n/en.json'
import ja from '../src/data/i18n/ja.json'
import vi from '../src/data/i18n/vi.json'

// Checks from .agents/skills/translate/SKILL.md that typecheck does not cover.

type Tree = { [key: string]: string | Tree }
const flatten = (tree: Tree, prefix = ''): [string, string][] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [[prefix + key, value] as [string, string]] : flatten(value, `${prefix}${key}.`)
  )
const locales = { vi: flatten(vi), en: flatten(en), ja: flatten(ja) }
const editorEntries = (locale: keyof typeof locales) => locales[locale].filter(([key]) => key.startsWith('editor.'))
const placeholders = (value: string) => [...value.matchAll(/\{(\w+)/g)].map(match => match[1]).sort()

const VIETNAMESE = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i
const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff]/
// Values that stay in Latin script in Japanese (brand, acronyms, format names, shown code).
const LATIN_IN_JAPANESE = new Set(['HTML', 'JSON', 'Markdown', 'URL'])

describe('i18n files', () => {
  it('have the same keys in the same order', () => {
    const keys = locales.vi.map(([key]) => key)
    expect(locales.en.map(([key]) => key)).toEqual(keys)
    expect(locales.ja.map(([key]) => key)).toEqual(keys)
  })

  it('use the same placeholders in every language', () => {
    const en = new Map(locales.en)
    const ja = new Map(locales.ja)
    for (const [key, value] of locales.vi) {
      expect(placeholders(en.get(key) ?? ''), key).toEqual(placeholders(value))
      expect(placeholders(ja.get(key) ?? ''), key).toEqual(placeholders(value))
    }
  })
})

describe('editor strings', () => {
  it('are written in the language of their file', () => {
    for (const [key, value] of editorEntries('en'))
      expect(VIETNAMESE.test(value) || JAPANESE.test(value), key).toBe(false)
    for (const [key, value] of editorEntries('vi')) expect(JAPANESE.test(value), key).toBe(false)
    for (const [key, value] of editorEntries('ja')) {
      expect(VIETNAMESE.test(value), key).toBe(false)
      if (!LATIN_IN_JAPANESE.has(value)) expect(JAPANESE.test(value), `${key}: ${value}`).toBe(true)
    }
  })

  it('follow Japanese punctuation rules', () => {
    for (const [key, value] of editorEntries('ja')) {
      // Full-width brackets and marks, and no space next to Japanese text.
      expect(value, key).not.toMatch(/[()!?]/)
      expect(value, key).not.toMatch(
        /[\u3040-\u30ff\u3400-\u9fff\u3000-\u303f\uff00-\uffef] | [\u3040-\u30ff\u3400-\u9fff]/
      )
    }
  })

  it('exist for every key the editor code uses', () => {
    const editorKeys = new Set(flatten(vi.editor).map(([key]) => key))
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
        entry.isDirectory()
          ? files(join(dir, entry.name))
          : /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)
            ? [join(dir, entry.name)]
            : []
      )
    const used: string[] = []
    const missing: string[] = []
    for (const file of files('src/components/editor')) {
      const source = readFileSync(file, 'utf8')
      const calls = [...source.matchAll(/translateEditor\(\s*'([^']+)'/g)]
      if (/useEditorTranslations\(\)/.test(source)) calls.push(...source.matchAll(/\bt\(\s*'([^']+)'/g))
      for (const [, key] of calls) {
        used.push(key)
        if (!editorKeys.has(key)) missing.push(`${file}: ${key}`)
      }
    }
    expect(used.length).toBeGreaterThan(150)
    expect(missing).toEqual([])
  })
})
