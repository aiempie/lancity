import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { labels as labelsTable } from '@/db/schema/issue'
import { pageLogs, pageVersions, pages, projectPages } from '@/db/schema/content'
import { userFavorites } from '@/db/schema/notification'
import { ServiceError } from '@/server/common/errors'
import { decodeBase64, validateBinaryData, validateHtmlContent } from '@/server/page/content-validator'
import { PAGE_JOB, emitPageJob } from '@/server/page/events'
import { getViewProps, pageDescriptionStripped } from '@/server/page/model-rules'
import { presentPage } from '@/server/page/presenters'
import { queryPage, queryPageSummary } from '@/server/page/queries'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { PageCreateBody, PageDescriptionBody, PageUpdateBody } from '@/types/content/p2-page-schema'
import type { CreatePageInput, UpdatePageInput } from '@/types/content/schema'
import type { LancityDb } from '@/types/database/schema'

type RichFields = 'descriptionHtml' | 'descriptionJson' | 'color' | 'parent' | 'labels' | 'viewProps' | 'logoProps'
/** Earlier plain-text input plus the Plane fields (HTML, JSON, binary state, labels, parent, colour, view/logo props). */
export type CreatePageValues = Omit<CreatePageInput, 'descriptionText'> & {
  descriptionText?: string
  descriptionBinary?: PageCreateBody['descriptionBinary']
} & Pick<PageCreateBody, RichFields>
export type UpdatePageValues = UpdatePageInput & Pick<PageUpdateBody, RichFields>

export function textToPageHtml(text: string) {
  return `<p>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('\n', '<br>')}</p>`
}

export async function requirePageAccess(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  pageId: number,
  action: 'read' | 'write' | 'delete' = 'read'
) {
  const access = await requireProjectAccess(db, actor, slug, projectId)
  const [page] = await db
    .select({ page: pages })
    .from(pages)
    .innerJoin(
      projectPages,
      and(
        eq(projectPages.pageId, pages.id),
        eq(projectPages.workspaceId, pages.workspaceId),
        eq(projectPages.projectId, projectId),
        isNull(projectPages.deletedAt)
      )
    )
    .where(and(eq(pages.id, pageId), eq(pages.workspaceId, access.workspace.id), isNull(pages.deletedAt)))
    .limit(1)
  if (!page) throw new ServiceError(404, 'PAGE_NOT_FOUND', 'Page not found')
  const owner = page.page.ownedById === actor.userId
  const role = access.membership.role
  if (!owner && (page.page.access === 1 || (role === 5 && !access.project.guestViewAllFeatures)))
    throw new ServiceError(404, 'PAGE_NOT_FOUND', 'Page not found')
  if (!owner && ((action === 'write' && role < 15) || (action === 'delete' && role < 20)))
    throw new ServiceError(403, 'FORBIDDEN', 'Insufficient page permissions')
  return { ...access, page: page.page }
}

function validationError(field: string, message: string): never {
  throw new ServiceError(400, 'VALIDATION_ERROR', message, [{ path: [field], message }])
}

/** Description values for a write: plain text (earlier API) or sanitized HTML (PD-0349, PD-0351, PD-1715). */
function resolveDescription(input: { descriptionText?: string; descriptionHtml?: string }) {
  if (input.descriptionText !== undefined)
    return { html: textToPageHtml(input.descriptionText), stripped: input.descriptionText as string | null }
  if (input.descriptionHtml === undefined) return undefined
  const result = validateHtmlContent(input.descriptionHtml)
  if (!result.isValid) validationError('descriptionHtml', result.error ?? 'Invalid HTML')
  const html = result.cleanHtml ?? input.descriptionHtml
  return { html, stripped: pageDescriptionStripped(html) }
}

/** Decode and validate a base64 Yjs state (PD-0350). Blank clears the state. */
function resolveBinary(value: string | null | undefined): Buffer | null | undefined {
  if (value === undefined) return undefined
  if (!value) return null
  const result = validateBinaryData(value)
  if (!result.isValid) validationError('descriptionBinary', `Invalid binary data: ${result.error}`)
  const bytes = decodeBase64(value)
  if (!bytes) return validationError('descriptionBinary', 'Failed to decode base64 data')
  return Buffer.from(bytes)
}

