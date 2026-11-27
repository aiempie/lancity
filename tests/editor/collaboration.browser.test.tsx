import '@/app/globals.css'
import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { CollaborativeDocumentEditorWithRef, type TUserDetails } from '@/components/editor'
import { fragmentToJson } from '@/server/collaboration/codec'
import { withIntl } from './intl'
import { HARNESS_USERS } from './harness/fixtures'
import { LocalAssetStore } from './harness/local-files'
import { getHarnessEditorMetaData, harnessMentionHandler } from './harness/local-handlers'
import { forgetLocalLiveDocument, getLocalLiveDocument, LocalLiveSocket } from './harness/local-live'

const realtimeConfig = {
  url: 'ws://harness.local/live',
  WebSocketPolyfill: LocalLiveSocket as unknown as typeof WebSocket
}

function Frame({ id, user }: { id: string; user: TUserDetails }) {
  return (
    <div data-testid={`frame-${user.id}`}>
      <CollaborativeDocumentEditorWithRef
        id={id}
        editable
        realtimeConfig={realtimeConfig}
        user={user}
        disabledExtensions={['ai']}
        flaggedExtensions={[]}
        extendedEditorProps={{}}
        fileHandler={{ ...new LocalAssetStore().handler(), assetsUploadStatus: {} }}
        mentionHandler={harnessMentionHandler}
        getEditorMetaData={getHarnessEditorMetaData}
      />
    </div>
  )
}

const [an, binh] = HARNESS_USERS.map(user => ({ ...user }))
const title = (root: Element, userId: string) =>
  root.querySelector<HTMLElement>(`[data-testid="frame-${userId}"] .ProseMirror:not(.document-editor .ProseMirror)`)
const content = (root: Element, userId: string) =>
  root.querySelector<HTMLElement>(`[data-testid="frame-${userId}"] .document-editor .ProseMirror`)

describe('collaborative document', () => {
  it('shares the title and shows the caret of the other person', async () => {
    const id = `collab-${crypto.randomUUID()}`
    const screen = await render(
      withIntl(
        <>
          <Frame id={id} user={an} />
          <Frame id={id} user={binh} />
        </>,
        'vi'
      )
    )
    const root = screen.container
    await expect.poll(() => title(root, an.id) && content(root, binh.id)).toBeTruthy()
    // The empty title shows the translated placeholder.
    await expect
      .poll(() => title(root, an.id)!.querySelector('[data-placeholder]')?.getAttribute('data-placeholder'))
      .toBe('Chưa có tiêu đề')

    await userEvent.click(title(root, an.id)!)
    await userEvent.keyboard('Kế hoạch')
    await expect.poll(() => title(root, binh.id)!.textContent).toBe('Kế hoạch')
    expect(fragmentToJson(getLocalLiveDocument(id).doc.getXmlFragment('title')).content?.[0]).toMatchObject({
      type: 'heading',
      content: [{ type: 'text', text: 'Kế hoạch' }]
    })

    // An writes in the content: Bình's frame draws An's caret with An's name and color.
    await userEvent.click(content(root, an.id)!)
    await userEvent.keyboard('Xin chào')
    await expect.poll(() => content(root, binh.id)!.textContent).toContain('Xin chào')
    const label = () => content(root, binh.id)!.querySelector<HTMLElement>('.collaboration-carets__label')
    await expect.poll(() => label()?.textContent).toBe('An')
    expect(label()!.style.backgroundColor).toBe('rgb(94, 106, 210)')
    // A person never sees their own caret.
    expect(content(root, an.id)!.querySelector('.collaboration-carets__caret')).toBeNull()
  })

  // Runs before the IndexedDB case: rendering again after a manual `unmount()` leaves the next container empty.
  it('shows edits of each person in the other frame (two providers, one live document)', async () => {
    const id = `sync-${crypto.randomUUID()}`
    const screen = await render(
      withIntl(
        <>
          <Frame id={id} user={an} />
          <Frame id={id} user={binh} />
        </>
      )
    )
    await expect.poll(() => content(screen.container, an.id) && content(screen.container, binh.id)).toBeTruthy()

    const text = `Synced ${crypto.randomUUID().slice(0, 8)}`
    await userEvent.click(content(screen.container, an.id)!)
    await userEvent.keyboard(text)
    await expect.poll(() => content(screen.container, binh.id)!.textContent).toContain(text)

    await userEvent.click(content(screen.container, binh.id)!)
    await userEvent.keyboard('{End} back')
    await expect.poll(() => content(screen.container, an.id)!.textContent).toContain(`${text} back`)
  })

  it('keeps the page in IndexedDB: it comes back after the server forgot it', async () => {
    const id = `cache-${crypto.randomUUID()}`
    const first = await render(withIntl(<Frame id={id} user={an} />))
    await expect.poll(() => content(first.container, an.id)).toBeTruthy()
    await userEvent.click(content(first.container, an.id)!)
    await userEvent.keyboard('Lưu cục bộ')
    await expect.poll(() => content(first.container, an.id)!.textContent).toContain('Lưu cục bộ')
    // y-indexeddb writes the updates asynchronously.
    await new Promise(resolve => setTimeout(resolve, 800))
    first.unmount()
    forgetLocalLiveDocument(id)

    const second = await render(withIntl(<Frame id={id} user={an} />))
    await expect.poll(() => content(second.container, an.id)?.textContent).toContain('Lưu cục bộ')
    // The cached state was sent back to the (empty) server when the editor reconnected.
    await expect
      .poll(() => JSON.stringify(fragmentToJson(getLocalLiveDocument(id).doc.getXmlFragment('default'))))
      .toContain('Lưu cục bộ')
    second.unmount()
    await new Promise(resolve => {
      const request = indexedDB.deleteDatabase(id)
      request.onsuccess = request.onerror = request.onblocked = resolve
    })
  })
})
