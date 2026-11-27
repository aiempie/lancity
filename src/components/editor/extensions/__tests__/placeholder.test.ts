import { Editor } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { createTranslator } from 'next-intl'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import en from '@/data/i18n/en.json'
import { registerEditorTranslator } from '@/components/editor/i18n'
import { CustomPlaceholderExtension } from '../placeholder'

let editor: Editor
const createEditor = (content: string, showPlaceholderOnEmpty = false) => {
  editor = new Editor({
    element: document.createElement('div'),
    content,
    extensions: [StarterKit, CustomPlaceholderExtension({ placeholder: 'Add comment', showPlaceholderOnEmpty })]
  })
  return editor
}
const placeholders = () =>
  [...editor.view.dom.querySelectorAll('[data-placeholder]')].map(element => element.getAttribute('data-placeholder'))

afterEach(() => editor.destroy())

describe('CustomPlaceholderExtension', () => {
  // Lancity: placeholders are translated; outside React the editor has no translator until one is registered.
  beforeAll(() => registerEditorTranslator(createTranslator({ locale: 'en', messages: en, namespace: 'editor' })))

  it('shows the placeholder again once typed text is deleted', () => {
    createEditor('<p></p>', true)
    editor.commands.insertContentAt(1, 'abc')
    expect(placeholders()).toEqual([])
    editor.commands.deleteRange({ from: 1, to: 4 })
    expect(placeholders()).toEqual(['Add comment'])
  })

  it('clears the placeholder from an empty line the caret has left', () => {
    createEditor('<p>first</p><p></p><p>third</p>')
    editor.commands.setTextSelection(8)
    expect(placeholders()).toEqual(['Add comment'])
    editor.commands.setTextSelection(2)
    expect(placeholders()).toEqual([])
  })

  it('labels an empty heading with its level', () => {
    createEditor('<h2></h2>')
    editor.commands.setTextSelection(1)
    expect(placeholders()).toEqual(['Heading 2'])
  })
})
