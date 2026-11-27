import type { TFileHandler } from '@/components/editor'
import { apiV1Routes, linkto } from '@/data/linkto'
import {
  editorAssetCheckSchema,
  editorAssetDuplicateSchema,
  editorAssetIdSchema,
  editorAssetUploadSchema,
  type TEditorAssetScope,
  type TEditorUploadProgress
} from '@/types/editor/schema'

// File handler of the editor on Lancity's asset API (files in R2), following Plane web's `useEditorConfig` and
// `FileService`: register the asset, send its bytes, confirm the upload; images are read back by asset id.

/** Sends the bytes of a registered asset to `upload_data.url`, reporting progress as a fraction from 0 to 1. */
export type EditorAssetContentSender = (
  url: string,
  file: File,
  headers: Record<string, string>,
  options: { onProgress: (fraction: number) => void; signal: AbortSignal }
) => Promise<void>

export type EditorFileHandlerOptions = TEditorAssetScope & {
  /** Must match the `FILE_SIZE_LIMIT` of the Worker (5 MB by default). */
  maxFileSize?: number
  onProgress?: TEditorUploadProgress
  /** Defaults to the global `fetch` (same-origin session cookie). Tests pass one with a base URL and a cookie. */
  fetch?: typeof fetch
  /** Defaults to `XMLHttpRequest`, the browser API that reports upload progress. */
  sendContent?: EditorAssetContentSender
}

export const DEFAULT_EDITOR_MAX_FILE_SIZE = 5 * 1024 * 1024

/** Fills `:name` parameters of an API route below `/api/v1/workspaces`. */
function workspaceRoute(pattern: string, params: Record<string, string | number>) {
  const path = pattern.replace(/:(\w+)/g, (_, name: string) => {
    if (params[name] === undefined) throw new Error(`Missing route parameter ${name}`)
    return encodeURIComponent(String(params[name]))
  })
  return `${linkto.apiV1}${linkto.workspaces}${path}`
}

async function failure(response: Response) {
  let detail = response.statusText
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } }
    if (body.error) detail = `${body.error.code ?? ''} ${body.error.message ?? ''}`.trim()
  } catch {
    // Not a JSON error body.
  }
  return new Error(`Asset request failed (${response.status}): ${detail}`)
}

/** Uploads with `XMLHttpRequest`, since `fetch` does not report upload progress. */
export const sendWithXhr: EditorAssetContentSender = (url, file, headers, { onProgress, signal }) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
    xhr.upload.onprogress = event => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Asset upload failed (${xhr.status}): ${xhr.responseText.slice(0, 200)}`))
    }
    xhr.onerror = () => reject(new Error('Asset upload failed: network error'))
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
    if (signal.aborted) return xhr.abort()
    signal.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(file)
  })

/**
 * The editor `fileHandler` without `assetsUploadStatus` (see `useEditorFileHandler`). Image `src` values are asset
 * ids; `http` URLs are shown as they are, and anything else resolves to nothing.
 */
export function createEditorFileHandler(options: EditorFileHandlerOptions): Omit<TFileHandler, 'assetsUploadStatus'> {
  const { workspaceSlug: slug, projectId, entityType, entityId, onProgress } = options
  const request = options.fetch ?? ((input, init) => fetch(input, init))
  const sendContent = options.sendContent ?? sendWithXhr
  const uploads = new Set<AbortController>()

  const isAssetId = (value: string) => editorAssetIdSchema.safeParse(value).success
  const projectAsset = (assetId: string) => workspaceRoute(apiV1Routes.projectEntityAsset, { slug, projectId, assetId })
  const call = async (path: string, init: RequestInit = {}) => {
    const response = await request(path, { credentials: 'same-origin', ...init })
    if (!response.ok) throw await failure(response)
    return response
  }
  const postJson = (path: string, body: unknown) =>
    call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  return {
    cancel: () => {
      for (const upload of uploads) upload.abort()
      uploads.clear()
    },
    checkIfAssetExists: async assetId => {
      if (!isAssetId(assetId)) return false
      const response = await call(workspaceRoute(apiV1Routes.workspaceAssetCheck, { slug, assetId }))
      return editorAssetCheckSchema.parse(await response.json()).exists
    },
    // Lancity has no editor images stored by URL (Plane's old workspace file assets), so only asset ids are deleted.
    delete: async src => {
      if (isAssetId(src)) await call(projectAsset(src), { method: 'DELETE' })
    },
    getAssetDownloadSrc: async path => {
      if (!path) return ''
      if (path.startsWith('http')) return path
      return isAssetId(path) ? `${projectAsset(path)}/download` : ''
    },
    getAssetSrc: async path => {
      if (!path) return ''
      if (path.startsWith('http')) return path
      // Inline: the Worker sends the image type only for an inline read of an allow-listed image.
      return isAssetId(path) ? `${projectAsset(path)}?disposition=inline` : ''
    },
    restore: async src => {
      if (isAssetId(src))
        await call(workspaceRoute(apiV1Routes.workspaceAssetRestore, { slug, assetId: src }), { method: 'POST' })
    },
    upload: async (blockId, file) => {
      const upload = new AbortController()
      uploads.add(upload)
      onProgress?.(blockId, 0)
      try {
        const created = editorAssetUploadSchema.parse(
          await (
            await postJson(workspaceRoute(apiV1Routes.projectEntityAssets, { slug, projectId }), {
              name: file.name,
              type: file.type,
              size: file.size,
              entity_type: entityType,
              entity_identifier: entityId
            })
          ).json()
        )
        await sendContent(created.upload_data.url, file, created.upload_data.headers, {
          signal: upload.signal,
          onProgress: fraction => onProgress?.(blockId, Math.round(fraction * 100))
        })
        // Confirms the upload: the asset becomes readable and is no longer removed by the unuploaded-asset cleanup.
        await call(projectAsset(String(created.asset_id)), { method: 'PATCH', signal: upload.signal })
        return String(created.asset_id)
      } finally {
        uploads.delete(upload)
        onProgress?.(blockId, undefined)
      }
    },
    duplicate: async assetId => {
      // The asset id is read from an editor node, which is stored document content.
      if (!isAssetId(assetId)) throw new Error('Invalid asset id')
      const response = await postJson(workspaceRoute(apiV1Routes.workspaceAssetDuplicate, { slug, assetId }), {
        entity_type: entityType,
        entity_id: entityId,
        project_id: projectId
      })
      return String(editorAssetDuplicateSchema.parse(await response.json()).asset_id)
    },
    validation: { maxFileSize: options.maxFileSize ?? DEFAULT_EDITOR_MAX_FILE_SIZE }
  }
}
