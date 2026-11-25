import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { parseError } from '@/server/common/errors'
import type { GlobalPaginatedBody, PaginatedBody } from '@/types/api/platform'
import type { LancityDb } from '@/types/database/schema'

/** Upper bound for a page, shared by every paginator (Plane `MAX_LIMIT`). */
export const MAX_LIMIT = 1000

type Row = Record<string, unknown>

/** Python `str()` of a scalar, so group keys match the Plane response (`None`, `True`). */
function pyStr(value: unknown): string {
  if (value === null || value === undefined) return 'None'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  return String(value)
}

// ---------------------------------------------------------------- cursor

/** Plane `Cursor`: `value:offset:is_prev`. `value` is the page size, `offset` the page index. */
export class Cursor {
  readonly offset: number
  readonly isPrev: boolean

  constructor(
    readonly value: number,
    offset: number | string = 0,
    isPrev: boolean | number = false,
    readonly hasResults: boolean | null = null
  ) {
    this.offset = Math.trunc(Number(offset))
    this.isPrev = Boolean(isPrev)
  }

  toString(): string {
    return `${this.value}:${this.offset}:${Number(this.isPrev)}`
  }

  equals(other: Cursor): boolean {
    return (
      this.value === other.value &&
      this.offset === other.offset &&
      this.isPrev === other.isPrev &&
      this.hasResults === other.hasResults
    )
  }

  /** Plane `__bool__`. */
  isTruthy(): boolean {
    return Boolean(this.hasResults)
  }

  static fromString(text: string): Cursor {
    const bits = typeof text === 'string' ? text.split(':') : []
    if (bits.length !== 3) throw new Error("Invalid cursor format: Cursor must be in the format 'value:offset:is_prev'")
    if (!/^-?\d+(\.\d+)?$/.test(bits[0]) || !/^-?\d+$/.test(bits[1]) || !/^-?\d+$/.test(bits[2])) {
      throw new Error('Invalid cursor format: values must be numbers')
    }
    return new Cursor(Number(bits[0]), Number(bits[1]), Number(bits[2]) !== 0)
  }
}

/** Plane `CursorResult`: one page plus the cursors to its neighbours. */
export class CursorResult<T> implements Iterable<T> {
  constructor(
    readonly results: T[],
    readonly next: Cursor,
    readonly prev: Cursor,
    readonly hits: number | null = null,
    readonly maxHits: number | null = null
  ) {}

  get length(): number {
    return this.results.length
  }

  [Symbol.iterator](): Iterator<T> {
    return this.results[Symbol.iterator]()
  }

  at(index: number): T | undefined {
    return this.results.at(index)
  }

  toString(): string {
    return `<CursorResult: results=${this.results.length}>`
  }
}

export class BadPaginationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BadPaginationError'
  }
}

/** Split `-name` into the sort key and direction (Plane `OffsetPaginator.__init__`). */
export function parseOrderBy(orderBy?: string | string[] | null): { key: string[] | null; desc: boolean } {
  if (orderBy === undefined || orderBy === null || orderBy === '') return { key: null, desc: false }
  if (Array.isArray(orderBy)) return { key: orderBy, desc: false }
  return orderBy.startsWith('-') ? { key: [orderBy.slice(1)], desc: true } : { key: [orderBy], desc: false }
}

/** Order clause that sorts NULLs last and falls back to newest first (`F(key).asc(nulls_last=True), -created_at`). */
export function orderByNullsLast(column: SQLWrapper, desc: boolean, createdAt: SQLWrapper): SQL {
  return sql`${column} ${sql.raw(desc ? 'desc' : 'asc')} nulls last, ${createdAt} desc`
}

// ---------------------------------------------------------------- offset paginator

export type OffsetPaginatorOptions<T> = {
  /** Return rows `[offset, offset + limit)` of the ordered query. The paginator asks for `limit + 1` rows. */
  fetch: (offset: number, limit: number) => Promise<T[]>
  /** Total number of rows (the unlimited query, or Plane's `total_count_queryset`). */
  count: () => Promise<number>
  /** Only used to describe the order (`-created_at`); the ordering itself lives in `fetch`. */
  orderBy?: string | string[] | null
  maxLimit?: number
  maxOffset?: number | null
  onResults?: (results: T[]) => T[] | Promise<T[]>
}

