import { and, eq, isNull, sql } from 'drizzle-orm'
import { issueViews, userFavorites, userRecentVisits } from '@/db/schema/notification'
import { requireProjectAccess } from '@/server/project/permissions'
import { ServiceError } from '@/server/common/errors'
import { requireReportingWorkspace } from '@/server/notification/service'
import { saveUserFavorite } from '@/server/workspace/model-rules'
import { getFavoriteEntities } from '@/server/workspace/presenters'
import { recordRecentVisit } from '@/server/workspace/recent-visit'
import { pageEnvelope, parsePagination } from '@/server/issue/list'
import { ISSUE_LIST_SELECT, orderIssueQueryset } from '@/server/issue/filter'
import { saveIssueView, updateIssueViewValues } from '@/server/view/model-rules'
import { toViewIssueListResponse } from '@/server/view/presenters'
import {
  queryIssueView,
  queryIssueViewFavorite,
  queryWorkspaceView,
  queryWorkspaceViewIssues
} from '@/server/view/queries'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { ViewInput, ViewListQuery, ViewUpdate } from '@/types/reporting/p3-view-schema'
import type { SavedViewInput, SavedViewUpdate } from '@/types/reporting/schema'

/** PD-0835 `WorkspaceViewViewSet.list`: workspace guests only see the views they own. */
export async function listViews(db: LancityDb, actor: Actor, slug: string, query: ViewListQuery = {}) {
  const { workspace, membership } = await requireReportingWorkspace(db, actor, slug)
  return queryWorkspaceView(db, actor, workspace.id, { ownOnly: membership.role === 5, orderBy: query.order_by })
}
export async function getView(db: LancityDb, actor: Actor, slug: string, id: number) {
  const rows = await listViews(db, actor, slug)
  const row = rows.find(item => item.id === id)
  if (!row) throw new ServiceError(404, 'VIEW_NOT_FOUND', 'View not found')
  return row
}
/** PD-0832, PD-0833, PD-0374 `WorkspaceViewViewSet.create` and `perform_create`. */
export async function createView(db: LancityDb, actor: Actor, slug: string, input: SavedViewInput | ViewInput) {
  const { workspace } = await requireReportingWorkspace(db, actor, slug)
  const [row] = await db
    .insert(issueViews)
    .values({
      ...(await saveIssueView(db, { workspaceId: workspace.id, projectId: null }, input)),
      workspaceId: workspace.id,
      ownedById: actor.userId,
      createdById: actor.userId,
      updatedById: actor.userId
    })
    .returning()
  return row
}
/** PD-0836, PD-0375 `WorkspaceViewViewSet.partial_update`. */
export async function updateView(
  db: LancityDb,
  actor: Actor,
  slug: string,
  id: number,
  input: SavedViewUpdate | ViewUpdate
) {
  const row = await getView(db, actor, slug, id)
  if (row.ownedById !== actor.userId) throw new ServiceError(403, 'FORBIDDEN', 'Only the owner can update this view')
  if (row.isLocked) throw new ServiceError(400, 'VIEW_LOCKED', 'View is locked')
  const [updated] = await db
    .update(issueViews)
    .set({ ...updateIssueViewValues(input as ViewUpdate), updatedById: actor.userId })
    .where(
      and(
        eq(issueViews.id, id),
        eq(issueViews.workspaceId, row.workspaceId),
        eq(issueViews.ownedById, actor.userId),
        isNull(issueViews.deletedAt),
        eq(issueViews.isLocked, false)
      )
    )
    .returning()
  if (!updated) throw new ServiceError(400, 'VIEW_LOCKED', 'View is locked')
  return updated
}
export async function deleteView(db: LancityDb, actor: Actor, slug: string, id: number) {
  const { workspace, membership } = await requireReportingWorkspace(db, actor, slug)
  const [row] = await db
    .select()
    .from(issueViews)
    .where(
      and(
        eq(issueViews.id, id),
        eq(issueViews.workspaceId, workspace.id),
        isNull(issueViews.projectId),
        isNull(issueViews.deletedAt)
      )
    )
  if (!row || (row.ownedById !== actor.userId && membership.role !== 20))
    throw new ServiceError(404, 'VIEW_NOT_FOUND', 'View not found')
  await db.batch([
    db
      .update(issueViews)
      .set({ deletedAt: new Date(), updatedById: actor.userId })
      .where(
        and(
          eq(issueViews.id, id),
          eq(issueViews.workspaceId, row.workspaceId),
          isNull(issueViews.projectId),
          isNull(issueViews.deletedAt)
        )
      ),
    db
      .delete(userFavorites)
      .where(
        and(
          eq(userFavorites.workspaceId, row.workspaceId),
          isNull(userFavorites.projectId),
          eq(userFavorites.entityType, 'view'),
          eq(userFavorites.entityIdentifier, id)
        )
      )
  ])
}

