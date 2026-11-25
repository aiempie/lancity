import { ServiceError } from '@/server/common/errors'

/** Window of one page. Cursor format is `perPage:page:isPrev` as in plane.utils.paginator.Cursor. */
export function pageWindow(cursor: string | undefined, perPage: number, maxPerPage = 1000) {
  let page = 0
  if (cursor) {
    const bits = cursor.split(':')
    const value = Number(bits[0])
    const offset = Number(bits[1])
    if (bits.length !== 3 || !Number.isFinite(value) || !Number.isInteger(offset) || value < 0 || offset < 0)
      throw new ServiceError(400, 'INVALID_CURSOR', 'Invalid cursor parameter.')
    if (value > maxPerPage) throw new ServiceError(400, 'INVALID_CURSOR', 'Invalid cursor parameter.')
    page = offset
  }
  return { limit: perPage, page, offset: page * perPage }
}

/** Response envelope of BasePaginator.paginate (rows fetched with limit + 1 to detect a next page). */
export function pageEnvelope<T>(rows: T[], totalCount: number, win: { limit: number; page: number }, extra?: unknown) {
  const results = rows.slice(0, win.limit)
  return {
    grouped_by: null,
    sub_grouped_by: null,
    total_count: totalCount,
    next_cursor: `${win.limit}:${win.page + 1}:0`,
    prev_cursor: `${win.limit}:${win.page - 1}:1`,
    next_page_results: rows.length > win.limit,
    prev_page_results: win.page > 0,
    count: results.length,
    total_pages: Math.ceil(totalCount / win.limit),
    total_results: totalCount,
    extra_stats: extra ?? null,
    results
  }
}
