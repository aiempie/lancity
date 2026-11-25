export type FilterScalar = string | number | boolean | null
export type FilterLeaf = Record<string, FilterScalar | FilterScalar[]>
export type FilterNode = FilterLeaf | { and: FilterNode[] } | { or: FilterNode[] } | { not: FilterNode }

/** Body returned by every paginated list endpoint (same keys as Plane's `BasePaginator.paginate`). */
export type PaginatedBody<T = unknown> = {
  grouped_by: string | null
  sub_grouped_by: string | null
  total_count: number
  next_cursor: string
  prev_cursor: string
  next_page_results: boolean
  prev_page_results: boolean
  count: number
  total_pages: number
  total_results: number
  extra_stats: unknown
  results: T
}

/** Body of the global (page based) paginator. */
export type GlobalPaginatedBody<T = unknown> = {
  prev_cursor: string
  cursor: string
  next_cursor: string | null
  prev_page_results: boolean
  next_page_results: boolean
  page_count: number
  total_results: number
  total_pages: number
  results: T
}

/** `X-RateLimit-*` data reported by the API key limiter. */
export type RateLimitResult = {
  allowed: boolean
  remaining: number
  /** Unix seconds at which the window is considered reset (now + window, like DRF). */
  resetAt: number
  /** Seconds until the next request is allowed. Null when none can be computed. */
  retryAfter: number | null
}

export type RateSpec = { limit: number; windowSeconds: number }