async function assertLabels(db: LancityDb, workspaceId: number, ids: number[]) {
  const unique = [...new Set(ids)]
  if (!unique.length) return unique
  const found = await db
    .select({ id: labelsTable.id })
    .from(labelsTable)
    .where(
      and(inArray(labelsTable.id, unique), eq(labelsTable.workspaceId, workspaceId), isNull(labelsTable.deletedAt))
    )
  if (found.length !== unique.length) validationError('labels', 'One or more labels do not exist')
  return unique
}

/** The parent must be a live page of the same project and must not create a cycle. */
async function assertParent(db: LancityDb, workspaceId: number, projectId: number, parentId: number, pageId?: number) {
  const [parent] = await db
    .select({ id: pages.id })
    .from(pages)
    .innerJoin(
      projectPages,
      and(eq(projectPages.pageId, pages.id), eq(projectPages.projectId, projectId), isNull(projectPages.deletedAt))
    )
    .where(and(eq(pages.id, parentId), eq(pages.workspaceId, workspaceId), isNull(pages.deletedAt)))
    .limit(1)
  if (!parent) validationError('parent', 'Parent page not found in this project')
  if (pageId === undefined) return
  const cycle = await db.all<{ id: number }>(sql`with recursive up(id) as (
      select ${parentId} union select p.parent_id from pages p join up on p.id = up.id where p.parent_id is not null
    ) select id from up where id = ${pageId}`)
  if (cycle.length) validationError('parent', 'A page cannot be its own ancestor')
}

const insertLabelsSql = `insert into page_labels (label_id, page_id, workspace_id, created_by_id)
  select l.id, ?, ?, ? from json_each(?) j join labels l on l.id = j.value and l.workspace_id = ? and l.deleted_at is null`

export async function listPages(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  options: { orderBy?: string | null; search?: string | null } = {}
) {
  const access = await requireProjectAccess(db, actor, slug, projectId)
  const rows = await queryPage(db, actor, access, projectId, { ...options, rootOnly: true })
  return rows.map(row => presentPage(row))
}

/** PD-0724: counts of public, private and archived top-level pages visible to the actor. */
export async function summaryPage(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const access = await requireProjectAccess(db, actor, slug, projectId)
  return queryPageSummary(db, actor, access, projectId)
}

async function pageDetail(
  db: LancityDb,
  actor: Actor,
  access: Awaited<ReturnType<typeof requireProjectAccess>>,
  projectId: number,
  pageId: number
) {
  const [row] = await queryPage(db, actor, access, projectId, { pageId, includeDescription: true })
  if (!row) throw new ServiceError(404, 'PAGE_NOT_FOUND', 'Page not found')
  const logs = await db
    .select({ entityIdentifier: pageLogs.entityIdentifier })
    .from(pageLogs)
    .where(and(eq(pageLogs.pageId, pageId), eq(pageLogs.entityName, 'issue'), isNull(pageLogs.deletedAt)))
  return presentPage(row, {
    issueIds: logs.flatMap(log => (log.entityIdentifier === null ? [] : [log.entityIdentifier]))
  })
}

