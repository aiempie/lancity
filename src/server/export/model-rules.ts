import { linkto } from '@/data/linkto'

/** PD-1398 `generate_token`: `uuid4().hex`, the unique token of one export. */
export function generateToken(): string {
  return crypto.randomUUID().replaceAll('-', '')
}

/** Plane `ExporterHistory.type` choices. */
export const EXPORT_TYPE = 'issue_exports'

/** Presigned URLs of Plane live 7 days (`expires_in` of `upload_to_s3`). Download links here follow the same window. */
export const EXPORT_LINK_DAYS = 7
/** `delete_old_s3_link` removes the file of exports older than 8 days. */
export const EXPORT_RETENTION_DAYS = 8
/** Upper bound of issues in one export, so the file fits in Worker memory. */
export const MAX_EXPORT_ISSUES = 50_000

const DAY_MS = 86_400_000
export const linkExpiresAt = (createdAt: Date) => new Date(createdAt.getTime() + EXPORT_LINK_DAYS * DAY_MS)
export const isLinkExpired = (createdAt: Date, now = Date.now()) => now >= linkExpiresAt(createdAt).getTime()
export const retentionCutoff = (now = Date.now()) => new Date(now - EXPORT_RETENTION_DAYS * DAY_MS)

/** Authenticated download URL stored in `exporters.url` (R2 has no presigned GET without S3 credentials). */
export const exportDownloadPath = (slug: string, exportId: number) =>
  `${linkto.apiV1}/workspaces/${slug}/export-issues/${exportId}/download`
