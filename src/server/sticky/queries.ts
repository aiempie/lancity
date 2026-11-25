import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { stickies } from '@/db/schema/notification'
import { containsFolded, searchValue } from '@/server/common/unicode'

/**
 * Plane `StickyViewSet.get_queryset` and `WorkspaceStickyViewSet.get_queryset` (PD-0260, PD-0933): stickies of
 * one workspace owned by the user, soft deletes hidden.
 */
export function queryWorkspaceSticky(workspaceId: number, ownerId: number): SQL | undefined {
  return and(eq(stickies.workspaceId, workspaceId), eq(stickies.ownerId, ownerId), isNull(stickies.deletedAt))
}
export const querySticky = queryWorkspaceSticky

/** `description_stripped icontains query`. Unicode case-insensitive. */
export function stickySearch(query: string | undefined): SQL | undefined {
  if (!query) return undefined
  return containsFolded(sql`${stickies.descriptionStripped}`, query, searchValue('stickies', 'description_stripped', sql`${stickies.id}`))
}