export async function createPage(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  input: CreatePageValues
) {
  const access = await requireProjectAccess(db, actor, slug, projectId)
  const { workspace, membership } = access
  if (membership.role < 15) throw new ServiceError(403, 'FORBIDDEN', 'Insufficient page permissions')
  const description = resolveDescription(input) ?? { html: '<p></p>', stripped: '' as string | null }
  const binary = resolveBinary(input.descriptionBinary)
  const labelIds = await assertLabels(db, workspace.id, input.labels ?? [])
  if (input.parent) await assertParent(db, workspace.id, projectId, input.parent)
  const client = db.$client
  const statements = [
    client
      .prepare(
        `insert into pages (name, access, description_html, description_stripped, description_json, color, parent_id,
        view_props, logo_props, owned_by_id, workspace_id, created_by_id)
      select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? where exists (
        select 1 from projects p join workspaces w on w.id = p.workspace_id
        join workspace_members wm on wm.workspace_id = w.id and wm.member_id = ?
        join project_members pm on pm.project_id = p.id and pm.workspace_id = w.id and pm.member_id = ?
        where p.id = ? and w.id = ? and w.slug = ? and p.deleted_at is null and w.deleted_at is null
          and wm.is_active = 1 and wm.deleted_at is null and pm.is_active = 1 and pm.deleted_at is null and pm.role >= 15
      ) and (? is null or exists (
        select 1 from pages pg join project_pages ppg on ppg.page_id = pg.id and ppg.project_id = ? and ppg.deleted_at is null
        where pg.id = ? and pg.workspace_id = ? and pg.deleted_at is null
      )) returning id, name, access, description_html`
      )
      .bind(
        input.name,
        input.access,
        description.html,
        description.stripped,
        JSON.stringify(input.descriptionJson ?? {}),
        input.color ?? '',
        input.parent ?? null,
        JSON.stringify(input.viewProps ?? getViewProps()),
        JSON.stringify(input.logoProps ?? {}),
        actor.userId,
        workspace.id,
        actor.userId,
        actor.userId,
        actor.userId,
        projectId,
        workspace.id,
        slug,
        input.parent ?? null,
        projectId,
        input.parent ?? null,
        workspace.id
      ),
    client
      .prepare(
        `insert into project_pages (page_id, project_id, workspace_id, created_by_id)
      select last_insert_rowid(), ?, ?, ? where changes() = 1`
      )
      .bind(projectId, workspace.id, actor.userId)
  ]
  if (binary) {
    // Each follow-up statement runs only while the project link insert (1 change) is the previous statement.
    const update = db
      .update(pages)
      .set({ descriptionBinary: binary })
      .where(
        and(sql`${pages.id} = (select page_id from project_pages where id = last_insert_rowid())`, sql`changes() = 1`)
      )
      .toSQL()
    statements.push(client.prepare(update.sql).bind(...update.params))
  }
  if (labelIds.length)
    statements.push(
      client
        .prepare(
          `with np as materialized (select page_id, workspace_id from project_pages where id = last_insert_rowid() and changes() = 1)
        insert into page_labels (label_id, page_id, workspace_id, created_by_id)
        select l.id, np.page_id, np.workspace_id, ? from np cross join json_each(?) j
        join labels l on l.id = j.value and l.workspace_id = np.workspace_id and l.deleted_at is null`
        )
        .bind(actor.userId, JSON.stringify(labelIds))
    )
  const [created] = await client.batch(statements)
  const result = created.results[0] as
    { id: number; name: string; access: number; description_html: string } | undefined
  if (!result) throw new ServiceError(409, 'PROJECT_CHANGED', 'Project access changed')
  await emitPageJob(PAGE_JOB.transaction, { pageId: result.id })
  const detail = await pageDetail(db, actor, access, projectId, result.id).catch(() => null)
  return detail ?? { id: result.id, name: result.name, access: result.access, descriptionHtml: result.description_html }
}

export async function getPage(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  pageId: number,
  options: { trackVisit?: boolean } = {}
) {
  const access = await requirePageAccess(db, actor, slug, projectId, pageId)
  const detail = await pageDetail(db, actor, access, projectId, pageId)
  if (options.trackVisit) {
    // Plane records the visit in a background task and ignores its failures.
    // Lazy import: the workspace service chain loads `cloudflare:workers`, unavailable in Node tests.
    const { recordRecentVisit } = await import('@/server/workspace/recent-visit')
    await recordRecentVisit(db, {
      entity_name: 'page',
      entity_identifier: pageId,
      project_id: projectId,
      userId: actor.userId,
      workspaceId: access.workspace.id
    }).catch(() => undefined)
  }
  return detail
}

