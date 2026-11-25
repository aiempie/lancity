import { searchValue } from '@/server/common/unicode'
import { and, asc, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm'
import { pages, projectPages } from '@/db/schema/content'
import { buildOrderBy, buildSearchCondition } from '@/server/common/filters'
import type { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

type ProjectAccess = Awaited<ReturnType<typeof requireProjectAccess>>

/** Plane PAGE_ORDER_BY_ALLOWLIST. */
export const PAGE_ORDER_BY_ALLOWLIST = {
  created_at: pages.createdAt,
  updated_at: pages.updatedAt,
  name: pages.name,
  sort_order: pages.sortOrder
}

/** Pages the actor may see: guests without `guest_view_all_features` see only their own, others own or public. */
export function pageVisibility(actor: Actor, access: ProjectAccess): SQL {
  const owner = eq(pages.ownedById, actor.userId)
  return access.membership.role === 5 && !access.project.guestViewAllFeatures
    ? owner
    : (or(owner, eq(pages.access, 0)) as SQL)
}

export type PageQueryOptions = {
  pageId?: number
  /** Plane lists top-level pages only; sub-pages are reached through their id. */
  rootOnly?: boolean
  orderBy?: string | null
  search?: string | null
  includeDescription?: boolean
}

function parseIds(value: string | null): number[] {
  return value ? (JSON.parse(value) as number[]) : []
}

/** PD-0713: PageViewSet.get_queryset. Scoped to the workspace, the active project link and soft deletion. */
export async function queryPage(
  db: LancityDb,
  actor: Actor,
  access: ProjectAccess,
  projectId: number,
  options: PageQueryOptions = {}
) {
  if (access.project.archivedAt) return []
  const isFavorite = sql<number>`exists (select 1 from user_favorites uf where uf.entity_type = 'page'
    and uf.entity_identifier = ${pages.id} and uf.user_id = ${actor.userId} and uf.workspace_id = ${pages.workspaceId}
    and uf.deleted_at is null)`
  const rows = await db
    .select({
      id: pages.id,
      name: pages.name,
      access: pages.access,
      color: pages.color,
      ownedById: pages.ownedById,
      parentId: pages.parentId,
      isLocked: pages.isLocked,
      archivedAt: pages.archivedAt,
      workspaceId: pages.workspaceId,
      sortOrder: pages.sortOrder,
      viewProps: pages.viewProps,
      logoProps: pages.logoProps,
      descriptionHtml: options.includeDescription ? pages.descriptionHtml : sql<string | null>`null`,
      descriptionStripped: pages.descriptionStripped,
      createdById: pages.createdById,
      updatedById: pages.updatedById,
      createdAt: pages.createdAt,
      updatedAt: pages.updatedAt,
      isFavorite: isFavorite.mapWith(Boolean),
      labelIds: sql<string>`coalesce((select json_group_array(pl.label_id) from page_labels pl
        where pl.page_id = ${pages.id} and pl.deleted_at is null), '[]')`,
      projectIds: sql<string>`coalesce((select json_group_array(pp.project_id) from project_pages pp
        where pp.page_id = ${pages.id} and pp.deleted_at is null), '[]')`
    })
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
    .where(
      and(
        eq(pages.workspaceId, access.workspace.id),
        isNull(pages.deletedAt),
        options.pageId === undefined ? undefined : eq(pages.id, options.pageId),
        options.rootOnly ? isNull(pages.parentId) : undefined,
        pageVisibility(actor, access),
        buildSearchCondition([pages.name], options.search, [searchValue('pages', 'name', sql`${pages.id}`)])
      )
    )
    // Favourites stay pinned first; the sanitized user ordering is secondary and id breaks ties.
    .orderBy(
      desc(isFavorite),
      buildOrderBy(options.orderBy, PAGE_ORDER_BY_ALLOWLIST, '-created_at', pages.createdAt),
      asc(pages.id)
    )
  return rows.map(row => ({ ...row, labelIds: parseIds(row.labelIds), projectIds: parseIds(row.projectIds) }))
}

export type PageRow = Awaited<ReturnType<typeof queryPage>>[number]

/** Counts for the summary endpoint (PageViewSet.summary). */
export async function queryPageSummary(db: LancityDb, actor: Actor, access: ProjectAccess, projectId: number) {
  if (access.project.archivedAt) return { publicPages: 0, privatePages: 0, archivedPages: 0 }
  const [row] = await db
    .select({
      publicPages: sql<number>`coalesce(sum(case when ${pages.access} = 0 and ${pages.archivedAt} is null then 1 else 0 end), 0)`,
      privatePages: sql<number>`coalesce(sum(case when ${pages.access} = 1 and ${pages.archivedAt} is null then 1 else 0 end), 0)`,
      archivedPages: sql<number>`coalesce(sum(case when ${pages.archivedAt} is not null then 1 else 0 end), 0)`
    })
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
    .where(
      and(
        eq(pages.workspaceId, access.workspace.id),
        isNull(pages.deletedAt),
        isNull(pages.parentId),
        pageVisibility(actor, access)
      )
    )
  return row
}