export interface Paginator<T> {
  getResult(limit: number, cursor: Cursor): Promise<CursorResult<T>>
  processResults?(results: T[]): unknown
}

/** Plane `OffsetPaginator`: page number based pagination with a look-ahead row to know if a next page exists. */
export class OffsetPaginator<T> implements Paginator<T> {
  readonly key: string[] | null
  readonly desc: boolean
  readonly maxLimit: number
  readonly maxOffset: number | null

  constructor(protected readonly options: OffsetPaginatorOptions<T>) {
    const order = parseOrderBy(options.orderBy)
    this.key = order.key
    this.desc = order.desc
    this.maxLimit = options.maxLimit ?? MAX_LIMIT
    this.maxOffset = options.maxOffset ?? null
  }

  protected checkOffset(offset: number): void {
    if (this.maxOffset !== null && offset >= this.maxOffset) throw new BadPaginationError('Pagination offset too large')
    if (offset < 0) throw new BadPaginationError('Pagination offset cannot be negative')
  }

  async getResult(limit = 1000, cursor: Cursor = new Cursor(0, 0, false)): Promise<CursorResult<T>> {
    const pageLimit = Math.min(limit, this.maxLimit)
    const page = cursor.offset
    const offset = page * pageLimit
    this.checkOffset(offset)

    let rows = await this.options.fetch(offset, pageLimit + 1)
    const hasMore = rows.length > pageLimit
    // Only slice from the end when going backwards (previous page), as Plane does.
    if (cursor.value !== pageLimit && cursor.isPrev) rows = rows.slice(-(pageLimit + 1))
    const total = await this.options.count()
    let results = rows.slice(0, pageLimit)
    if (this.options.onResults) results = await this.options.onResults(results)
    return new CursorResult(
      results,
      new Cursor(pageLimit, page + 1, false, hasMore),
      new Cursor(pageLimit, page - 1, true, page > 0),
      total,
      Math.ceil(total / pageLimit)
    )
  }
}

// ---------------------------------------------------------------- grouped paginators

/**
 * Group-by fields a client may request, mapped to the column alias the base query exposes
 * (Plane `ISSUE_GROUP_BY_ALLOWLIST`, which guards against field name injection).
 */
export const ISSUE_GROUP_BY_ALLOWLIST: Readonly<Record<string, string>> = {
  state_id: 'state_id',
  state__group: 'state_group',
  priority: 'priority',
  labels__id: 'label_id',
  assignees__id: 'assignee_id',
  issue_module__module_id: 'module_id',
  cycle_id: 'cycle_id',
  project_id: 'project_id',
  created_by: 'created_by_id',
  target_date: 'target_date',
  start_date: 'start_date'
}

/** Columns that hold many values per issue, and the response key listing all of them. */
const FIELD_MAPPER: Readonly<Record<string, string>> = {
  label_id: 'label_ids',
  assignee_id: 'assignee_ids',
  module_id: 'module_ids'
}

