import '@/app/globals.css'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { RichTextEditorWithRef, type EditorRefApi } from '@/components/editor'
import { withIntl } from './intl'
import { LocalAssetStore } from './harness/local-files'
import { getHarnessEditorMetaData, harnessMentionHandler } from './harness/local-handlers'

// Interactions that need a real browser: selection, focus, and floating menus.

async function renderRichText(
  initialValue: string,
  locale: 'en' | 'vi' = 'en',
  store = new LocalAssetStore({ stepMs: 0 })
) {
  const ref = createRef<EditorRefApi>()
  const screen = await render(
    withIntl(
      <RichTextEditorWithRef
        ref={ref}
        id={`browser-${crypto.randomUUID()}`}
        initialValue={initialValue}
        editable
        bubbleMenuEnabled
        disabledExtensions={['ai']}
        flaggedExtensions={[]}
        fileHandler={{ ...store.handler(), assetsUploadStatus: {} }}
        mentionHandler={harnessMentionHandler}
        getEditorMetaData={getHarnessEditorMetaData}
        extendedEditorProps={{}}
      />,
      locale
    )
  )
  const content = screen.container.querySelector<HTMLElement>('.ProseMirror')!
  await expect.poll(() => ref.current).not.toBeNull()
  return { screen, ref, content }
}

describe('rich text editor in a real browser', () => {
  it('applies bold from the bubble menu to the selection and keeps typing at the cursor', async () => {
    const { screen, ref, content } = await renderRichText('<p>hello world</p>')
    await userEvent.click(content)
    await userEvent.keyboard('{End}')
    for (let i = 0; i < 'world'.length; i++) await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}')

    const bold = screen.getByRole('button', { name: 'Bold' })
    await expect.element(bold).toBeVisible()
    await userEvent.click(bold)
    await expect.poll(() => content.querySelector('strong')?.textContent).toBe('world')

    // The selection is kept after the click: collapse it to its end and type there.
    await userEvent.keyboard('{ArrowRight}')
    await userEvent.keyboard('!')
    await expect.poll(() => content.textContent).toBe('hello world!')
    expect(ref.current!.getDocument().html).toContain('hello <strong>world')
  })

  // A space closes the suggestion, so the queries are single words and Enter picks the first match. Each command runs
  // in its own editor because the cursor ends up inside the inserted table or callout.
  it.each([
    ['heading', 'Heading 1', { type: 'heading', attrs: { level: 1 } }],
    ['table', 'Table', { type: 'table' }],
    ['callout', 'Callout', { type: 'calloutComponent', attrs: { 'data-block-type': 'callout-component' } }]
  ])('turns /%s into a %s block', async (query, title, block) => {
    const { screen, ref, content } = await renderRichText('<p></p>')
    await userEvent.click(content)
    await userEvent.keyboard(`/${query}`)
    // The matching part of the title is highlighted in its own element, so read the text of the open menu.
    await expect.poll(() => document.body.textContent).toContain(title)
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => ref.current!.getDocument().json?.content?.[0]).toMatchObject(block)
    expect(content.textContent).not.toContain(`/${query}`)
    screen.unmount()
  })

  it('shows the menus in the page language', async () => {
    const { screen, content } = await renderRichText('<p></p>', 'vi')
    await userEvent.click(content)
    await userEvent.keyboard('/')
    await expect.element(screen.getByText('Danh sách việc cần làm', { exact: true })).toBeVisible()
    await userEvent.keyboard('{Escape}')
  })
})

async function pngFile(width = 400, height = 200) {
  const canvas = document.createElement('canvas')
  Object.assign(canvas, { width, height })
  const context = canvas.getContext('2d')!
  context.fillStyle = '#5e6ad2'
  context.fillRect(0, 0, width, height)
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'))
  return new File([blob], 'pasted.png', { type: 'image/png' })
}

describe('images', () => {
  it('uploads a pasted image to a numeric asset and resizes it with the handle', async () => {
    const store = new LocalAssetStore({ stepMs: 0 })
    const { ref, content } = await renderRichText('<p>Before</p>', 'en', store)
    await userEvent.click(content)
    const clipboardData = new DataTransfer()
    clipboardData.items.add(await pngFile())
    content.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))

    const imageNode = () => ref.current!.getDocument().json?.content?.find(node => node.type === 'imageComponent')
    await expect.poll(() => imageNode()?.attrs).toMatchObject({ src: '1', status: 'uploaded' })
    await expect.poll(() => content.querySelector('img')?.getAttribute('src') ?? '').toMatch(/^blob:/)
    expect(store.exists('1')).toBe(true)

    // The handle appears once the image has its size in pixels.
    const handle = await expect
      .poll(() => content.querySelector<HTMLElement>('.cursor-nwse-resize'))
      .toBeTruthy()
      .then(() => content.querySelector<HTMLElement>('.cursor-nwse-resize')!)
    // The new width is measured from the left edge of the image block (the handle's resizable container).
    const box = handle.parentElement!.getBoundingClientRect()
    // The block attaches its window listeners in effects, and mouseup saves the size it rendered last: wait for the
    // resizing state, then for the previewed width, before the next event.
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
    const container = handle.parentElement!
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: box.right, clientY: box.bottom }))
    await expect.poll(() => handle.className).toContain('pointer-events-auto opacity-100')
    await frame()
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: box.left + 180, clientY: box.bottom }))
    await expect.poll(() => container.style.width).toBe('180px')
    await frame()
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: box.left + 180, clientY: box.bottom }))
    await expect.poll(() => imageNode()?.attrs?.width).toBe('180px')
    expect(parseFloat(String(imageNode()?.attrs?.height))).toBeCloseTo(90, 0)
  })

  it('shows the image toolbar in the page language', async () => {
    const store = new LocalAssetStore({ stepMs: 0 })
    const { screen, content } = await renderRichText('<p>x</p>', 'vi', store)
    await userEvent.click(content)
    const clipboardData = new DataTransfer()
    clipboardData.items.add(await pngFile())
    content.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
    await expect.poll(() => content.querySelector('img')?.getAttribute('src') ?? '').toMatch(/^blob:/)
    // The toolbar is rendered with the image and shown on hover; check its translated controls.
    await expect.element(screen.getByRole('button', { name: 'Xem ảnh toàn màn hình' })).toBeInTheDocument()
    await expect.element(screen.getByRole('group', { name: 'Điều khiển ảnh' })).toBeInTheDocument()
  })
})
