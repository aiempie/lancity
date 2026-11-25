import { and, eq, isNull } from 'drizzle-orm'
import { descriptionVersions, descriptions } from '@/db/schema/content'
import { auditFields } from '@/server/common/mutations'
import { ServiceError } from '@/server/common/errors'
import { stripTags } from '@/server/issue/comment-html'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

/**
 * Description rows (the rich text of issue comments and other entities) and their versions.
 * Plane saves `description_stripped` on every `save()` of `Description` and `DescriptionVersion`.
 */
export type DescriptionContent = {
  descriptionHtml?: string | null
  descriptionJson?: Record<string, unknown>
  descriptionBinary?: Buffer | null
}

/** Plane `strip_tags` on `save`: null for empty or missing HTML. */
export function strippedDescription(html: string | null | undefined): string | null {
  return html ? stripTags(html) : null
}

function contentColumns(content: DescriptionContent) {
  return {
    ...(content.descriptionHtml !== undefined
      ? {
          descriptionHtml: content.descriptionHtml ?? '',
          descriptionStripped: strippedDescription(content.descriptionHtml)
        }
      : {}),
    ...(content.descriptionJson !== undefined ? { descriptionJson: content.descriptionJson as never } : {}),
    ...(content.descriptionBinary !== undefined ? { descriptionBinary: content.descriptionBinary } : {})
  }
}

/** PD-1388 `Description.save`: create or update a description and keep its plain text in step with the HTML. */
export async function saveDescription(
  db: LancityDb,
  actor: Actor,
  input: DescriptionContent & { id?: number; workspaceId: number; projectId?: number | null }
) {
  if (input.id === undefined) {
    const [created] = await db
      .insert(descriptions)
      .values({
        workspaceId: input.workspaceId,
        projectId: input.projectId ?? null,
        ...contentColumns(input),
        ...auditFields(actor, 'insert')
      })
      .returning()
    return created
  }
  const [updated] = await db
    .update(descriptions)
    .set({ ...contentColumns(input), ...auditFields(actor, 'update') })
    .where(
      and(
        eq(descriptions.id, input.id),
        eq(descriptions.workspaceId, input.workspaceId),
        isNull(descriptions.deletedAt)
      )
    )
    .returning()
  if (!updated) throw new ServiceError(404, 'DESCRIPTION_NOT_FOUND', 'Description not found')
  return updated
}

/** PD-1389 `DescriptionVersion.save`: store a version of a description with its plain text. */
export async function saveDescriptionVersion(
  db: LancityDb,
  actor: Actor,
  input: DescriptionContent & { descriptionId: number; workspaceId: number; projectId?: number | null }
) {
  const [version] = await db
    .insert(descriptionVersions)
    .values({
      descriptionId: input.descriptionId,
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      ...contentColumns(input),
      ...auditFields(actor, 'insert')
    })
    .returning()
  return version
}

/** Record the current content of a description as a version, before it is overwritten. */
export async function snapshotDescription(db: LancityDb, actor: Actor, descriptionId: number, workspaceId: number) {
  const [current] = await db
    .select()
    .from(descriptions)
    .where(
      and(eq(descriptions.id, descriptionId), eq(descriptions.workspaceId, workspaceId), isNull(descriptions.deletedAt))
    )
    .limit(1)
  if (!current) throw new ServiceError(404, 'DESCRIPTION_NOT_FOUND', 'Description not found')
  return saveDescriptionVersion(db, actor, {
    descriptionId,
    workspaceId,
    projectId: current.projectId,
    descriptionHtml: current.descriptionHtml,
    descriptionJson: current.descriptionJson as Record<string, unknown>,
    descriptionBinary: current.descriptionBinary
  })
}
