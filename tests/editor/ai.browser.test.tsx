import '@/app/globals.css'
import { useMemo, useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { CollaborativeDocumentEditorWithRef, type EditorRefApi, type TAIHandler } from '@/components/editor'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import { documentSchema } from './schema'
import { withIntl } from './intl'
import { LocalAIMenu } from './harness/local-ai'
import { LocalAssetStore } from './harness/local-files'
import { getHarnessEditorMetaData, harnessMentionHandler } from './harness/local-handlers'
import { getLocalLiveDocument, LocalLiveSocket } from './harness/local-live'

const realtimeConfig = {
  url: 'ws://harness.local/live',
  WebSocketPolyfill: LocalLiveSocket as unknown as typeof WebSocket
}

function Page({ id, aiEnabled }: { id: string; aiEnabled: boolean }) {
  const editorRef = useRef<EditorRefApi>(null)
  const aiHandler = useMemo<TAIHandler>(() => ({ menu: props => <LocalAIMenu {...props} editorRef={editorRef} /> }), [])
  return (
    <CollaborativeDocumentEditorWithRef
      ref={editorRef}
      id={id}
      editable
      aiEnabled={aiEnabled}
      aiHandler={aiHandler}
      realtimeConfig={realtimeConfig}
      user={{ id: '1', name: 'An', color: '#5e6ad2' }}
      disabledExtensions={[]}
      flaggedExtensions={[]}
      extendedEditorProps={{}}
      fileHandler={{ ...new LocalAssetStore().handler(), assetsUploadStatus: {} }}
      mentionHandler={harnessMentionHandler}
      getEditorMetaData={getHarnessEditorMetaData}
    />
  )
}

async function openPage(aiEnabled: boolean, frames = 1) {
  const id = `ai-${crypto.randomUUID()}`
  prosemirrorJSONToYXmlFragment(
    documentSchema,
    {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one two three four five six seven' }] }]
    },
    getLocalLiveDocument(id).doc.getXmlFragment('default')
  )
  const screen = await render(
    withIntl(
      <>
        {Array.from({ length: frames }, (_, index) => (
          <Page key={index} id={id} aiEnabled={aiEnabled} />
        ))}
      </>
    )
  )
  const content = () => screen.container.querySelector<HTMLElement>('.document-editor .ProseMirror')
  await expect.poll(() => content()?.textContent).toContain('one two three')
  return { screen, content: content()! }
}

describe('AI handle', () => {
  it('is not rendered when AI is off', async () => {
    const { screen, content } = await openPage(false)
    await userEvent.hover(content.querySelector('p')!)
    expect(screen.container.querySelector('#ai-handle')).toBeNull()
    expect(document.querySelector('#ai-handle')).toBeNull()
    // The drag handle of the same side menu is still there.
    expect(document.querySelector('#editor-side-menu')).not.toBeNull()
  })

  it('opens the AI menu on the hovered block and inserts the answer below it', async () => {
    const { screen, content } = await openPage(true, 2)
    await userEvent.hover(content.querySelector('p')!)
    const handle = screen.getByRole('button', { name: 'AI actions' }).first()
    await expect.element(handle).toBeInTheDocument()
    // Moving the pointer out of the text hides the side menu, so click where the handle is, like a user who reached it.
    const button = handle.element() as HTMLElement
    const box = button.getBoundingClientRect()
    const at = { bubbles: true, cancelable: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }
    button.dispatchEvent(new MouseEvent('click', at))

    await expect.element(screen.getByRole('dialog', { name: 'AI (fake answers)' })).toBeVisible()
    // Only the menu of the editor whose handle was clicked opens.
    expect(screen.container.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Summarize' }))
    await expect.element(screen.getByTestId('ai-answer')).toHaveTextContent('TL;DR: one two three four five six…')
    await userEvent.click(screen.getByRole('button', { name: 'Insert below' }))
    await expect.poll(() => content.textContent).toContain('one two three four five six sevenTL;DR')
    await expect.element(screen.getByRole('dialog', { name: 'AI (fake answers)' })).not.toBeInTheDocument()
  })
})
