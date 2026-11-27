'use client'

import { useTranslations } from 'next-intl'
import { useLayoutEffect } from 'react'

// Lancity: UI strings of the editor live in the `editor` group of src/data/i18n/{vi,en,ja}.json.
// Components use `useEditorTranslations()`. Code that runs outside React (slash command lists built on every keystroke,
// toolbar item factories, label getters of module constants) calls `translateEditor()`, which reads the translator that
// the mounted editors register through `useRegisterEditorTranslations()`.

export type EditorTranslator = ReturnType<typeof useTranslations<'editor'>>
export type EditorMessageKey = Parameters<EditorTranslator>[0]

let current: EditorTranslator | null = null

export const useEditorTranslations = () => useTranslations('editor')

/** Sets the translator used by `translateEditor()`. Editors do this on mount; tests without React call it directly. */
export function registerEditorTranslator(translator: EditorTranslator | null) {
  current = translator
}

/** Called by `useEditor` (every editor type), so the translator follows the language of the page. */
export function useRegisterEditorTranslations() {
  const t = useTranslations('editor')
  useLayoutEffect(() => {
    registerEditorTranslator(t)
  }, [t])
}

/** Translate an `editor.*` key outside React. Returns the key before any editor has mounted. */
export function translateEditor(key: EditorMessageKey, values?: Record<string, string | number>): string {
  return current ? current(key, values) : key
}