/** Authorization is evaluated by SQLite in the same statement as the mutation. */
function mutationAccess(actor: Actor, slug: string, projectId: number, action: 'write' | 'delete') {
  const minimumRole = action === 'write' ? 15 : 20
  return sql`exists (
    select 1 from project_pages pp
    join projects p on p.id = pp.project_id and p.workspace_id = pp.workspace_id and p.deleted_at is null
    join workspaces w on w.id = p.workspace_id and w.deleted_at is null
    join workspace_members wm on wm.workspace_id = w.id and wm.member_id = ${actor.userId}
      and wm.is_active = 1 and wm.deleted_at is null
    join project_members pm on pm.project_id = p.id and pm.workspace_id = w.id and pm.member_id = ${actor.userId}
      and pm.is_active = 1 and pm.deleted_at is null
    where pp.page_id = ${pages.id} and pp.workspace_id = ${pages.workspaceId}
      and pp.project_id = ${projectId} and pp.deleted_at is null and w.slug = ${slug}
      and (${pages.ownedById} = ${actor.userId} or (${pages.access} = 0 and pm.role >= ${minimumRole}))
  )`
}

export async function updatePage(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  pageId: number,
  input: UpdatePageValues
) {
  const access = await requirePageAccess(db, actor, slug, projectId, pageId, 'write')
  const { page, workspace } = access
  if (page.isLocked || page.archivedAt) throw new ServiceError(409, 'PAGE_LOCKED', 'Page is locked or archived')
  if (input.access !== undefined && input.access !== page.access && page.ownedById !== actor.userId)
    throw new ServiceError(403, 'FORBIDDEN', 'Only the owner may change page visibility')
  if (input.parent) await assertParent(db, workspace.id, projectId, input.parent, pageId)
  const labelIds = input.labels === undefined ? undefined : await assertLabels(db, workspace.id, input.labels)
  const description = resolveDescription(input)
  const update = db
    .update(pages)
    .set({
      name: input.name,
      access: input.access,
      color: input.color,
      parentId: input.parent,
      viewProps: input.viewProps,
      logoProps: input.logoProps,
      descriptionJson: input.descriptionJson ?? undefined,
      updatedById: actor.userId,
      ...(description ? { descriptionHtml: description.html, descriptionStripped: description.stripped } : {})
    })
    .where(
      and(
        eq(pages.id, pageId),
        isNull(pages.deletedAt),
        eq(pages.isLocked, false),
        isNull(pages.archivedAt),
        mutationAccess(actor, slug, projectId, 'write'),
        input.access === undefined
          ? undefined
          : sql`(${pages.ownedById} = ${actor.userId} or ${pages.access} = ${input.access})`
      )
    )
    .returning()
  const descriptionChanged =
    description !== undefined &&
    (input.descriptionText !== undefined
      ? input.descriptionText !== page.descriptionStripped
      : description.html !== page.descriptionHtml)
  if (!(await update).length) throw new ServiceError(409, 'PAGE_CHANGED', 'Page access or state changed')
  // The version goes through the `page.version` job (10 minute merge window, newest 20 kept) like Plane's
  // `track_page_version`, instead of an inline insert that bypassed both rules.
  if (descriptionChanged) await emitPageJob(PAGE_JOB.version, { pageId, userId: actor.userId })
  if (labelIds) {
    const client = db.$client
    await client.batch([
      client
        .prepare('update page_labels set deleted_at = ? where page_id = ? and deleted_at is null')
        .bind(Date.now(), pageId),
      ...(labelIds.length
        ? [
            client
              .prepare(insertLabelsSql)
              .bind(pageId, workspace.id, actor.userId, JSON.stringify(labelIds), workspace.id)
          ]
        : [])
    ])
  }
  if (description) await emitPageJob(PAGE_JOB.transaction, { pageId })
  return getPage(db, actor, slug, projectId, pageId)
}

/**
 * Soft delete a page. Plane requires the page to be archived first (`requireArchived`); children lose their parent,
 * and favourites and recent visits of the page are removed in the same batch.
 */
