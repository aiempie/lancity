import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as editor from '@/components/editor'
import type { EditorRefApi, TFileHandler, TMentionHandler } from '@/components/editor'
import { withIntl } from '../../../tests/editor/intl'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const fileHandler: TFileHandler = {
  assetsUploadStatus: {},
  cancel: () => undefined,
  checkIfAssetExists: async () => true,
  delete: async () => undefined,
  getAssetDownloadSrc: async path => path,
  getAssetSrc: async path => path,
  restore: async () => undefined,
  upload: async () => '1',
  duplicate: async () => '2',
  validation: { maxFileSize: 5 * 1024 * 1024 }
}
const mentionHandler: TMentionHandler = { renderComponent: () => null }

let root: Root | undefined
let container: HTMLElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

describe('editor entry point', () => {
  it('exports the three editors and the Plane extension names', () => {
    expect(editor.RichTextEditorWithRef).toBeTruthy()
    expect(editor.LiteTextEditorWithRef).toBeTruthy()
    expect(editor.CollaborativeDocumentEditorWithRef).toBeTruthy()
    expect(editor.CORE_EXTENSIONS.CALLOUT).toBe('calloutComponent')
    expect(editor.CORE_EXTENSIONS.WORK_ITEM_EMBED).toBe('issue-embed-component')
  })

  it('mounts the rich text editor, renders its content and reports edits', async () => {
    const ref = createRef<EditorRefApi | null>() as React.MutableRefObject<EditorRefApi | null>
    const onChange = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () =>
      root!.render(
        withIntl(
          createElement(editor.RichTextEditorWithRef, {
            id: 'smoke',
            initialValue: '<p>Hello <strong>Lancity</strong></p>',
            editable: true,
            disabledExtensions: [],
            flaggedExtensions: [],
            fileHandler,
            mentionHandler,
            getEditorMetaData: () => ({ file_assets: [], user_mentions: [] }),
            extendedEditorProps: {},
            ref,
            onChange
          })
        )
      )
    )
    const content = await vi.waitFor(() => {
      const el = container!.querySelector('.ProseMirror')
      if (!el) throw new Error('editor not mounted yet')
      return el
    })
    expect(content.textContent).toContain('Hello Lancity')
    expect(content.querySelector('strong')?.textContent).toBe('Lancity')

    expect(ref.current).not.toBeNull()
    await act(async () => ref.current!.setEditorValue('<p>Changed</p>', true))
    expect(ref.current!.getDocument().html).toContain('Changed')
    expect(content.textContent).toContain('Changed')
    expect(onChange).toHaveBeenCalled()
  })
})
