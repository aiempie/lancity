import { eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { profiles } from '@/db/schema/identity'
import { getPerPage } from '@/server/common/pagination'
import { assertTimeZone } from '@/server/common/timezone-converter'
import type { LancityDb } from '@/types/database/schema'

export { handleApiError as handleExceptionBase } from '@/server/api/v1/errors'

/** PD-1541 `TimezoneMixin.initial`: the caller's profile timezone, UTC when unset or invalid. */
export async function initialTimezone(userId: number | undefined, db: LancityDb = getDb()): Promise<string> {
  if (!userId) return 'UTC'
  const [row] = await db.select({ timezone: profiles.userTimezone }).from(profiles).where(eq(profiles.userId, userId)).limit(1)
  try {
    if (!row?.timezone) return 'UTC'
    assertTimeZone(row.timezone)
    return row.timezone
  } catch {
    return 'UTC'
  }
}

/** PD-1545 `BaseAPIView.fields`: the comma separated `fields` query parameter, or null. */
export function fieldsBase(query: URLSearchParams): string[] | null {
  const fields = (query.get('fields') ?? '').split(',').filter(Boolean)
  return fields.length ? fields : null
}

/** PD-1546 `BaseAPIView.expand`: the comma separated `expand` query parameter, or null. */
export function expandBase(query: URLSearchParams): string[] | null {
  const expand = (query.get('expand') ?? '').split(',').filter(Boolean)
  return expand.length ? expand : null
}

/** PD-1542 `filter_queryset` (DjangoFilterBackend + SearchFilter): only `search` is used, applied by each service. */
export function filterQuerysetBase<T>(rows: T[], search: string | null, pick: (row: T) => string): T[] {
  const term = search?.trim().toLowerCase()
  return term ? rows.filter(row => pick(row).toLowerCase().includes(term)) : rows
}

/** Instance pages use 10 results per page, at most 10 (Plane `max_per_page=10, default_per_page=10`). */
export const instancePerPage = (query: URLSearchParams) => getPerPage(query, 10, 10)