/** Resolve a requested group-by name to its column alias or throw a 400 for anything not allow-listed. */
export function resolveGroupColumn(name: string, label = 'group_by'): string {
  if (Object.hasOwn(ISSUE_GROUP_BY_ALLOWLIST, name)) return ISSUE_GROUP_BY_ALLOWLIST[name]
  if (Object.values(ISSUE_GROUP_BY_ALLOWLIST).includes(name)) return name
  throw parseError(`Invalid ${label} field: ${name}`)
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

export type GroupedPaginatorOptions = {
  db: LancityDb
  /**
   * Query returning one row per result. It must expose `id`, `created_at`, the sort column and the
   * group columns (see `ISSUE_GROUP_BY_ALLOWLIST` for the aliases). Pass a Drizzle select or `sql`.
   */
  base: SQLWrapper
  groupByFieldName: string
  groupByFields: unknown[]
  /** Extra condition counted per group, e.g. `sql\`b.archived_at is null\``. */
  countFilter?: SQL
  /** Column alias of the sort key, `-` prefix for descending. */
  orderBy: string
  maxLimit?: number
  maxOffset?: number | null
  onResults?: (results: Row[]) => Row[] | Promise<Row[]>
}

type SubGroupedPaginatorOptions = GroupedPaginatorOptions & { subGroupByFieldName: string; subGroupByFields: unknown[] }

type GroupBucket = { results: Row[]; total_results: number | undefined }

abstract class WindowedPaginator implements Paginator<Row> {
  protected readonly sortKey: string
  protected readonly desc: boolean
  protected readonly maxLimit: number
  protected readonly maxOffset: number | null
  protected readonly groupColumn: string

  constructor(protected readonly options: GroupedPaginatorOptions) {
    const { key, desc } = parseOrderBy(options.orderBy)
    if (!key || key.length !== 1 || !IDENTIFIER.test(key[0])) throw new BadPaginationError('A grouped paginator needs a sort column')
    this.sortKey = key[0]
    this.desc = desc
    this.maxLimit = options.maxLimit ?? MAX_LIMIT
    this.maxOffset = options.maxOffset ?? null
    this.groupColumn = resolveGroupColumn(options.groupByFieldName)
  }

  protected abstract partitions(): string[]

  protected order(alias: string): SQL {
    const a = sql.identifier(alias)
    return sql`${a}.${sql.identifier(this.sortKey)} ${sql.raw(this.desc ? 'desc' : 'asc')} nulls last, ${a}.created_at desc`
  }

  /** The base rows numbered inside each group, in Plane's window (`row_number() over (partition by ...)`). */
  protected numbered(): SQL {
    const partition = sql.join(this.partitions().map(name => sql`b.${sql.identifier(name)}`), sql`, `)
    return sql`select b.*, row_number() over (partition by ${partition} order by ${this.order('b')}) as row_number from (${this.options.base}) as b`
  }

  protected countExpr(): SQL {
    return this.options.countFilter
      ? sql`count(distinct b.id) filter (where ${this.options.countFilter})`
      : sql`count(distinct b.id)`
  }

  async getResult(limit = 50, cursor: Cursor = new Cursor(0, 0, false)): Promise<CursorResult<Row>> {
    const pageLimit = Math.min(limit, this.maxLimit)
    const page = cursor.offset
    const offset = page * pageLimit
    const stop = offset + pageLimit + 1
    if (this.maxOffset !== null && offset >= this.maxOffset) throw new BadPaginationError('Pagination offset too large')
    if (offset < 0) throw new BadPaginationError('Pagination offset cannot be negative')

    const { db } = this.options
    const rows = await db.all<Row>(
      sql`select w.* from (${this.numbered()}) as w where w.row_number > ${offset} and w.row_number < ${stop} order by ${this.order('w')}`
    )
    for (const row of rows) delete row.row_number
    const [more] = await db.all<{ has_more: number }>(
      sql`select exists(select 1 from (${this.numbered()}) as w where w.row_number >= ${stop}) as has_more`
    )
    const [counted] = await db.all<{ c: number }>(sql`select count(*) as c from (${this.options.base}) as b`)
    let maxHits = 0
    if (rows.length) {
      const [largest] = await db.all<{ c: number }>(
        sql`select ${this.countExpr()} as c from (${this.options.base}) as b group by ${this.groupBy()} order by c desc limit 1`
      )
      maxHits = Math.ceil((largest?.c ?? 0) / pageLimit)
    }
    return new CursorResult(
      rows,
      new Cursor(pageLimit, page + 1, false, Boolean(more?.has_more)),
      new Cursor(pageLimit, page - 1, true, page > 0),
      counted?.c ?? 0,
      maxHits
    )
  }

  /** Columns the largest-group count is taken over. */
  protected groupBy(): SQL {
    return sql`b.${sql.identifier(this.groupColumn)}`
  }

  abstract processResults(results: Row[]): Promise<Record<string, unknown>>
}

/** Plane `GroupedOffsetPaginator`: `limit` rows per group, plus per-group totals. */
export class GroupedOffsetPaginator extends WindowedPaginator {
  protected partitions(): string[] {
    return [this.groupColumn]
  }

  /** Plane `__get_total_dict`. A group whose filtered count is 0 still counts as 1, as upstream does. */
  async totalDict(): Promise<Record<string, number>> {
    const groups = await this.options.db.all<{ g: unknown; c: number }>(
      sql`select b.${sql.identifier(this.groupColumn)} as g, ${this.countExpr()} as c from (${this.options.base}) as b group by b.${sql.identifier(this.groupColumn)}`
    )
    const totals: Record<string, number> = {}
    for (const { g, c } of groups) totals[pyStr(g)] = (totals[pyStr(g)] ?? 0) + (c === 0 ? 1 : c)
    return totals
  }

  /** Plane `__get_field_dict`: an empty bucket for every expected group. */
  async fieldDict(): Promise<Record<string, GroupBucket>> {
    const totals = await this.totalDict()
    return Object.fromEntries(this.options.groupByFields.map(field => [pyStr(field), { results: [], total_results: totals[pyStr(field)] ?? 0 }]))
  }

  /** Plane `__query_multi_grouper`: rows repeat once per label/assignee/module, so merge them per issue. */
  async queryMultiGrouper(results: Row[]): Promise<Record<string, GroupBucket>> {
    const totals = await this.totalDict()
    const memberships = new Map<string, Set<string>>()
    for (const result of results) {
      const id = pyStr(result.id)
      memberships.set(id, (memberships.get(id) ?? new Set<string>()).add(pyStr(result[this.groupColumn])))
    }
    const grouped = new Map<string, Row[]>()
    for (const result of results) {
      const groupIds = [...(memberships.get(pyStr(result.id)) ?? [])]
      result[FIELD_MAPPER[this.groupColumn]] = groupIds.includes('None') ? [] : groupIds
      for (const groupId of groupIds) {
        const bucket = grouped.get(groupId) ?? []
        if (!bucket.some(existing => existing.id === result.id)) bucket.push(result)
        grouped.set(groupId, bucket)
      }
    }
    return Object.fromEntries([...grouped].map(([groupId, items]) => [groupId, { results: items, total_results: totals[groupId] }]))
  }

  /** Plane `__query_grouper`: single valued group column. */
  async queryGrouper(results: Row[]): Promise<Record<string, GroupBucket>> {
    const processed = await this.fieldDict()
    for (const result of results) processed[pyStr(result[this.groupColumn])]?.results.push(result)
    return processed
  }

  async processResults(results: Row[]): Promise<Record<string, unknown>> {
    if (!results.length) return {}
    return this.groupColumn in FIELD_MAPPER ? this.queryMultiGrouper(results) : this.queryGrouper(results)
  }
}

type SubBucket = { results: Record<string, GroupBucket>; total_results: number }

/** Plane `SubGroupedOffsetPaginator`: `limit` rows per (group, sub group) pair. */
export class SubGroupedOffsetPaginator extends WindowedPaginator {
  private readonly subColumn: string

  constructor(options: SubGroupedPaginatorOptions) {
    super(options)
    this.subColumn = resolveGroupColumn(options.subGroupByFieldName, 'sub_group_by')
  }

  protected partitions(): string[] {
    return [this.groupColumn, this.subColumn]
  }

  /** Plane `__get_total_dict`: group totals and group by sub group totals. */
  async totalDict(): Promise<[Record<string, number>, Record<string, Record<string, number>>]> {
    const g = sql.identifier(this.groupColumn)
    const s = sql.identifier(this.subColumn)
    const groups = await this.options.db.all<{ g: unknown; c: number }>(
      sql`select b.${g} as g, ${this.countExpr()} as c from (${this.options.base}) as b group by b.${g}`
    )
    const subGroups = await this.options.db.all<{ g: unknown; s: unknown; c: number }>(
      sql`select b.${g} as g, b.${s} as s, ${this.countExpr()} as c from (${this.options.base}) as b group by b.${g}, b.${s}`
    )
    const groupTotals: Record<string, number> = {}
    for (const row of groups) groupTotals[pyStr(row.g)] = (groupTotals[pyStr(row.g)] ?? 0) + (row.c === 0 ? 1 : row.c)
    const subTotals: Record<string, Record<string, number>> = {}
    for (const row of subGroups) (subTotals[pyStr(row.g)] ??= {})[pyStr(row.s)] = row.c
    return [groupTotals, subTotals]
  }

  /** Plane `__get_field_dict`. */
  async fieldDict(): Promise<Record<string, SubBucket>> {
    const [groupTotals, subTotals] = await this.totalDict()
    return Object.fromEntries(
      this.options.groupByFields.map(group => [
        pyStr(group),
        {
          results: Object.fromEntries(
            Object.keys(subTotals[pyStr(group)] ?? {}).map(sub => [sub, { results: [], total_results: subTotals[pyStr(group)][sub] ?? 0 }])
          ),
          total_results: groupTotals[pyStr(group)] ?? 0
        }
      ])
    )
  }

  /** Plane `__query_multi_grouper`. */
  async queryMultiGrouper(results: Row[]): Promise<Record<string, SubBucket>> {
    const processed = await this.fieldDict()
    const groupMap = new Map<string, Set<string>>()
    const subGroupMap = new Map<string, Set<string>>()
    for (const result of results) {
      const id = pyStr(result.id)
      if (this.groupColumn in FIELD_MAPPER) groupMap.set(id, (groupMap.get(id) ?? new Set<string>()).add(pyStr(result[this.groupColumn])))
      if (this.subColumn in FIELD_MAPPER) subGroupMap.set(id, (subGroupMap.get(id) ?? new Set<string>()).add(pyStr(result[this.subColumn])))
    }
    for (const result of results) {
      const group = pyStr(result[this.groupColumn])
      const sub = pyStr(result[this.subColumn])
      const id = pyStr(result.id)
      if (!(group in processed) || !(sub in processed[group].results)) continue
      if (this.groupColumn in FIELD_MAPPER) {
        const ids = [...(groupMap.get(id) ?? [])]
        result[FIELD_MAPPER[this.groupColumn]] = ids.includes('None') ? [] : ids
      }
      if (this.subColumn in FIELD_MAPPER) {
        const ids = [...(subGroupMap.get(id) ?? [])]
        result[FIELD_MAPPER[this.subColumn]] = ids.includes('None') ? [] : ids
      }
      processed[group].results[sub].results.push(result)
    }
    return processed
  }

  /** Plane `__query_grouper`. */
  async queryGrouper(results: Row[]): Promise<Record<string, SubBucket>> {
    const processed = await this.fieldDict()
    for (const result of results) processed[pyStr(result[this.groupColumn])]?.results[pyStr(result[this.subColumn])]?.results.push(result)
    return processed
  }

  async processResults(results: Row[]): Promise<Record<string, unknown>> {
    if (!results.length) return {}
    return this.groupColumn in FIELD_MAPPER || this.subColumn in FIELD_MAPPER ? this.queryMultiGrouper(results) : this.queryGrouper(results)
  }
}

// ---------------------------------------------------------------- request level pagination

type QueryInput = URLSearchParams | Record<string, string | undefined | null>

function queryValue(query: QueryInput, name: string): string | undefined {
  const value = query instanceof URLSearchParams ? query.get(name) : query[name]
  return value === null ? undefined : value
}

/** Plane `BasePaginator._effective_max_per_page`: the cap can never be below the default page size. */
export function effectiveMaxPerPage(maxPerPage: number, defaultPerPage: number): number {
  return Math.max(maxPerPage, defaultPerPage)
}

/** Plane `BasePaginator.get_per_page`: `per_page` must be an integer in `1..max`. */
export function getPerPage(query: QueryInput, defaultPerPage = 1000, maxPerPage = 1000): number {
  const raw = queryValue(query, 'per_page')
  let perPage = defaultPerPage
  if (raw !== undefined) {
    if (!/^\s*[+-]?\d+\s*$/.test(raw)) throw parseError('Invalid per_page parameter.')
    perPage = Number(raw)
  }
  const max = effectiveMaxPerPage(maxPerPage, defaultPerPage)
  if (perPage <= 0) throw parseError('Invalid per_page value. Must be greater than zero.')
  if (perPage > max) throw parseError(`Invalid per_page value. Cannot exceed ${max}.`)
  return perPage
}

export type PaginateOptions<T> = {
  paginator: Paginator<T>
  defaultPerPage?: number
  maxPerPage?: number
  onResults?: (results: T[]) => T[] | Promise<T[]>
  /** Final transformation of the (possibly grouped) results. */
  controller?: (results: unknown) => unknown | Promise<unknown>
  extraStats?: unknown
  groupByFieldName?: string | null
  subGroupByFieldName?: string | null
}

/**
 * Plane `BasePaginator.paginate`: validate `per_page` and `cursor`, run the paginator and build the response
 * body. Malformed input throws a 400 `PARSE_ERROR` ServiceError. Build the paginator from the same request
 * (for grouped results, `groupByFieldName` is checked against the allow-list by the paginator constructor).
 */
export async function paginate<T>(query: QueryInput, options: PaginateOptions<T>): Promise<PaginatedBody> {
  const { defaultPerPage = 1000, maxPerPage = 1000, groupByFieldName = null, subGroupByFieldName = null } = options
  const perPage = getPerPage(query, defaultPerPage, maxPerPage)
  let cursor: Cursor
  try {
    cursor = Cursor.fromString(queryValue(query, 'cursor') ?? `${perPage}:0:0`)
  } catch {
    throw parseError('Invalid cursor parameter.')
  }
  // The cursor value is a page size from 0 to the effective maximum; the offset is a non-negative page index.
  if (!(cursor.value >= 0 && cursor.value <= effectiveMaxPerPage(maxPerPage, defaultPerPage)) || cursor.offset < 0) {
    throw parseError('Invalid cursor parameter.')
  }
  let cursorResult: CursorResult<T>
  try {
    cursorResult = await options.paginator.getResult(perPage, cursor)
  } catch (error) {
    if (error instanceof BadPaginationError) throw parseError('Error in parsing')
    throw error
  }
  let results: unknown = options.onResults ? await options.onResults(cursorResult.results) : cursorResult.results
  if (groupByFieldName && options.paginator.processResults) results = await options.paginator.processResults(results as T[])
  if (options.controller) results = await options.controller(results)
  return {
    grouped_by: groupByFieldName,
    sub_grouped_by: subGroupByFieldName,
    total_count: cursorResult.hits ?? 0,
    next_cursor: String(cursorResult.next),
    prev_cursor: String(cursorResult.prev),
    next_page_results: Boolean(cursorResult.next.hasResults),
    prev_page_results: Boolean(cursorResult.prev.hasResults),
    count: cursorResult.length,
    total_pages: cursorResult.maxHits ?? 0,
    total_results: cursorResult.hits ?? 0,
    extra_stats: options.extraStats ?? null,
    results
  }
}

// ---------------------------------------------------------------- global (page number) paginator

export const PAGINATOR_MAX_LIMIT = 1000

/** Plane `PaginateCursor`: `page_size:page:offset`. */
export class PaginateCursor {
  constructor(
    readonly currentPageSize: number,
    readonly currentPage: number,
    readonly offset: number
  ) {}

  toString(): string {
    return `${this.currentPageSize}:${this.currentPage}:${this.offset}`
  }

  static fromString(value: string): PaginateCursor {
    const bits = typeof value === 'string' ? value.split(':') : []
    if (bits.length !== 3 || !bits.every(bit => /^-?\d+$/.test(bit))) {
      throw new Error("Invalid cursor format: Cursor must be in the format 'value:offset:is_prev'")
    }
    return new PaginateCursor(Number(bits[0]), Number(bits[1]), Number(bits[2]))
  }
}

/** Plane `global_paginator.paginate`: slice by page without look-ahead and report total pages. */
export async function paginateGlobal<T, R = T>(
  source: { count: () => Promise<number>; fetchRange: (start: number, end: number) => Promise<T[]> },
  cursor?: string | null,
  onResult?: (rows: T[]) => R[] | Promise<R[]>
): Promise<GlobalPaginatedBody<R[]>> {
  const cursorObject = cursor ? PaginateCursor.fromString(cursor) : new PaginateCursor(PAGINATOR_MAX_LIMIT, 0, 0)
  const pageSize = Math.min(cursorObject.currentPageSize, PAGINATOR_MAX_LIMIT)
  if (pageSize <= 0 || cursorObject.currentPage < 0) throw new Error('Invalid cursor format: page size and page must be positive')
  const total = await source.count()
  const start = cursorObject.currentPage > 0 ? cursorObject.currentPage * pageSize : 0
  const end = Math.min(start + pageSize, total)
  const rows = await source.fetchRange(start, end)
  const results = onResult ? await onResult(rows) : (rows as unknown as R[])
  const next = end < total ? `${pageSize}:${cursorObject.currentPage + 1}:0` : null
  return {
    prev_cursor: `${pageSize}:${cursorObject.currentPage - 1}:0`,
    cursor: `${pageSize}:${cursorObject.currentPage}:0`,
    next_cursor: next,
    prev_page_results: cursorObject.currentPage > 0,
    next_page_results: next !== null,
    page_count: results.length,
    total_results: total,
    total_pages: Math.ceil(total / pageSize),
    results
  }
}