async function projectViewScope(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const access = await requireProjectAccess(db, actor, slug, projectId)
  if (access.project.archivedAt) throw new ServiceError(404, 'PROJECT_NOT_FOUND', 'Project not found')
  return access
}
/** PD-0848 `IssueViewViewSet.list`: favorites first, then by name. Restricted guests only see their own views. */
export async function listProjectViews(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { workspace, project, membership, workspaceMembership } = await projectViewScope(db, actor, slug, projectId)
  const restricted = membership.role === 5 && workspaceMembership.role !== 20 && !project.guestViewAllFeatures
  return queryIssueView(db, actor, workspace.id, projectId, restricted)
}
export async function getProjectView(db: LancityDb, actor: Actor, slug: string, projectId: number, id: number) {
  const views = await listProjectViews(db, actor, slug, projectId)
  const view = views.find(row => row.id === id)
  if (!view) throw new ServiceError(404, 'VIEW_NOT_FOUND', 'View not found')
  return view
}
export async function createProjectView(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  input: SavedViewInput | ViewInput
) {
  const { workspace } = await projectViewScope(db, actor, slug, projectId)
  const [row] = await db
    .insert(issueViews)
    .values({
      ...(await saveIssueView(db, { workspaceId: workspace.id, projectId }, input)),
      workspaceId: workspace.id,
      projectId,
      ownedById: actor.userId,
      createdById: actor.userId,
      updatedById: actor.userId
    })
    .returning()
  return row
}
export async function updateProjectView(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  id: number,
  input: SavedViewUpdate | ViewUpdate
) {
  const view = await getProjectView(db, actor, slug, projectId, id)
  if (view.ownedById !== actor.userId) throw new ServiceError(403, 'FORBIDDEN', 'Only the owner can update this view')
  if (view.isLocked) throw new ServiceError(400, 'VIEW_LOCKED', 'View is locked')
  const [updated] = await db
    .update(issueViews)
    .set({ ...updateIssueViewValues(input as ViewUpdate), updatedById: actor.userId })
    .where(
      and(
        eq(issueViews.id, id),
        eq(issueViews.workspaceId, view.workspaceId),
        eq(issueViews.projectId, projectId),
        eq(issueViews.ownedById, actor.userId),
        isNull(issueViews.deletedAt),
        isNull(issueViews.archivedAt),
        eq(issueViews.isLocked, false)
      )
    )
    .returning()
  if (!updated) throw new ServiceError(400, 'VIEW_LOCKED', 'View is locked or unavailable')
  return updated
}
export async function deleteProjectView(db: LancityDb, actor: Actor, slug: string, projectId: number, id: number) {
  const access = await projectViewScope(db, actor, slug, projectId)
  const [view] = await db
    .select()
    .from(issueViews)
    .where(
      and(
        eq(issueViews.id, id),
        eq(issueViews.workspaceId, access.workspace.id),
        eq(issueViews.projectId, projectId),
        isNull(issueViews.deletedAt)
      )
    )
  if (
    !view ||
    (view.ownedById !== actor.userId && access.membership.role !== 20 && access.workspaceMembership.role !== 20)
  )
    throw new ServiceError(404, 'VIEW_NOT_FOUND', 'View not found')
  await db.batch([
    db
      .update(issueViews)
      .set({ deletedAt: new Date(), updatedById: actor.userId })
      .where(
        and(
          eq(issueViews.id, id),
          eq(issueViews.workspaceId, view.workspaceId),
          eq(issueViews.projectId, projectId),
          isNull(issueViews.deletedAt)
        )
      ),
    db
      .delete(userFavorites)
      .where(
        and(
          eq(userFavorites.workspaceId, view.workspaceId),
          eq(userFavorites.projectId, projectId),
          eq(userFavorites.entityType, 'view'),
          eq(userFavorites.entityIdentifier, id)
        )
      ),
    db
      .delete(userRecentVisits)
      .where(
        and(
          eq(userRecentVisits.workspaceId, view.workspaceId),
          eq(userRecentVisits.projectId, projectId),
          eq(userRecentVisits.entityName, 'view'),
          eq(userRecentVisits.entityIdentifier, id)
        )
      )
  ])
}
export async function setViewState(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number | null,
  id: number,
  field: 'lock' | 'archive',
  enabled: boolean
) {
  const access =
    projectId === null
      ? await requireReportingWorkspace(db, actor, slug)
      : await projectViewScope(db, actor, slug, projectId)
  const [view] = await db
    .select()
    .from(issueViews)
    .where(
      and(
        eq(issueViews.id, id),
        eq(issueViews.workspaceId, access.workspace.id),
        projectId === null ? isNull(issueViews.projectId) : eq(issueViews.projectId, projectId),
        eq(issueViews.ownedById, actor.userId),
        isNull(issueViews.deletedAt)
      )
    )
  if (!view) throw new ServiceError(404, 'VIEW_NOT_FOUND', 'View not found')
  const change = field === 'lock' ? { isLocked: enabled } : { archivedAt: enabled ? new Date() : null }
  const [updated] = await db
    .update(issueViews)
    .set({ ...change, updatedById: actor.userId })
    .where(
      and(
        eq(issueViews.id, id),
        eq(issueViews.workspaceId, access.workspace.id),
        eq(issueViews.ownedById, actor.userId),
        isNull(issueViews.deletedAt)
      )
    )
    .returning()
  return updated
}

