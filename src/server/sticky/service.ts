import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { stickies } from '@/db/schema/notification'
import { ServiceError } from '@/server/common/errors'
import { OffsetPaginator, paginate } from '@/server/common/pagination'
import { requireReportingWorkspace } from '@/server/notification/service'
import {
  nextStickySortOrder,
  stickyDescriptionStripped,
  validateStickyBinary,
  validateStickyHtml
} from '@/server/sticky/model-rules'
import { presentSticky } from '@/server/sticky/presenters'
import { queryWorkspaceSticky, stickySearch } from '@/server/sticky/queries'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { StickyApiInput } from '@/types/notification/p2-notification-schema'
import type { StickyInput } from '@/types/reporting/schema'

/** Fields of `StickySerializer` beyond the original input schema. */
type StickyWrite = StickyInput & Pick<StickyApiInput, 'description_binary' | 'logo_props' | 'sort_order'>

/** Column values of one create or update, after the `StickySerializer.validate` checks. */
function stickyValues(input: StickyWrite) {
  const html = validateStickyHtml(input.description_html)
  const binary = validateStickyBinary(input.description_binary)
  return {
    name: input.name,
    description: input.description,
    descriptionHtml: html,
    // `Sticky.save` recomputes the search text on every save.
    ...(html === undefined ? {} : { descriptionStripped: stickyDescriptionStripped(html) }),
    descriptionBinary: binary === undefined || binary === null ? binary : Buffer.from(binary),
    logoProps: input.logo_props,
    color: input.color,
    backgroundColor: input.background_color,
    sortOrder: input.sort_order
  }
}

export async function listStickies(db: LancityDb, actor: Actor, slug: string) {
  const { workspace } = await requireReportingWorkspace(db, actor, slug)
  return db
    .select()
    .from(stickies)
    .where(queryWorkspaceSticky(workspace.id, actor.userId))
    .orderBy(desc(stickies.createdAt))
    .limit(100)
}

type PageQuery = URLSearchParams | Record<string, string | undefined | null>

/** WorkspaceStickyViewSet.list (PD-0935, PD-0936): optional text search, newest sort order first, 20 per page. */
export async function listStickiesPage(
  db: LancityDb,
  actor: Actor,
  slug: string,
  search: string | undefined,
  query: PageQuery = {}
) {
  const { workspace } = await requireReportingWorkspace(db, actor, slug)
  const where = and(queryWorkspaceSticky(workspace.id, actor.userId), stickySearch(search))
  return paginate(query, {
    defaultPerPage: 20,
    paginator: new OffsetPaginator({
      orderBy: '-sort_order',
      fetch: (offset, limit) =>
        db
          .select()
          .from(stickies)
          .where(where)
          .orderBy(desc(stickies.sortOrder), desc(stickies.id))
          .limit(limit)
          .offset(offset),
      count: async () => (await db.select({ total: count() }).from(stickies).where(where))[0].total
    }),
    onResults: rows => rows.map(presentSticky) as never
  })
}

export async function getSticky(db: LancityDb, actor: Actor, slug: string, id: number) {
  const { workspace } = await requireReportingWorkspace(db, actor, slug)
  const [row] = await db
    .select()
    .from(stickies)
    .where(and(eq(stickies.id, id), queryWorkspaceSticky(workspace.id, actor.userId)))
  if (!row) throw new ServiceError(404, 'STICKY_NOT_FOUND', 'Sticky not found')
  return row
}

export async function createSticky(db: LancityDb, actor: Actor, slug: string, input: StickyWrite) {
  const { workspace } = await requireReportingWorkspace(db, actor, slug)
  const values = stickyValues(input)
  const [row] = await db
    .insert(stickies)
    .values({
      ...values,
      sortOrder: values.sortOrder ?? nextStickySortOrder(workspace.id),
      ownerId: actor.userId,
      workspaceId: workspace.id,
      createdById: actor.userId,
      updatedById: actor.userId
    })
    .returning()
  return row
}

export async function updateSticky(db: LancityDb, actor: Actor, slug: string, id: number, input: StickyWrite) {
  const row = await getSticky(db, actor, slug, id)
  const [updated] = await db
    .update(stickies)
    .set({ ...stickyValues(input), updatedById: actor.userId })
    .where(
      and(
        eq(stickies.id, id),
        eq(stickies.workspaceId, row.workspaceId),
        eq(stickies.ownerId, actor.userId),
        isNull(stickies.deletedAt)
      )
    )
    .returning()
  return updated
}

export async function deleteSticky(db: LancityDb, actor: Actor, slug: string, id: number) {
  const row = await getSticky(db, actor, slug, id)
  await db
    .update(stickies)
    .set({ deletedAt: new Date(), updatedById: actor.userId })
    .where(
      and(
        eq(stickies.id, id),
        eq(stickies.workspaceId, row.workspaceId),
        eq(stickies.ownerId, actor.userId),
        isNull(stickies.deletedAt)
      )
    )
}
