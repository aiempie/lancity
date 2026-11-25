import { and, asc, count, desc, eq, isNull } from 'drizzle-orm'
import { user } from '@/db/schema/auth'
import { exporters } from '@/db/schema/integration'
import { issues } from '@/db/schema/issue'
import { projectMembers, projects } from '@/db/schema/workspace'
import { ServiceError, notFoundError, parseError } from '@/server/common/errors'
import { OffsetPaginator, paginate } from '@/server/common/pagination'
import { ROLE, requireWorkspaceRole } from '@/server/common/permissions'
import { checkRateLimit, parseRate } from '@/server/common/rate-limit'
import { requireBucket, objectResponse } from '@/server/asset/storage'
import { sanitizeCsvRow } from '@/server/export/csv-utils'
import { EXPORT_ISSUES_JOB } from '@/server/export/events'
import { EXPORT_TYPE, generateToken, isLinkExpired } from '@/server/export/model-rules'
import { presentExporter } from '@/server/export/presenters'
import { sanitizeOrderBy } from '@/server/issue/filter'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import {
  exportIssuesInputSchema,
  exportProviders,
  exporterHistoryOrderByAllowlist,
  type ExportIssuesPayload
} from '@/types/reporting/p3-export-schema'
import { parseInput } from '@/server/api/v1/validation'

function serializeRow(values: (string | number | null)[]) {
  return sanitizeCsvRow(values)
    .map(value => `"${String(value ?? '').replaceAll('"', '""')}"`)
    .join(',')
}
export async function exportProjectIssuesCsv(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 15)
  const rows = await db
    .select({
      id: issues.id,
      sequence: issues.sequenceId,
      name: issues.name,
      priority: issues.priority,
      state: issues.stateId
    })
    .from(issues)
    .where(
      and(
        eq(issues.workspaceId, workspace.id),
        eq(issues.projectId, projectId),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt),
        eq(issues.isDraft, false)
      )
    )
  return (
    [
      serializeRow(['id', 'sequence', 'name', 'priority', 'state_id']),
      ...rows.map(row => serializeRow([row.id, row.sequence, row.name, row.priority, row.state]))
    ].join('\r\n') + '\r\n'
  )
}

const EXPORT_RATE = parseRate('10/hour')

/** Queue the export job. Imports stay dynamic so this module loads outside a Worker (unit tests). */
async function queueExportJob(payload: ExportIssuesPayload): Promise<void> {
  const [{ getEnv }, { enqueueJob }] = await Promise.all([import('@/server/common/env'), import('@/server/common/jobs')])
  await enqueueJob(getEnv(), { type: EXPORT_ISSUES_JOB, payload })
}

/**
 * PD-0532 `ExportIssuesEndpoint.post`. Creates the history row (status `queued`) and queues the job. Without
 * `project` the export covers every active, unarchived project the member belongs to.
 */
export async function exportIssues(db: LancityDb, actor: Actor, slug: string, raw: unknown) {
  const permission = await requireWorkspaceRole(db, actor, slug, [ROLE.ADMIN, ROLE.MEMBER])
  const input = parseInput(exportIssuesInputSchema, raw)
  const provider = input.provider ?? ''
  if (!(exportProviders as readonly string[]).includes(provider)) {
    throw new ServiceError(400, 'PROVIDER_NOT_FOUND', `Provider '${provider}' not found.`)
  }
  const limit = await checkRateLimit(db, `export:${actor.userId}`, EXPORT_RATE)
  if (!limit.allowed) throw new ServiceError(429, 'RATE_LIMITED', 'Too many exports, try again later', { retry_after: limit.retryAfter })
  let projectIds = [...new Set(input.project)]
  if (!projectIds.length) {
    projectIds = (
      await db
        .select({ id: projects.id })
        .from(projects)
        .innerJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.workspaceId, projects.workspaceId)))
        .where(
          and(
            eq(projects.workspaceId, permission.workspaceId),
            isNull(projects.deletedAt),
            isNull(projects.archivedAt),
            eq(projectMembers.memberId, actor.userId),
            eq(projectMembers.isActive, true),
            isNull(projectMembers.deletedAt)
          )
        )
        .orderBy(asc(projects.id))
        .limit(100)
    ).map(row => row.id)
  }
  const [created] = await db
    .insert(exporters)
    .values({
      workspaceId: permission.workspaceId,
      project: projectIds,
      initiatedById: actor.userId,
      provider: provider as 'csv' | 'json' | 'xlsx',
      type: EXPORT_TYPE,
      token: generateToken(),
      createdById: actor.userId,
      updatedById: actor.userId
    })
    .returning()
  try {
    await queueExportJob({
      exportId: created.id,
      token: created.token,
      provider,
      workspaceId: permission.workspaceId,
      slug,
      projectIds,
      multiple: input.multiple
    })
  } catch (error) {
    await db.update(exporters).set({ status: 'failed', reason: 'The export could not be queued' }).where(eq(exporters.id, created.id))
    throw error
  }
  return { message: 'Once the export is ready you will be able to download it', id: created.id }
}

