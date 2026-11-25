import { and, eq, isNull, max } from 'drizzle-orm'
import { issueViews } from '@/db/schema/notification'
import type { JsonValue, LancityDb } from '@/types/database/schema'
import type { ViewInput, ViewUpdate } from '@/types/reporting/p3-view-schema'

/** Port of `get_default_filters` (PD-1502). */
export function getDefaultFilters(): Record<string, JsonValue | null> {
  return {
    priority: null,
    state: null,
    state_group: null,
    assignees: null,
    created_by: null,
    labels: null,
    start_date: null,
    target_date: null,
    subscriber: null
  }
}

/** Port of `get_default_display_filters` (PD-1503). */
export function getDefaultDisplayFilters(): Record<string, JsonValue | null> {
  return {
    group_by: null,
    order_by: '-created_at',
    type: null,
    sub_issue: true,
    show_empty_groups: true,
    layout: 'list',
    calendar_date_range: ''
  }
}

/** Port of `get_default_display_properties` (PD-1504). */
export function getDefaultDisplayProperties(): Record<string, JsonValue> {
  return {
    assignee: true,
    attachment_count: true,
    created_on: true,
    due_date: true,
    estimate: true,
    key: true,
    labels: true,
    link: true,
    priority: true,
    start_date: true,
    state: true,
    sub_issue_count: true,
    updated_on: true
  }
}

/**
 * Stand-in for `issue_filters(filters, "POST")` in `IssueView.save`: Plane stores the Django lookups that the
 * filters produce. Lancity re-reads `filters` through the issue filter helpers, so `query` keeps the filters
 * that carry a value and drops the empty ones.
 */
export function viewQueryFromFilters(filters: Record<string, JsonValue | null> | null | undefined): Record<string, JsonValue> {
  const query: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue
    query[key] = value
  }
  return query
}

/** Next `sort_order` of a new view: the largest one in its scope plus 10000 (`IssueView.save`). */
export async function nextViewSortOrder(db: LancityDb, workspaceId: number, projectId: number | null) {
  const [row] = await db
    .select({ largest: max(issueViews.sortOrder) })
    .from(issueViews)
    .where(
      and(
        eq(issueViews.workspaceId, workspaceId),
        projectId === null ? isNull(issueViews.projectId) : eq(issueViews.projectId, projectId)
      )
    )
  return row?.largest == null ? 65535 : row.largest + 10000
}

function columns(input: ViewInput | ViewUpdate) {
  return {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.access !== undefined && { access: input.access }),
    ...(input.display_filters !== undefined && { displayFilters: input.display_filters }),
    ...(input.display_properties !== undefined && { displayProperties: input.display_properties }),
    ...(input.rich_filters !== undefined && { richFilters: input.rich_filters }),
    ...(input.logo_props !== undefined && { logoProps: input.logo_props }),
    ...(input.sort_order !== undefined && { sortOrder: input.sort_order }),
    ...(input.filters !== undefined && { filters: input.filters, query: viewQueryFromFilters(input.filters) }),
    ...(input.filters === undefined && input.query !== undefined && { query: input.query })
  }
}

/**
 * Port of `IssueView.save` for inserts (PD-1505, PD-0374): defaults of the JSON columns, `query` from `filters`
 * and the next sort order unless the caller sets one.
 */
export async function saveIssueView(
  db: LancityDb,
  scope: { workspaceId: number; projectId: number | null },
  input: ViewInput
) {
  const values = columns(input)
  return {
    ...values,
    name: input.name,
    query: values.query ?? {},
    displayFilters: values.displayFilters ?? getDefaultDisplayFilters(),
    displayProperties: values.displayProperties ?? getDefaultDisplayProperties(),
    sortOrder: values.sortOrder ?? (await nextViewSortOrder(db, scope.workspaceId, scope.projectId))
  }
}

/** Port of `IssueViewSerializer.update` and the update path of `save` (PD-0375): `query` follows `filters`. */
export function updateIssueViewValues(input: ViewUpdate) {
  return columns(input)
}
