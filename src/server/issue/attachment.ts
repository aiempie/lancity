import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { fileAssets } from '@/db/schema/content'
import { parseInput } from '@/server/api/v1/validation'
import { logJson, getEnv } from '@/server/common/env'
import { ServiceError } from '@/server/common/errors'
import { adminGuard, collabIssue, issueGuard, runBatch } from '@/server/issue/collab-access'
import { issueEventStatement, publishIssueEvent } from '@/server/issue/events'
import { activityStatement } from '@/server/issue/jobs/history'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import {
  confirmAttachmentSchema,
  createAttachmentSchema,
  type CreateAttachmentInput
} from '@/types/issue/collab-schema'

export const issueAttachmentEntity = 'ISSUE_ATTACHMENT'
const defaultSizeLimit = 5 * 1024 * 1024

/** Plane `FILE_SIZE_LIMIT`, 5 MiB unless the environment overrides it. */
export function attachmentSizeLimit() {
  const value = Number(getEnv().FILE_SIZE_LIMIT)
  return Number.isSafeInteger(value) && value > 0 ? value : defaultSizeLimit
}
function requireBucket(bucket?: R2Bucket) {
  if (!bucket) throw new ServiceError(503, 'STORAGE_UNAVAILABLE', 'Attachment storage is not configured')
  return bucket
}
/** Port of `sanitize_filename`: no path separators, control characters or leading dots. */
export function safeFileName(name: string) {
  const base = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
  return base
    .replace(/\.\./g, '')
    .trim()
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 150)
}
const attachmentFilter = (projectId: number, issueId: number) =>
  and(
    eq(fileAssets.projectId, projectId),
    eq(fileAssets.issueId, issueId),
    eq(fileAssets.entityType, issueAttachmentEntity),
    eq(fileAssets.isDeleted, false),
    isNull(fileAssets.deletedAt)
  )

