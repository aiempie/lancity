import '@/app/globals.css'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import {
  CollaborativeDocumentEditorWithRef,
  RichTextEditorWithRef,
  type EditorRefApi,
  type ICollaborativeDocumentEditorProps
} from '@/components/editor'
import { fragmentToJson, htmlToJson, jsonToHtml, type PmNode } from '@/server/collaboration/codec'
import { sanitizeHtml } from '@/server/issue/comment-html'
import { documentSchema } from './schema'
import { withIntl } from './intl'
import { LocalAssetStore } from './harness/local-files'
import { getHarnessEditorMetaData, harnessMentionHandler, useHarnessHandlers } from './harness/local-handlers'
import { getLocalLiveDocument, LocalLiveSocket } from './harness/local-live'

const embed = {
  type: 'issue-embed-component',
  attrs: {
    id: 'b-embed',
    entity_identifier: '42',
    project_identifier: '7',
    workspace_identifier: 'acme',
    entity_name: 'issue'
  }
}

describe('work item embeds in the live document editor', () => {
  it('stay in the shared document when the page is opened without an embed handler', async () => {
    const name = `embed-${crypto.randomUUID()}`
    const document = getLocalLiveDocument(name)
    prosemirrorJSONToYXmlFragment(
      documentSchema,
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }, embed] },
      document.doc.getXmlFragment('default')
    )
    const screen = await render(
      withIntl(
        <CollaborativeDocumentEditorWithRef
          id={name}
          editable
          realtimeConfig={{
            url: 'ws://harness.local/live',
            WebSocketPolyfill: LocalLiveSocket as unknown as typeof WebSocket
          }}
          user={{ id: '1', name: 'An', color: '#5e6ad2' }}
          disabledExtensions={['ai']}
          flaggedExtensions={[]}
          extendedEditorProps={{}}
          fileHandler={{ ...new LocalAssetStore().handler(), assetsUploadStatus: {} }}
          mentionHandler={harnessMentionHandler}
          getEditorMetaData={getHarnessEditorMetaData}
        />
      )
    )
    await expect
      .poll(() => screen.container.querySelector('.document-editor .ProseMirror')?.textContent)
      .toContain('Before')
    // Give the editor time to bind to the document (y-tiptap deletes the elements it cannot build).
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(fragmentToJson(document.doc.getXmlFragment('default')).content?.map(node => node.type)).toEqual([
      'paragraph',
      'issue-embed-component'
    ])
  })
})

const realtimeConfig = {
  url: 'ws://harness.local/live',
  WebSocketPolyfill: LocalLiveSocket as unknown as typeof WebSocket
}
const fileHandler = () => ({ ...new LocalAssetStore({ stepMs: 0 }).handler(), assetsUploadStatus: {} })
const find = (node: PmNode | undefined, type: string): PmNode | undefined =>
  !node ? undefined : node.type === type ? node : (node.content ?? []).map(child => find(child, type)).find(Boolean)

/** A document page with the fake member and work item handlers. */
function HarnessDocument({ id, editorRef }: { id: string; editorRef?: React.Ref<EditorRefApi> }) {
  const { mentionHandler, extendedEditorProps } = useHarnessHandlers()
  const props: ICollaborativeDocumentEditorProps = {
    id,
    editable: true,
    realtimeConfig,
    user: { id: '1', name: 'An', color: '#5e6ad2' },
    disabledExtensions: ['ai'],
    flaggedExtensions: [],
    extendedEditorProps,
    fileHandler: fileHandler(),
    mentionHandler,
    getEditorMetaData: getHarnessEditorMetaData
  }
  return <CollaborativeDocumentEditorWithRef {...props} ref={editorRef} />
}