/** Best-effort `recent_visited_task` for a view; a failure never breaks the read. `view` is outside the typed visit enum. */
async function recordViewVisit(db: LancityDb, actor: Actor, workspaceId: number, projectId: number | null, id: number) {
  try {
    await recordRecentVisit(db, {
      entity_name: 'view' as unknown as 'issue',
      entity_identifier: id,
      project_id: projectId,
      userId: actor.userId,
      workspaceId
    })
  } catch (error) {
    console.error('recent visit failed', error)
  }
}

/** PD-0837 `WorkspaceViewViewSet.retrieve`: the view plus a recent visit entry. */
export async function retrieveWorkspaceView(db: LancityDb, actor: Actor, slug: string, id: number) {
  const view = await getView(db, actor, slug, id)
  await recordViewVisit(db, actor, view.workspaceId, null, id)
  return view
}

/** PD-0849 `IssueViewViewSet.retrieve`: the view with `isFavorite` plus a recent visit entry. */
export async function retrieveProjectView(db: LancityDb, actor: Actor, slug: string, projectId: number, id: number) {
  const view = await getProjectView(db, actor, slug, projectId, id)
  await recordViewVisit(db, actor, view.workspaceId, projectId, id)
  return view
}

/** PD-0852 `IssueViewFavoriteViewSet.list` and PD-0853 `get_queryset`. */
export async function listIssueViewFavorites(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { workspace } = await projectViewScope(db, actor, slug, projectId)
  return queryIssueViewFavorite(db, actor, workspace.id, projectId)
}

/** PD-0854 `IssueViewFavoriteViewSet.create`: members only; 404 unless the view is in the project and visible. */
export async function createIssueViewFavorite(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  viewId: number
) {
  const access = await requireProjectAccess(db, actor, slug, projectId, 15)
  if (access.project.archivedAt) throw new ServiceError(404, 'PROJECT_NOT_FOUND', 'Project not found')
  const entity = await getFavoriteEntities(db, actor.userId, {
    entityType: 'view',
    entityIdentifier: viewId,
    projectId,
    workspaceId: access.workspace.id
  })
  if (!entity) throw new ServiceError(404, 'VIEW_NOT_FOUND', 'View not found')
  await db
    .insert(userFavorites)
    .values({
      entityType: 'view',
      entityIdentifier: viewId,
      sequence: await saveUserFavorite(db, access.workspace.id),
      projectId,
      userId: actor.userId,
      workspaceId: access.workspace.id,
      createdById: actor.userId,
      updatedById: actor.userId
    })
    .onConflictDoNothing()
}

/** PD-0855 `IssueViewFavoriteViewSet.destroy`: hard delete (`soft=False`), 404 when there is none. */
export async function deleteIssueViewFavorite(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  viewId: number
) {
  const access = await requireProjectAccess(db, actor, slug, projectId, 15)
  const removed = await db
    .delete(userFavorites)
    .where(
      and(
        eq(userFavorites.entityType, 'view'),
        eq(userFavorites.entityIdentifier, viewId),
        eq(userFavorites.projectId, projectId),
        eq(userFavorites.workspaceId, access.workspace.id),
        eq(userFavorites.userId, actor.userId),
        isNull(userFavorites.deletedAt)
      )
    )
    .returning({ id: userFavorites.id })
  if (!removed.length) throw new ServiceError(404, 'FAVORITE_NOT_FOUND', 'Favorite not found')
}

/**
 * PD-0842, PD-0843 `WorkspaceViewIssuesViewSet.list`: live issues of the workspace the actor may see, filtered by
 * the `filters` JSON and the legacy query-string filters, ordered by `order_by` and paginated like the project list.
 */
export async function listWorkspaceViewIssues(
  db: LancityDb,
  actor: Actor,
  slug: string,
  params: URLSearchParams,
  timezone = 'UTC'
) {
  const { workspace } = await requireReportingWorkspace(db, actor, slug)
  const query = Object.fromEntries(params.entries())
  const { limit, page } = parsePagination(query)
  const where = queryWorkspaceViewIssues(workspace.id, actor.userId, params, timezone)
  const order = orderIssueQueryset(query.order_by)
  const [counted] = await db.all<{ n: number }>(sql`select count(*) as n from issues where ${where}`)
  const total = Number(counted?.n ?? 0)
  const rows = await db.all<Record<string, unknown>>(
    sql`select ${ISSUE_LIST_SELECT} from issues where ${where} order by ${order.orderBy} limit ${limit + 1} offset ${page * limit}`
  )
  const results = rows.slice(0, limit).map(toViewIssueListResponse)
  return pageEnvelope({
    groupedBy: null,
    subGroupedBy: null,
    total,
    limit,
    page,
    hasNext: rows.length > limit,
    count: results.length,
    totalPages: Math.ceil(total / limit),
    results
  })
}
