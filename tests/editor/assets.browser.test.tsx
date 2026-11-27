import '@/app/globals.css'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { RichTextEditorWithRef, type EditorRefApi } from '@/components/editor'
import { useEditorFileHandler } from '@/hooks/use-editor-file-handler'
import { createEditorFileHandler, sendWithXhr } from '@/lib/editor/file-handler'
import { EFileAssetType, type TEditorAssetScope } from '@/types/editor/schema'
import { withIntl } from './intl'
import { getHarnessEditorMetaData, harnessMentionHandler } from './harness/local-handlers'

// The R2 file handler in a real browser: XMLHttpRequest upload with progress, image src from the asset id. The
// asset API is replaced by an in-memory stand-in with the same protocol as the Worker routes (register, PUT bytes,
// PATCH confirm, restore). The <img> request itself bypasses the stand-in; tests/editor-assets.integration.mjs runs
// the same handler against the Worker and R2, including the image bytes.

const SCOPE: TEditorAssetScope = {
  workspaceSlug: 'acme',
  projectId: 7,
  entityType: EFileAssetType.PAGE_DESCRIPTION,
  entityId: 3
}
const ASSETS = `/api/v1/workspaces/acme/projects/7/entity-assets`

type Stored = { type: string; bytes?: Blob; uploaded: boolean }
let stored: Map<number, Stored>
let requests: string[]
let originalFetch: typeof fetch
let OriginalXhr: typeof XMLHttpRequest
let holdUploads = false

/** Stand-in for the Worker: JSON routes through `fetch`, the byte upload through XMLHttpRequest. */
function installFakeAssetApi() {
  stored = new Map()
  requests = []
  originalFetch = window.fetch
  OriginalXhr = window.XMLHttpRequest
  window.fetch = async (input, init = {}) => {
    const url = new URL(String(input), location.origin)
    const method = init.method ?? 'GET'
    requests.push(`${method} ${url.pathname}${url.search}`)
    if (method === 'POST' && url.pathname === ASSETS) {
      const body = JSON.parse(String(init.body)) as { type: string }
      const id = stored.size + 1
      stored.set(id, { type: body.type, uploaded: false })
      return Response.json({
        asset_id: id,
        upload_data: { url: `${ASSETS}/${id}/content`, method: 'PUT', headers: { 'Content-Type': body.type } }
      })
    }
    const match = url.pathname.match(/entity-assets\/(\d+)$/)
    const asset = match && stored.get(Number(match[1]))
    if (method === 'PATCH' && asset?.bytes) return ((asset.uploaded = true), new Response(null, { status: 204 }))
    if (method === 'POST' && /^\/api\/v1\/workspaces\/acme\/assets\/\d+\/restore$/.test(url.pathname))
      return new Response(null, { status: 204 })
    return originalFetch(input, init)
  }
  // XMLHttpRequest whose PUT stores the body (and whose upload reports progress) instead of reaching a server.
  class FakeXhr extends EventTarget {
    status = 0
    responseText = ''
    upload = { onprogress: null as ((event: ProgressEvent) => void) | null }
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    onabort: (() => void) | null = null
    private url = ''
    private aborted = false
    open(_method: string, url: string) {
      this.url = url
    }
    setRequestHeader() {}
    abort() {
      this.aborted = true
      this.onabort?.()
    }
    send(body: Blob) {
      requests.push(`PUT ${this.url}`)
      const finish = () => {
        if (this.aborted) return
        this.upload.onprogress?.(
          new ProgressEvent('progress', { lengthComputable: true, loaded: body.size, total: body.size })
        )
        const id = Number(this.url.match(/(\d+)\/content$/)?.[1])
        stored.get(id)!.bytes = body
        this.status = 200
        this.onload?.()
      }
      this.upload.onprogress?.(
        new ProgressEvent('progress', { lengthComputable: true, loaded: body.size / 2, total: body.size })
      )
      if (!holdUploads) setTimeout(finish, 50)
    }
  }
  window.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest
}

beforeEach(installFakeAssetApi)
afterEach(() => {
  window.fetch = originalFetch
  window.XMLHttpRequest = OriginalXhr
  holdUploads = false
})

async function pngFile() {
  const canvas = Object.assign(document.createElement('canvas'), { width: 40, height: 20 })
  canvas.getContext('2d')!.fillRect(0, 0, 40, 20)
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'))
  return new File([blob], 'pasted.png', { type: 'image/png' })
}

function PageEditor({ editorRef }: { editorRef: React.Ref<EditorRefApi> }) {
  const fileHandler = useEditorFileHandler(SCOPE)
  return (
    <RichTextEditorWithRef
      ref={editorRef}
      id={`r2-${crypto.randomUUID()}`}
      initialValue='<p>Start</p>'
      editable
      disabledExtensions={[]}
      flaggedExtensions={[]}
      fileHandler={fileHandler}
      mentionHandler={harnessMentionHandler}
      getEditorMetaData={getHarnessEditorMetaData}
      extendedEditorProps={{}}
    />
  )
}

describe('R2 file handler in the browser', () => {
  it('uploads a pasted image with XMLHttpRequest and shows it from its asset id', async () => {
    const ref = createRef<EditorRefApi>()
    const screen = await render(withIntl(<PageEditor editorRef={ref} />))
    await expect.poll(() => ref.current).not.toBeNull()
    const content = screen.container.querySelector<HTMLElement>('.ProseMirror')!
    // The image node swaps its <img> while it uploads and loads, so record every src it is given.
    const sources = new Set<string>()
    const observer = new MutationObserver(() =>
      content.querySelectorAll('img').forEach(img => sources.add(img.getAttribute('src') ?? ''))
    )
    observer.observe(content, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] })
    const clipboardData = new DataTransfer()
    clipboardData.items.add(await pngFile())
    content.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))

    const image = () => ref.current?.getDocument().json?.content?.find(node => node.type === 'imageComponent')
    await expect.poll(() => image()?.attrs?.src).toBe('1')
    expect(requests.slice(0, 3)).toEqual([`POST ${ASSETS}`, `PUT ${ASSETS}/1/content`, `PATCH ${ASSETS}/1`])
    // The editor resolves the id to the inline read route. The stand-in cannot answer an <img> request, so the
    // browser fails to load it and the editor asks the API to restore the asset (Plane's soft-delete recovery).
    await expect.poll(() => sources).toContain(`${ASSETS}/1?disposition=inline`)
    await expect.poll(() => requests).toContain('POST /api/v1/workspaces/acme/assets/1/restore')
    observer.disconnect()
  })

  it('reports XMLHttpRequest progress and cancels an upload in flight', async () => {
    holdUploads = true
    const progress: (number | undefined)[] = []
    const files = createEditorFileHandler({ ...SCOPE, onProgress: (_block, percent) => void progress.push(percent) })
    const pending = files.upload('block', await pngFile())
    await expect.poll(() => progress).toEqual([0, 50])
    files.cancel()
    await expect(pending).rejects.toThrow('Upload cancelled')
    expect(progress.at(-1)).toBeUndefined()
    expect(requests).not.toContain(`PATCH ${ASSETS}/1`)
    expect(stored.get(1)?.uploaded).toBe(false)
    expect(sendWithXhr).toBeTypeOf('function')
  })
})
