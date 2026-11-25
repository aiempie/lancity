import { and, eq, isNull, min } from 'drizzle-orm'
import { modules } from '@/db/schema/planning'
import type { LancityDb } from '@/types/database/schema'

/** PD-1445 `get_default_filters`. */
export function getDefaultFilters() {
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

/** PD-1446 `get_default_display_filters`. */
export function getDefaultDisplayFilters() {
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

/** PD-1447 `get_default_display_properties`. */
export function getDefaultDisplayProperties() {
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
 * PD-1448 `Module.save` for a new row: the module goes 10000 before the smallest sort order of the project, so
 * the newest module sorts first. The first module keeps the column default (65535).
 */
export async function saveModule(db: LancityDb, projectId: number): Promise<number> {
  const [row] = await db
    .select({ smallest: min(modules.sortOrder) })
    .from(modules)
    .where(and(eq(modules.projectId, projectId), isNull(modules.deletedAt)))
  return row?.smallest == null ? 65535 : row.smallest - 10000
}