async function findAttachment(db: LancityDb, projectId: number, issueId: number, id: number) {
  const [asset] = await db
    .select()
    .from(fileAssets)
    .where(and(eq(fileAssets.id, id), attachmentFilter(projectId, issueId)))
    .limit(1)
  if (!asset) throw new ServiceError(404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found')
  return asset
}
function attributesOf(asset: { attributes: unknown }) {
  return (asset.attributes ?? {}) as { name?: string; type?: string; size?: number }
}

/** `IssueAttachmentListCreateAPIEndpoint.get`: uploaded attachments only. */
export async function listIssueAttachments(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number
) {
  await collabIssue(db, actor, slug, projectId, issueId, { includeArchived: true, hideFromGuest: true })
  return db
    .select()
    .from(fileAssets)
    .where(and(attachmentFilter(projectId, issueId), eq(fileAssets.isUploaded, true)))
    .orderBy(desc(fileAssets.createdAt), desc(fileAssets.id))
}

/**
 * `IssueAttachmentListCreateAPIEndpoint.post`. R2 has no presigned POST here, so the client
 * uploads the bytes to the returned attachment's `PUT` endpoint and then confirms with `PATCH`.
 */
export async function createIssueAttachment(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  raw: CreateAttachmentInput
) {
  const input = parseInput(createAttachmentSchema, raw)
  const { workspace } = await collabIssue(db, actor, slug, projectId, issueId, { write: true, hideFromGuest: true })
  const name = safeFileName(input.name)
  if (!name) throw new ServiceError(400, 'INVALID_REQUEST', 'Invalid request.')
  const limit = attachmentSizeLimit()
  if (input.size > limit) throw new ServiceError(413, 'FILE_TOO_LARGE', `File exceeds the ${limit} byte limit`)
  if (input.external_id && input.external_source) {
    const [existing] = await db
      .select({ id: fileAssets.id })
      .from(fileAssets)
      .where(
        and(
          attachmentFilter(projectId, issueId),
          eq(fileAssets.externalSource, input.external_source),
          eq(fileAssets.externalId, input.external_id)
        )
      )
      .limit(1)
    if (existing)
      throw new ServiceError(
        409,
        'ATTACHMENT_EXTERNAL_CONFLICT',
        'Issue with the same external id and external source already exists',
        { id: existing.id }
      )
  }
  const [attachment] = await db
    .insert(fileAssets)
    .values({
      workspaceId: workspace.id,
      projectId,
      issueId,
      asset: `${workspace.id}/${crypto.randomUUID().replaceAll('-', '')}-${name}`,
      attributes: { name, type: input.type, size: input.size },
      size: input.size,
      entityType: issueAttachmentEntity,
      externalId: input.external_id ?? null,
      externalSource: input.external_source ?? null,
      createdById: actor.userId,
      updatedById: actor.userId
    })
    .returning()
  return attachment
}

/** Store the bytes of a pending attachment. Only the creator may upload, once. */
export async function uploadIssueAttachmentContent(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  attachmentId: number,
  request: Request
) {
  await collabIssue(db, actor, slug, projectId, issueId, { write: true, hideFromGuest: true })
  const asset = await findAttachment(db, projectId, issueId, attachmentId)
  if (asset.createdById !== actor.userId)
    throw new ServiceError(403, 'FORBIDDEN', 'You are not allowed to upload this attachment')
  if (asset.isUploaded) throw new ServiceError(409, 'ATTACHMENT_UPLOADED', 'The attachment is already uploaded')
  const { type, size: declared = 0 } = attributesOf(asset)
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (!type || contentType !== type)
    throw new ServiceError(400, 'INVALID_FILE_TYPE', 'Content-Type must match the declared type')
  const length = Number(request.headers.get('content-length'))
  if (!Number.isSafeInteger(length) || length <= 0)
    throw new ServiceError(411, 'LENGTH_REQUIRED', 'A valid Content-Length is required')
  if (length > Math.min(declared, attachmentSizeLimit()))
    throw new ServiceError(413, 'FILE_TOO_LARGE', 'Upload exceeds the declared size')
  const bytes = await request.arrayBuffer()
  if (bytes.byteLength !== length) throw new ServiceError(400, 'INVALID_REQUEST', 'Body does not match Content-Length')
  await requireBucket(bucket).put(asset.asset, bytes, { httpMetadata: { contentType: type } })
  await db
    .update(fileAssets)
    .set({
      size: bytes.byteLength,
      attributes: { name: attributesOf(asset).name ?? '', type, size: bytes.byteLength },
      updatedById: actor.userId
    })
    .where(and(eq(fileAssets.id, asset.id), eq(fileAssets.isUploaded, false)))
  return { id: asset.id, size: bytes.byteLength }
}

/** `IssueAttachmentDetailAPIEndpoint.patch`: mark an uploaded object as ready and record the activity. */
export async function confirmIssueAttachment(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  attachmentId: number,
  raw: unknown
) {
  parseInput(confirmAttachmentSchema, raw ?? {})
  const { isAdmin } = await collabIssue(db, actor, slug, projectId, issueId, { write: true, hideFromGuest: true })
  const asset = await findAttachment(db, projectId, issueId, attachmentId)
  if (asset.createdById !== actor.userId && !isAdmin)
    throw new ServiceError(403, 'FORBIDDEN', 'You are not allowed to upload this attachment')
  if (asset.isUploaded) return asset
  const head = await requireBucket(bucket).head(asset.asset)
  if (!head) throw new ServiceError(400, 'ATTACHMENT_NOT_UPLOADED', 'The asset is not uploaded.')
  const mutationId = crypto.randomUUID()
  const results = await runBatch(db, [
    db
      .update(fileAssets)
      .set({
        isUploaded: true,
        size: head.size,
        storageMetadata: { size: head.size, etag: head.etag, content_type: head.httpMetadata?.contentType ?? null },
        updatedById: actor.userId
      })
      .where(
        and(eq(fileAssets.id, asset.id), eq(fileAssets.isUploaded, false), issueGuard(actor, slug, projectId, issueId))
      )
      .returning(),
    activityStatement(
      db,
      issueId,
      projectId,
      actor.userId,
      'created',
      'attachment',
      null,
      asset.asset,
      'created an attachment',
      null,
      asset.id,
      false,
      mutationId
    ),
    issueEventStatement(db, mutationId, {
      type: 'attachment.activity.created',
      issueId,
      projectId,
      actorId: actor.userId,
      requestedData: null,
      currentInstance: { id: asset.id, asset: asset.asset },
      webhook: false
    })
  ])
  const [confirmed] = results[0] as (typeof fileAssets.$inferSelect)[]
  if (!confirmed) return findAttachment(db, projectId, issueId, attachmentId)
  await publishIssueEvent(db, mutationId)
  return confirmed
}

/** `IssueAttachmentDetailAPIEndpoint.get`, streaming from R2 instead of redirecting to a presigned URL. */
export async function downloadIssueAttachment(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  attachmentId: number
) {
  await collabIssue(db, actor, slug, projectId, issueId, { includeArchived: true, hideFromGuest: true })
  const asset = await findAttachment(db, projectId, issueId, attachmentId)
  if (!asset.isUploaded) throw new ServiceError(400, 'ATTACHMENT_NOT_UPLOADED', 'The asset is not uploaded.')
  const object = await requireBucket(bucket).get(asset.asset)
  if (!object) throw new ServiceError(404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found')
  const { name, type } = attributesOf(asset)
  return { object, name: name ?? 'attachment', type: type ?? 'application/octet-stream' }
}

/** `IssueAttachmentDetailAPIEndpoint.delete`: the creator or a project/workspace admin. */
export async function deleteIssueAttachment(
  db: LancityDb,
  bucket: R2Bucket | undefined,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  attachmentId: number
) {
  const { isAdmin } = await collabIssue(db, actor, slug, projectId, issueId, {
    includeArchived: true,
    hideFromGuest: !(await isAdminLookup(db, actor, slug, projectId))
  })
  const asset = await findAttachment(db, projectId, issueId, attachmentId)
  if (asset.createdById !== actor.userId && !isAdmin)
    throw new ServiceError(403, 'FORBIDDEN', 'You are not allowed to delete this attachment')
  const mutationId = crypto.randomUUID()
  const results = await runBatch(db, [
    db
      .update(fileAssets)
      .set({ isDeleted: true, deletedAt: new Date(), updatedById: actor.userId })
      .where(
        and(
          eq(fileAssets.id, asset.id),
          isNull(fileAssets.deletedAt),
          issueGuard(actor, slug, projectId, issueId, true),
          sql`(${fileAssets.createdById} = ${actor.userId} or ${adminGuard(actor, slug, projectId)})`
        )
      )
      .returning({ id: fileAssets.id }),
    activityStatement(
      db,
      issueId,
      projectId,
      actor.userId,
      'deleted',
      'attachment',
      null,
      null,
      'deleted the attachment',
      asset.id,
      null,
      false,
      mutationId
    ),
    issueEventStatement(db, mutationId, {
      type: 'attachment.activity.deleted',
      issueId,
      projectId,
      actorId: actor.userId,
      requestedData: null,
      currentInstance: null,
      webhook: false
    })
  ])
  if (!results[0].length) throw new ServiceError(409, 'ATTACHMENT_CONFLICT', 'Attachment or permissions changed')
  await publishIssueEvent(db, mutationId)
  try {
    if (asset.isUploaded) await requireBucket(bucket).delete(asset.asset)
  } catch (error) {
    logJson('error', 'issue attachment object cleanup', {
      id: asset.id,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

/** Admins bypass the guest visibility gate on delete (`is_project_or_workspace_admin`). */
async function isAdminLookup(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const [row] = await db.all<{ ok: number }>(sql`select ${adminGuard(actor, slug, projectId)} as ok`)
  return Boolean(row?.ok)
}