function HarnessRichText({ editorRef }: { editorRef: React.Ref<EditorRefApi> }) {
  const { mentionHandler } = useHarnessHandlers()
  return (
    <RichTextEditorWithRef
      ref={editorRef}
      id={`mention-${crypto.randomUUID()}`}
      initialValue='<p></p>'
      editable
      disabledExtensions={['ai']}
      flaggedExtensions={[]}
      extendedEditorProps={{}}
      fileHandler={fileHandler()}
      mentionHandler={mentionHandler}
      getEditorMetaData={getHarnessEditorMetaData}
    />
  )
}

describe('mentions', () => {
  it('inserts a member mention with its entity attributes, kept through the server codec', async () => {
    const ref = createRef<EditorRefApi>()
    const screen = await render(withIntl(<HarnessRichText editorRef={ref} />))
    const content = screen.container.querySelector<HTMLElement>('.ProseMirror')!
    await userEvent.click(content)
    await userEvent.keyboard('Hi @Bì')
    await expect.poll(() => document.body.textContent).toContain('Trần Thị Bình')
    await userEvent.keyboard('{Enter}')

    const mention = () => find(ref.current!.getDocument().json as PmNode, 'mention')
    await expect.poll(() => mention()?.attrs).toMatchObject({ entity_identifier: '2', entity_name: 'user_mention' })
    await expect.poll(() => content.textContent).toContain('@Bình')
    const html = ref.current!.getDocument().html
    expect(html).toContain('<mention-component')
    for (const stored of [html, sanitizeHtml(html)])
      expect(find(htmlToJson(stored), 'mention')?.attrs).toMatchObject({
        entity_identifier: '2',
        entity_name: 'user_mention'
      })
    expect(ref.current!.getMarkDown()).toContain('@Bình')
  })
})

describe('work item embeds', () => {
  it('are picked from the "Work item" slash command and saved with their identifiers', async () => {
    const name = `embed-${crypto.randomUUID()}`
    const ref = createRef<EditorRefApi>()
    const screen = await render(withIntl(<HarnessDocument id={name} editorRef={ref} />))
    const content = () => screen.container.querySelector<HTMLElement>('.document-editor .ProseMirror')
    await expect.poll(content).toBeTruthy()
    await userEvent.click(content()!)

    // Typing the picker characters by hand does not open it (`[[` is the escape of `[` in the keyboard syntax).
    await userEvent.keyboard('[[[[')
    await expect.poll(() => content()!.textContent).toBe('[[')
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(document.body.textContent).not.toContain('LAN-12')
    await userEvent.keyboard('{Backspace}{Backspace}/work')
    await expect.poll(() => document.body.textContent).toContain('Work item')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => document.body.textContent).toContain('LAN-12')
    await userEvent.keyboard('LAN-13')
    // The list is hidden while the search runs: wait for the filtered result itself.
    await expect
      .poll(() => {
        const text = document.body.textContent ?? ''
        return text.includes('LAN-13') && !text.includes('LAN-12') && !text.includes('Loading')
      })
      .toBe(true)
    await userEvent.keyboard('{Enter}')

    const expected = {
      entity_identifier: '102',
      project_identifier: '7',
      workspace_identifier: 'harness',
      entity_name: 'issue'
    }
    await expect
      .poll(() => find(ref.current!.getDocument().json as PmNode, 'issue-embed-component')?.attrs)
      .toMatchObject(expected)
    await expect
      .poll(() => screen.container.querySelector('[data-testid="work-item-card"]')?.textContent)
      .toContain('Đồng bộ trang qua Durable Object')
    expect(content()!.textContent).not.toContain('[[')

    // The shared document holds the embed, and the HTML the server stores keeps it (also after sanitizing).
    const live = getLocalLiveDocument(name)
    await expect
      .poll(() => find(fragmentToJson(live.doc.getXmlFragment('default')), 'issue-embed-component')?.attrs)
      .toMatchObject(expected)
    const html = jsonToHtml(fragmentToJson(live.doc.getXmlFragment('default')))
    for (const stored of [html, sanitizeHtml(html)])
      expect(find(htmlToJson(stored), 'issue-embed-component')?.attrs).toMatchObject(expected)
  })
})