export async function deletePage(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  pageId: number,
  options: { requireArchived?: boolean } = {}
) {
  const { page, workspace } = await requirePageAccess(db, actor, slug, projectId, pageId, 'delete')
  if (options.requireArchived && !page.archivedAt)
    throw new ServiceError(400, 'PAGE_NOT_ARCHIVED', 'The page should be archived before deleting')
  const client = db.$client
  const statement = db
    .update(pages)
    .set({ deletedAt: new Date(), updatedById: actor.userId })
    .where(and(eq(pages.id, pageId), isNull(pages.deletedAt), mutationAccess(actor, slug, projectId, 'delete')))
    .returning({ id: pages.id })
    .toSQL()
  // The cleanup statements run only when the page is really deleted.
  const deleted = `exists (select 1 from pages where id = ? and deleted_at is not null)`
  const [result] = await client.batch([
    client.prepare(statement.sql).bind(...statement.params),
    client
      .prepare(`update pages set parent_id = null where parent_id = ? and workspace_id = ? and ${deleted}`)
      .bind(pageId, workspace.id, pageId),
    client
      .prepare(
        `delete from user_favorites where entity_type = 'page' and entity_identifier = ? and project_id = ? and workspace_id = ? and ${deleted}`
      )
      .bind(pageId, projectId, workspace.id, pageId),
    client
      .prepare(
        `delete from user_recent_visits where entity_name = 'page' and entity_identifier = ? and project_id = ? and workspace_id = ? and ${deleted}`
      )
      .bind(pageId, projectId, workspace.id, pageId)
  ])
  if (!result.results.length) throw new ServiceError(409, 'PAGE_CHANGED', 'Page access or state changed')
}

export async function setPageLocked(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  pageId: number,
  locked: boolean
) {
  const action = locked ? 'write' : 'delete'
  await requirePageAccess(db, actor, slug, projectId, pageId, action)
  const [updated] = await db
    .update(pages)
    .set({ isLocked: locked, updatedById: actor.userId })
    .where(and(eq(pages.id, pageId), isNull(pages.deletedAt), mutationAccess(actor, slug, projectId, action)))
    .returning({ id: pages.id })
  if (!updated) throw new ServiceError(409, 'PAGE_CHANGED', 'Page access or state changed')
}

/** PD-0719: only the owner changes visibility. Lock and archive state do not matter. */
export async function setPageAccess(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  pageId: number,
  access: 0 | 1
) {
  const { page } = await requirePageAccess(db, actor, slug, projectId, pageId, 'write')
  if (page.access !== access && page.ownedById !== actor.userId)
    throw new ServiceError(
      400,
      'ACCESS_OWNER_ONLY',
      'Access cannot be updated since this page is owned by someone else'
    )
  const [updated] = await db
    .update(pages)
    .set({ access, updatedById: actor.userId })
    .where(
      and(
        eq(pages.id, pageId),
        isNull(pages.deletedAt),
        mutationAccess(actor, slug, projectId, 'write'),
        sql`(${pages.ownedById} = ${actor.userId} or ${pages.access} = ${access})`
      )
    )
    .returning({ id: pages.id })
  if (!updated) throw new ServiceError(409, 'PAGE_CHANGED', 'Page access or state changed')
}

export async function setPageArchived(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  pageId: number,
  archived: boolean
) {
  const { workspace } = await requirePageAccess(db, actor, slug, projectId, pageId, 'delete')
  const archivedAt = archived ? new Date().toISOString().slice(0, 10) : null
  // The root's current authorization gates the recursive mutation, and UNION avoids cycles in corrupt legacy data.
  const descendants = sql`with recursive descendants(id) as (
    select ${pages.id} from ${pages} where ${pages.id} = ${pageId} and ${pages.workspaceId} = ${workspace.id}
      and ${pages.deletedAt} is null and ${mutationAccess(actor, slug, projectId, 'delete')}
    union select child.id from pages child join descendants d on child.parent_id = d.id
      where child.workspace_id = ${workspace.id} and child.deleted_at is null
  ) select id from descendants`
  const update = db
    .update(pages)
    .set({
      archivedAt,
      updatedById: actor.userId,
      ...(!archived
        ? {
            parentId: sql`case when ${pages.id} = ${pageId} and exists (
      select 1 from pages parent where parent.id = ${pages.parentId} and parent.archived_at is not null
    ) then null else ${pages.parentId} end`
          }
        : {})
    })
    .where(sql`${pages.id} in (${descendants})`)
    .returning({ id: pages.id })
  if (archived) {
    const statement = update.toSQL()
    const [result] = await db.$client.batch([
      db.$client.prepare(statement.sql).bind(...statement.params),
      db.$client
        .prepare(
          `delete from user_favorites where entity_type = 'page' and entity_identifier = ?
        and project_id = ? and workspace_id = ? and changes() > 0`
        )
        .bind(pageId, projectId, workspace.id)
    ])
    if (!result.results.length) throw new ServiceError(409, 'PAGE_CHANGED', 'Page access or state changed')
  } else if (!(await update).length) throw new ServiceError(409, 'PAGE_CHANGED', 'Page access or state changed')
  return { archivedAt }
}