/** PD-0533 and PD-0534 `ExportIssuesEndpoint.get`: the member's own exports, `per_page` and `cursor` required. */
export async function listExports(db: LancityDb, actor: Actor, slug: string, query: URLSearchParams) {
  const permission = await requireWorkspaceRole(db, actor, slug, [ROLE.ADMIN, ROLE.MEMBER])
  if (!query.get('per_page') || !query.get('cursor')) throw parseError('per_page and cursor are required')
  const orderBy = sanitizeOrderBy(query.get('order_by'), exporterHistoryOrderByAllowlist, '-created_at')
  const key = orderBy.replace(/^-/, '') === 'updated_at' ? exporters.updatedAt : exporters.createdAt
  const where = and(
    eq(exporters.workspaceId, permission.workspaceId),
    eq(exporters.type, EXPORT_TYPE),
    eq(exporters.initiatedById, actor.userId),
    isNull(exporters.deletedAt)
  )
  const paginator = new OffsetPaginator({
    orderBy,
    fetch: async (offset, limit) => {
      const rows = await db
        .select({ row: exporters, name: user.name, image: user.image })
        .from(exporters)
        .innerJoin(user, eq(user.id, exporters.initiatedById))
        .where(where)
        .orderBy(orderBy.startsWith('-') ? desc(key) : asc(key), desc(exporters.id))
        .limit(limit)
        .offset(offset)
      return rows.map(({ row, name, image }) =>
        presentExporter(row, { id: row.initiatedById, name, image }, { expired: !row.createdAt || isLinkExpired(row.createdAt) })
      )
    },
    count: async () => (await db.select({ total: count() }).from(exporters).where(where))[0]?.total ?? 0
  })
  return paginate(query, { paginator })
}

/**
 * Download of a finished export. Only the member who started it can read it, and only while the link is
 * valid (7 days). `delete_old_s3_link` removes the file after 8 days.
 */
export async function downloadExport(db: LancityDb, actor: Actor, slug: string, exportId: number, bucket?: R2Bucket) {
  const permission = await requireWorkspaceRole(db, actor, slug, [ROLE.ADMIN, ROLE.MEMBER])
  const [row] = await db
    .select()
    .from(exporters)
    .where(
      and(
        eq(exporters.id, exportId),
        eq(exporters.workspaceId, permission.workspaceId),
        eq(exporters.initiatedById, actor.userId),
        isNull(exporters.deletedAt)
      )
    )
  if (!row || row.status !== 'completed' || !row.url || !row.key) throw notFoundError('The export does not exist.', 'EXPORT_NOT_FOUND')
  if (!row.createdAt || isLinkExpired(row.createdAt)) throw new ServiceError(410, 'EXPORT_EXPIRED', 'The download link has expired')
  const object = await requireBucket(bucket).get(row.key)
  if (!object) throw new ServiceError(410, 'EXPORT_EXPIRED', 'The export file is no longer available')
  return objectResponse(object, {
    disposition: 'attachment',
    filename: `export-${slug}-${row.createdAt.toISOString().slice(0, 10)}.zip`,
    contentType: 'application/zip'
  })
}
