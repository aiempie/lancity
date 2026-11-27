import type { TFileHandler } from '@/components/editor'
import { isValidAssetId } from '@/components/editor/lib/asset-id'

// Test harness: image assets kept in the browser. Each upload gets the next numeric id, like a Lancity
// `file_assets` row, and its file stays reachable through an object URL. Both document frames of a test read
// the same store, so an image added in one frame shows in the other.

export type LocalAsset = { id: number; url: string; name: string; size: number; deleted: boolean }

type UploadOptions = {
  /** Upload progress of a block (0 to 100); `undefined` once the upload is over. */
  onProgress?: (blockId: string, percent: number | undefined) => void
  /** Delay between two progress steps, so the upload status of the editor is visible. */
  stepMs?: number
}

export const LOCAL_MAX_FILE_SIZE = 5 * 1024 * 1024
const PROGRESS_STEPS = [10, 35, 60, 85, 100]

export class LocalAssetStore {
  private readonly assets = new Map<number, LocalAsset>()
  private nextId = 1
  private cancelled = false

  constructor(private readonly options: UploadOptions = {}) {}

  get(id: string | number): LocalAsset | undefined {
    return this.assets.get(Number(id))
  }

  /** The URL an image `src` (asset id, or a URL kept from older content) resolves to. */
  resolve(src: string): string {
    if (!src) return ''
    if (/^(https?:|blob:|data:)/.test(src)) return src
    if (!isValidAssetId(src)) return ''
    const asset = this.get(src)
    return asset && !asset.deleted ? asset.url : ''
  }

  async upload(blockId: string, file: File): Promise<string> {
    if (file.size > LOCAL_MAX_FILE_SIZE) throw new Error('File is larger than the harness limit')
    this.cancelled = false
    for (const percent of PROGRESS_STEPS) {
      this.options.onProgress?.(blockId, percent)
      await new Promise(resolve => setTimeout(resolve, this.options.stepMs ?? 120))
      if (this.cancelled) {
        this.options.onProgress?.(blockId, undefined)
        throw new Error('Upload cancelled')
      }
    }
    const id = this.nextId++
    this.assets.set(id, { id, url: URL.createObjectURL(file), name: file.name, size: file.size, deleted: false })
    this.options.onProgress?.(blockId, undefined)
    return String(id)
  }

  cancel() {
    this.cancelled = true
  }

  /** The editor deletes the asset of a removed image and restores it on undo: only the flag changes. */
  delete(src: string) {
    const asset = this.get(src)
    if (asset) asset.deleted = true
  }

  restore(src: string) {
    const asset = this.get(src)
    if (asset) asset.deleted = false
  }

  /** A copied image block gets its own asset, like `POST /assets/:id/duplicate`. */
  duplicate(assetId: string): string {
    const asset = this.get(assetId)
    if (!asset || asset.deleted) throw new Error(`Unknown asset ${assetId}`)
    const id = this.nextId++
    this.assets.set(id, { ...asset, id })
    return String(id)
  }

  exists(assetId: string): boolean {
    const asset = this.get(assetId)
    return Boolean(asset && !asset.deleted)
  }

  /** The `TFileHandler` methods. They are stable: the editor keeps the first handler it receives. */
  handler(): Omit<TFileHandler, 'assetsUploadStatus'> {
    return {
      cancel: () => this.cancel(),
      checkIfAssetExists: async assetId => this.exists(assetId),
      delete: async src => this.delete(src),
      getAssetDownloadSrc: async path => this.resolve(path),
      getAssetSrc: async path => this.resolve(path),
      restore: async src => this.restore(src),
      upload: (blockId, file) => this.upload(blockId, file),
      duplicate: async assetId => this.duplicate(assetId),
      validation: { maxFileSize: LOCAL_MAX_FILE_SIZE }
    }
  }
}
