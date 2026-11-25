import { and, desc, eq, isNull, lt } from 'drizzle-orm'
import { issueDescriptionVersions, issueVersions } from '@/db/schema/issue'
import { parseInput } from '@/server/api/v1/validation'
import { ServiceError } from '@/server/common/errors'
import { collabIssue, parsePage } from '@/server/issue/collab-access'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import { collabPageQuerySchema } from '@/types/issue/collab-schema'

type RawQuery = Record<string, string | undefined>

/** `required_fields` of `IssueVersionEndpoint`: list rows carry metadata only, never the snapshot. */
function versionSummary(row: typeof issueVersions.$inferSelect | typeof issueDescriptionVersions.$inferSelect) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    issueId: row.issueId,
    lastSavedAt: row.lastSavedAt,
    ownedById: row.ownedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdById: row.createdById,
    updatedById: row.updatedById
  }
}

/** `IssueVersionEndpoint.get` (list). Plane's `user_timezone_converter` is replaced by UTC timestamps. */
export async function listIssueVersionsPage(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  rawQuery: RawQuery = {}
) {
  const query = parseInput(collabPageQuerySchema, rawQuery)
  await collabIssue(db, actor, slug, projectId, issueId, { includeArchived: true })
  const perPage = query.per_page ?? 100
  const rows = await db
    .select()
    .from(issueVersions)
    .where(
      and(
        eq(issueVersions.issueId, issueId),
        eq(issueVersions.projectId, projectId),
        isNull(issueVersions.deletedAt),
        query.cursor ? lt(issueVersions.id, query.cursor) : undefined
      )
    )
    .orderBy(desc(issueVersions.id))
    .limit(perPage + 1)
  return parsePage(rows.map(versionSummary), perPage)
}

/** `IssueVersionEndpoint.get` (detail, `IssueVersionDetailSerializer`). */
export async function getIssueVersion(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  versionId: number
) {
  await collabIssue(db, actor, slug, projectId, issueId, { includeArchived: true })
  const [row] = await db
    .select()
    .from(issueVersions)
    .where(
      and(
        eq(issueVersions.id, versionId),
        eq(issueVersions.issueId, issueId),
        eq(issueVersions.projectId, projectId),
        isNull(issueVersions.deletedAt)
      )
    )
    .limit(1)
  if (!row) throw new ServiceError(404, 'VERSION_NOT_FOUND', 'Issue version not found')
  return row
}

/** `WorkItemDescriptionVersionEndpoint.get` (list), newest first. */
export async function listDescriptionVersionsPage(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  rawQuery: RawQuery = {}
) {
  const query = parseInput(collabPageQuerySchema, rawQuery)
  await collabIssue(db, actor, slug, projectId, issueId, { includeArchived: true })
  const perPage = query.per_page ?? 100
  const rows = await db
    .select()
    .from(issueDescriptionVersions)
    .where(
      and(
        eq(issueDescriptionVersions.issueId, issueId),
        eq(issueDescriptionVersions.projectId, projectId),
        isNull(issueDescriptionVersions.deletedAt),
        query.cursor ? lt(issueDescriptionVersions.id, query.cursor) : undefined
      )
    )
    .orderBy(desc(issueDescriptionVersions.id))
    .limit(perPage + 1)
  return parsePage(rows.map(versionSummary), perPage)
}

/** `WorkItemDescriptionVersionEndpoint.get` (detail). The binary description is returned base64-encoded. */
export async function getDescriptionVersion(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  versionId: number
) {
  await collabIssue(db, actor, slug, projectId, issueId, { includeArchived: true })
  const [row] = await db
    .select()
    .from(issueDescriptionVersions)
    .where(
      and(
        eq(issueDescriptionVersions.id, versionId),
        eq(issueDescriptionVersions.issueId, issueId),
        eq(issueDescriptionVersions.projectId, projectId),
        isNull(issueDescriptionVersions.deletedAt)
      )
    )
    .limit(1)
  if (!row) throw new ServiceError(404, 'VERSION_NOT_FOUND', 'Description version not found')
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    issueId: row.issueId,
    descriptionBinary: row.descriptionBinary ? Buffer.from(row.descriptionBinary).toString('base64') : null,
    descriptionHtml: row.descriptionHtml,
    descriptionStripped: row.descriptionStripped,
    descriptionJson: row.descriptionJson,
    lastSavedAt: row.lastSavedAt,
    ownedById: row.ownedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdById: row.createdById,
    updatedById: row.updatedById
  }
}