/** PD-0725: favourite a visible page (members and admins only). Repeating the call keeps the existing favourite. */
export async function createPageFavorite(db: LancityDb, actor: Actor, slug: string, projectId: number, pageId: number) {
  await requireProjectAccess(db, actor, slug, projectId, 15)
  await requirePageAccess(db, actor, slug, projectId, pageId)
  // Lazy: the workspace service chain imports `cloudflare:workers`, unavailable in Node tests.
  const { createWorkspaceFavorite } = await import('@/server/workspace/favorite')
  await createWorkspaceFavorite(db, actor, slug, {
    entity_type: 'page',
    entity_identifier: pageId,
    project_id: projectId
  })
}

/** PD-0726: remove the actor's favourite for the page. */
export async function deletePageFavorite(db: LancityDb, actor: Actor, slug: string, projectId: number, pageId: number) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 15)
  const deleted = await db
    .delete(userFavorites)
    .where(
      and(
        eq(userFavorites.entityType, 'page'),
        eq(userFavorites.entityIdentifier, pageId),
        eq(userFavorites.projectId, projectId),
        eq(userFavorites.userId, actor.userId),
        eq(userFavorites.workspaceId, workspace.id),
        isNull(userFavorites.deletedAt)
      )
    )
    .returning({ id: userFavorites.id })
  if (!deleted.length) throw new ServiceError(404, 'FAVORITE_NOT_FOUND', 'Favorite not found')
}

/** PD-0727, PD-0728: the Yjs binary state of the page description (empty when none was stored). */
export async function getPagesDescription(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  pageId: number
) {
  await requirePageAccess(db, actor, slug, projectId, pageId)
  const [row] = await db.select({ binary: pages.descriptionBinary }).from(pages).where(eq(pages.id, pageId))
  return row?.binary ? new Uint8Array(row.binary) : new Uint8Array()
}

/**
 * PD-0729, PD-0352: save the Yjs state with its HTML and JSON. A version is recorded in the background when the
 * HTML changed, and the page logs (mentions, images) are synchronized when HTML was sent.
 */
export async function updatePagesDescription(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  pageId: number,
  input: PageDescriptionBody
) {
  const { page } = await requirePageAccess(db, actor, slug, projectId, pageId, 'write')
  if (page.isLocked) throw new ServiceError(400, 'PAGE_LOCKED', 'PAGE_LOCKED', { errorCode: 4701 })
  if (page.archivedAt) throw new ServiceError(400, 'PAGE_ARCHIVED', 'PAGE_ARCHIVED', { errorCode: 4702 })
  const binary = resolveBinary(input.descriptionBinary)
  const description = input.descriptionHtml === undefined ? undefined : (resolveDescription(input) ?? undefined)
  const [updated] = await db
    .update(pages)
    .set({
      updatedById: actor.userId,
      ...(binary === undefined ? {} : { descriptionBinary: binary }),
      ...(input.descriptionJson ? { descriptionJson: input.descriptionJson } : {}),
      ...(description ? { descriptionHtml: description.html, descriptionStripped: description.stripped } : {})
    })
    .where(
      and(
        eq(pages.id, pageId),
        isNull(pages.deletedAt),
        eq(pages.isLocked, false),
        isNull(pages.archivedAt),
        mutationAccess(actor, slug, projectId, 'write')
      )
    )
    .returning({ id: pages.id })
  if (!updated) throw new ServiceError(409, 'PAGE_CHANGED', 'Page access or state changed')
  if (input.descriptionHtml) await emitPageJob(PAGE_JOB.transaction, { pageId })
  if (description && description.html !== page.descriptionHtml)
    await emitPageJob(PAGE_JOB.version, { pageId, userId: actor.userId })
  return { message: 'Updated successfully' }
}

