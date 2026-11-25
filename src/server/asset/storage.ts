import { ServiceError } from '@/server/common/errors'
import { inlineSafeMimeTypes } from '@/types/content/p2-asset-schema'

/**
 * R2 helpers replacing Plane's `S3Storage` (PD-1609 to PD-1617). R2 has no presigned POST without S3 credentials
 * and an extra dependency, so clients upload through the Worker (`PUT .../content`) and read through it too.
 */

/** PD-1610 `S3Storage.__init__`: the bucket binding, or 503 when storage is not configured. */
export function requireBucket(bucket?: R2Bucket): R2Bucket {
  if (!bucket) throw new ServiceError(503, 'STORAGE_UNAVAILABLE', 'Asset storage is not configured')
  return bucket
}

/** PD-1609 `S3Storage.url`: stored names are used as they are. */
export function storageUrl(name: string): string {
  return name
}

/** PD-1611 replacement for `generate_presigned_post`: describes the Worker upload the client must perform. */
export function uploadInstructions(url: string, type: string, size: number) {
  return { url, method: 'PUT', headers: { 'Content-Type': type }, max_size: size }
}

/** PD-1612 `S3Storage._get_content_disposition`. */
export function contentDisposition(disposition: 'inline' | 'attachment', filename?: unknown): string {
  const name = typeof filename === 'string' && filename ? filename : crypto.randomUUID().replaceAll('-', '')
  const encoded = encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${disposition}; filename*=UTF-8''${encoded}`
}

/**
 * PD-1613 `S3Storage.generate_presigned_url`: response for reading an object. Inline is honoured only for an
 * allow-listed image type, which is pinned as the Content-Type; everything else, including SVG and HTML, downloads.
 */
export function objectResponse(
  object: R2ObjectBody,
  options: { disposition?: 'inline' | 'attachment'; filename?: unknown; contentType?: unknown; cache?: string } = {}
): Response {
  const type = typeof options.contentType === 'string' ? options.contentType.split(';')[0].trim().toLowerCase() : ''
  const inline = options.disposition === 'inline' && inlineSafeMimeTypes.has(type)
  return new Response(object.body, {
    headers: {
      'Content-Type': inline ? type : 'application/octet-stream',
      'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', options.filename),
      'Content-Length': String(object.size),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': options.cache ?? 'private, no-store'
    }
  })
}

/** PD-1614 `S3Storage.get_object_metadata`: null when the object is missing. */
export function objectMetadata(head: R2Object) {
  return {
    ContentType: head.httpMetadata?.contentType ?? null,
    ContentLength: head.size,
    LastModified: head.uploaded.toISOString(),
    ETag: head.httpEtag,
    Metadata: head.customMetadata ?? {}
  }
}
export async function getObjectMetadata(bucket: R2Bucket, key: string) {
  const head = await bucket.head(key)
  return head ? objectMetadata(head) : null
}

/** PD-1615 `S3Storage.copy_object`: R2 has no server side copy, so stream the object into the new key. */
export async function copyObject(bucket: R2Bucket, key: string, newKey: string): Promise<boolean> {
  const source = await bucket.get(key)
  if (!source) return false
  await bucket.put(newKey, source.body, { httpMetadata: source.httpMetadata, customMetadata: source.customMetadata })
  return true
}

/** PD-1616 `S3Storage.upload_file`. */
export async function uploadFile(
  bucket: R2Bucket,
  key: string,
  body: ArrayBuffer | Uint8Array | ReadableStream,
  contentType?: string
) {
  await bucket.put(key, body, contentType ? { httpMetadata: { contentType } } : undefined)
}

/** PD-1617 `S3Storage.delete_files`: R2 deletes at most 1000 keys per call. */
export async function deleteFiles(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000))
}
