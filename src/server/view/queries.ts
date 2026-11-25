import { and, asc, desc, eq, exists, isNull, or, sql, type SQL } from 'drizzle-orm'
import { issueViews, userFavorites } from '@/db/schema/notification'
import { issueFilterSet, ComplexFilterBackend } from '@/server/common/filters'
import { LIVE_ISSUES } from '@/server/issue/list'
import { issueFilters, sanitizeOrderBy } from '@/server/issue/filter'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

/** `VIEW_ORDER_BY_ALLOWLIST` of `order_queryset.py`. */
const VIEW_ORDER_COLUMNS = { created_at: issueViews.createdAt, updated_at: issueViews.updatedAt, name: issueViews.name }

/**
 * `WorkspaceViewViewSet.get_queryset` (PD-0834): workspace-level views the actor owns or that are public.
 * `ownOnly` narrows the list to the actor's own views (workspace guests).
 */
export async function queryWorkspaceView(
  db: LancityDb,
  actor: Actor,
  workspaceId: number,
  options: { ownOnly: boolean; orderBy?: string }
) {
  const order = sanitizeOrderBy(options.orderBy, new Set(Object.keys(VIEW_ORDER_COLUMNS)))
  const column = VIEW_ORDER_COLUMNS[order.replace(/^-/, '') as keyof typeof VIEW_ORDER_COLUMNS]
  return db
    .select()
    .from(issueViews)
    .where(
      and(
        eq(issueViews.workspaceId, workspaceId),
        isNull(issueViews.projectId),
        isNull(issueViews.deletedAt),
        isNull(issueViews.archivedAt),
        options.ownOnly
          ? eq(issueViews.ownedById, actor.userId)
          : or(eq(issueViews.ownedById, actor.userId), eq(issueViews.access, 1))
      )
    )
    .orderBy(order.startsWith('-') ? desc(column) : asc(column), desc(issueViews.id))
}

/**
 * `IssueViewViewSet.get_queryset` (PD-0847): project views visible to the actor with `is_favorite`,
 * favorites first, then by name. Project membership is checked by the caller.
 */
export async function queryIssueView(
  db: LancityDb,
  actor: Actor,
  workspaceId: number,
  projectId: number,
  ownOnly: boolean
) {
  const isFavorite = exists(
    db
      .select({ one: sql`1` })
      .from(userFavorites)
      .where(
        and(
          eq(userFavorites.userId, actor.userId),
          eq(userFavorites.entityType, 'view'),
          eq(userFavorites.entityIdentifier, issueViews.id),
          eq(userFavorites.projectId, projectId),
          eq(userFavorites.workspaceId, workspaceId),
          isNull(userFavorites.deletedAt)
        )
      )
  )
  return db
    .select({ view: issueViews, isFavorite: sql<boolean>`${isFavorite}` })
    .from(issueViews)
    .where(
      and(
        eq(issueViews.workspaceId, workspaceId),
        eq(issueViews.projectId, projectId),
        isNull(issueViews.deletedAt),
        isNull(issueViews.archivedAt),
        ownOnly
          ? eq(issueViews.ownedById, actor.userId)
          : or(eq(issueViews.ownedById, actor.userId), eq(issueViews.access, 1))
      )
    )
    .orderBy(desc(sql`${isFavorite}`), asc(issueViews.name))
    .then(rows => rows.map(row => ({ ...row.view, isFavorite: Boolean(row.isFavorite) })))
}

/** `IssueViewFavoriteViewSet.get_queryset` (PD-0853): the actor's favorite views of the workspace. */
export function queryIssueViewFavorite(db: LancityDb, actor: Actor, workspaceId: number, projectId: number) {
  return db
    .select()
    .from(userFavorites)
    .where(
      and(
        eq(userFavorites.workspaceId, workspaceId),
        eq(userFavorites.projectId, projectId),
        eq(userFavorites.userId, actor.userId),
        eq(userFavorites.entityType, 'view'),
        isNull(userFavorites.deletedAt)
      )
    )
}

/**
 * Port of `_get_project_permission_filters` (PD-0839) as a predicate on `issues`: the actor is an active member of
 * the project and, as a guest, sees all issues only when the project shares all features, else just their own.
 */
export function getProjectPermissionFiltersWorkspaceViewIssues(userId: number): SQL {
  return sql`exists (select 1 from project_members vpm join projects vp on vp.id = vpm.project_id
    where vpm.project_id = issues.project_id and vpm.member_id = ${userId} and vpm.is_active = 1 and vpm.deleted_at is null
      and vp.deleted_at is null
      and ((vpm.role = 5 and vp.guest_view_all_features = 1)
        or (vpm.role = 5 and vp.guest_view_all_features = 0 and issues.created_by_id = ${userId})
        or vpm.role > 5))`
}

/**
 * `WorkspaceViewIssuesViewSet.get_queryset` plus the filter steps of `list` (PD-0841): live issues of the workspace,
 * the rich `filters` JSON (`ComplexFilterBackend`), the legacy query-string filters and the permission predicate.
 */
export function queryWorkspaceViewIssues(
  workspaceId: number,
  userId: number,
  params: URLSearchParams,
  timezone = 'UTC'
): SQL {
  const rich = new ComplexFilterBackend(issueFilterSet).filterQueryset(params, { timezone })
  const legacy = issueFilters(Object.fromEntries(params.entries()), 'GET')
  const conds: SQL[] = [
    sql`issues.workspace_id = ${workspaceId}`,
    LIVE_ISSUES,
    getProjectPermissionFiltersWorkspaceViewIssues(userId),
    ...legacy
  ]
  if (rich) conds.push(rich)
  return sql.join(
    conds.map(cond => sql`(${cond})`),
    sql` and `
  )
}