/**
 * PD-0730: copy the page (and its links to every project) with the owner set to the actor. The binary state is not
 * copied, labels are not copied, and external ids are not copied so the copy never claims the original's identity.
 */
export async function duplicatePage(db: LancityDb, actor: Actor, slug: string, projectId: number, pageId: number) {
  const access = await requirePageAccess(db, actor, slug, projectId, pageId, 'write')
  const { workspace } = access
  const client = db.$client
  const [created] = await client.batch([
    client
      .prepare(
        `insert into pages (name, access, description_html, description_stripped, description_json, color, parent_id,
        archived_at, is_locked, view_props, logo_props, is_global, sort_order, owned_by_id, workspace_id, created_by_id, updated_by_id)
      select name || ' (Copy)', access, description_html, description_stripped, description_json, color, parent_id,
        archived_at, is_locked, view_props, logo_props, is_global, sort_order, ?, workspace_id, ?, ?
      from pages where id = ? and workspace_id = ? and deleted_at is null and (owned_by_id = ? or access = 0)
        and exists (
          select 1 from project_pages pp join projects p on p.id = pp.project_id and p.deleted_at is null
          join workspace_members wm on wm.workspace_id = pp.workspace_id and wm.member_id = ? and wm.is_active = 1 and wm.deleted_at is null
          join project_members pm on pm.project_id = pp.project_id and pm.workspace_id = pp.workspace_id and pm.member_id = ?
            and pm.is_active = 1 and pm.deleted_at is null
          where pp.page_id = pages.id and pp.project_id = ? and pp.deleted_at is null and (pages.owned_by_id = ? or pm.role >= 15)
        ) returning id`
      )
      .bind(
        actor.userId,
        actor.userId,
        actor.userId,
        pageId,
        workspace.id,
        actor.userId,
        actor.userId,
        actor.userId,
        projectId,
        actor.userId
      ),
    client
      .prepare(
        `insert into project_pages (page_id, project_id, workspace_id, created_by_id, updated_by_id)
      select last_insert_rowid(), ?, ?, ?, ? where changes() = 1`
      )
      .bind(projectId, workspace.id, actor.userId, actor.userId),
    client
      .prepare(
        `with np as materialized (select page_id as id, workspace_id from project_pages where id = last_insert_rowid() and changes() = 1)
      insert into project_pages (page_id, project_id, workspace_id, created_by_id, updated_by_id)
      select np.id, src.project_id, np.workspace_id, ?, ? from np
      join project_pages src on src.page_id = ? and src.deleted_at is null and src.project_id <> ?`
      )
      .bind(actor.userId, actor.userId, pageId, projectId)
  ])
  const copy = created.results[0] as { id: number } | undefined
  if (!copy) throw new ServiceError(409, 'PAGE_CHANGED', 'Page access or state changed')
  await emitPageJob(PAGE_JOB.transaction, { pageId: copy.id })
  await emitPageJob(PAGE_JOB.copyAssets, {
    entityName: 'PAGE',
    entityIdentifier: copy.id,
    projectId,
    slug,
    userId: actor.userId
  })
  return pageDetail(db, actor, access, projectId, copy.id)
}

export async function listPageVersions(db: LancityDb, actor: Actor, slug: string, projectId: number, pageId: number) {
  await requirePageAccess(db, actor, slug, projectId, pageId)
  return db
    .select({
      id: pageVersions.id,
      pageId: pageVersions.pageId,
      ownedById: pageVersions.ownedById,
      descriptionHtml: pageVersions.descriptionHtml,
      descriptionText: pageVersions.descriptionStripped,
      lastSavedAt: pageVersions.lastSavedAt
    })
    .from(pageVersions)
    .where(and(eq(pageVersions.pageId, pageId), isNull(pageVersions.deletedAt)))
    .orderBy(desc(pageVersions.lastSavedAt))
}
