// Pure transforms for Plane data migrations about view properties, ordering and membership roles.
import { isRecord, type Row } from './transforms-accounts'

const DEFAULT_LEGACY_PROPERTIES = {
  assignee: true,
  due_date: true,
  key: true,
  labels: true,
  priority: true,
  state: true,
  sub_issue_count: true,
  attachment_count: true,
  link: true,
  estimate: true,
  created_on: true,
  updated_on: true
}

/**
 * PD-1294 `update_workspace_member_props` (0039): wrap the old flat properties in the first view_props layout.
 * `null` gets the full default; an object is kept as `properties`.
 */
export function updateWorkspaceMemberProps(viewProps: unknown): Row {
  return {
    filters: { type: null },
    groupByProperty: null,
    issueView: 'list',
    orderBy: '-created_at',
    properties: viewProps === null || viewProps === undefined ? { ...DEFAULT_LEGACY_PROPERTIES } : viewProps,
    showEmptyGroups: true
  }
}

function pick(source: unknown, key: string, fallback: unknown): unknown {
  const value = isRecord(source) ? source[key] : undefined
  return value === undefined ? fallback : value
}

function legacyFilters(old: Row): Row {
  const filters = isRecord(old.filters) ? old.filters : {}
  const out: Row = {}
  for (const key of ['priority', 'state', 'state_group', 'assignees', 'created_by', 'labels', 'start_date', 'target_date', 'subscriber']) {
    out[key] = pick(filters, key, null)
  }
  return out
}

function legacyDisplayFilters(old: Row): Row {
  const filters = isRecord(old.filters) ? old.filters : {}
  return {
    group_by: pick(old, 'groupByProperty', null),
    order_by: pick(old, 'orderBy', '-created_at'),
    type: pick(filters, 'type', null),
    sub_issue: pick(old, 'showSubIssues', true),
    show_empty_groups: pick(old, 'showEmptyGroups', true),
    layout: pick(old, 'issueView', 'list'),
    calendar_date_range: pick(old, 'calendarDateRange', '')
  }
}

const isNormalized = (props: unknown) => isRecord(props) && ('display_filters' in props || ('filters' in props && !('issueView' in props)))

/**
 * PD-1307 `workspace_member_props` (0044): `filters`, `display_filters` and `display_properties`.
 * A value that already has the new layout is returned unchanged so an import can run twice.
 */
export function workspaceMemberProps(oldProps: unknown): Row {
  if (isNormalized(oldProps) && isRecord(oldProps) && 'display_properties' in oldProps) return oldProps
  const old = isRecord(oldProps) ? oldProps : {}
  const props = isRecord(old.properties) ? old.properties : {}
  const displayProperties: Row = {}
  for (const key of [
    'assignee',
    'attachment_count',
    'created_on',
    'due_date',
    'estimate',
    'key',
    'labels',
    'link',
    'priority',
    'start_date',
    'state',
    'sub_issue_count',
    'updated_on'
  ]) {
    displayProperties[key] = pick(props, key, true)
  }
  return { filters: legacyFilters(old), display_filters: legacyDisplayFilters(old), display_properties: displayProperties }
}

/** PD-1308 `project_member_props` (0044): `filters` and `display_filters` only. */
export function projectMemberProps(oldProps: unknown): Row {
  if (isNormalized(oldProps) && isRecord(oldProps) && 'display_filters' in oldProps) return oldProps
  const old = isRecord(oldProps) ? oldProps : {}
  return { filters: legacyFilters(old), display_filters: legacyDisplayFilters(old) }
}

/** PD-1309 `cycle_module_props` (0044): `filters` only. */
export function cycleModuleProps(oldProps: unknown): Row {
  if (isRecord(oldProps) && 'filters' in oldProps && !('filter' in oldProps) && Object.keys(oldProps).length === 1) return oldProps
  const old = isRecord(oldProps) ? oldProps : {}
  return { filters: legacyFilters(old) }
}

/** PD-1310 `update_workspace_member_view_props` (0044): both prop columns of a membership. */
export function updateWorkspaceMemberViewProps(member: Row): { view_props: Row; default_props: Row } {
  return { view_props: workspaceMemberProps(member.view_props), default_props: workspaceMemberProps(member.default_props) }
}

/** PD-1311 `update_project_member_view_props` (0044). */
export function updateProjectMemberViewProps(member: Row): { view_props: Row; default_props: Row } {
  return { view_props: projectMemberProps(member.view_props), default_props: projectMemberProps(member.default_props) }
}

/** PD-1312 `update_cycle_props` (0044): the source only rewrites rows whose `view_props` has the legacy key `filter`. Null means unchanged. */
export function updateCycleProps(cycle: Row): Row | null {
  return isRecord(cycle.view_props) && 'filter' in cycle.view_props ? cycleModuleProps(cycle.view_props) : null
}

/** PD-1313 `update_module_props` (0044): same rule as cycles. */
export function updateModuleProps(module: Row): Row | null {
  return isRecord(module.view_props) && 'filter' in module.view_props ? cycleModuleProps(module.view_props) : null
}

/** PD-1302 `update_user_issue_properties` (0041): show the start date in personal issue properties. */
export function updateUserIssueProperties(properties: unknown): Row {
  return { ...(isRecord(properties) ? properties : {}), start_date: true }
}

/** PD-1303 `workspace_member_properties` (0041): show the start date in both view props of a workspace member. */
export function workspaceMemberProperties(member: Row): { view_props: Row; default_props: Row } {
  const withStart = (props: unknown): Row => {
    const base = isRecord(props) ? props : {}
    return { ...base, properties: { ...(isRecord(base.properties) ? base.properties : {}), start_date: true } }
  }
  return { view_props: withStart(member.view_props), default_props: withStart(member.default_props) }
}

/**
 * PD-1295, PD-1300, PD-1301, PD-1316 (project member, cycle, module and label order). Plane assigned random numbers; an export that
 * lacks `sort_order` gets repeatable values: rank of the source ID times `step`. Existing numbers are kept.
 */
export function backfillSortOrder<T extends Row>(rows: T[], step = 100): T[] {
  const missing = rows.filter(row => typeof row.sort_order !== 'number' || !Number.isFinite(row.sort_order))
  const byId = [...missing].sort((a, b) => String(a.id).localeCompare(String(b.id)))
  const rank = new Map(byId.map((row, index) => [row, (index + 1) * step]))
  return rows.map(row => (rank.has(row) ? { ...row, sort_order: rank.get(row) } : row))
}

export const updateProjectMemberSortOrder = backfillSortOrder
export const randomCycleOrder = backfillSortOrder
export const randomModuleOrder = backfillSortOrder
export const randomSortOrdering = backfillSortOrder

/** PD-1336 `update_workspace_project_member_role` (0076): role 10 became role 5 (guest) in the Plane source. */
export function updateWorkspaceProjectMemberRole(role: unknown): number {
  const value = Number(role)
  return value === 10 ? 5 : value
}

/** PD-1306 `update_issue_priority_choice` (0043): `NULL` and empty priority become `none`. */
export function updateIssuePriorityChoice(priority: unknown): string {
  return typeof priority === 'string' && priority ? priority : 'none'
}

/** PD-1319 `workspace_user_properties` (0053): personal settings row from a workspace membership. Null when no member id. */
export function workspaceUserProperties(member: Row): Row | null {
  if (!member.member_id) return null
  const viewProps = isRecord(member.view_props) ? member.view_props : {}
  return {
    user_id: member.member_id,
    workspace_id: member.workspace_id,
    display_filters: isRecord(viewProps.display_filters) ? viewProps.display_filters : {},
    display_properties: isRecord(viewProps.display_properties) ? viewProps.display_properties : {}
  }
}

/** PD-1320 `project_user_properties` (0053): filters of an issue property copied from the project member's view props. Null without a member. */
export function projectUserProperties(issueProperty: Row, projectMember: Row | undefined): Row | null {
  if (!projectMember) return null
  const viewProps = isRecord(projectMember.view_props) ? projectMember.view_props : {}
  return {
    ...issueProperty,
    filters: isRecord(viewProps.filters) ? viewProps.filters : {},
    display_filters: isRecord(viewProps.display_filters) ? viewProps.display_filters : {}
  }
}

/** PD-1349 `move_issue_user_properties_to_project_user_properties` (0115): copy preferences and sort order from live project members. */
export function moveIssueUserPropertiesToProjectUserProperties(properties: Row[], members: Row[]): Row[] {
  const byKey = new Map(members.filter(member => !member.deleted_at).map(member => [`${member.member_id}:${member.project_id}`, member]))
  return properties.map(property => {
    const member = property.deleted_at ? undefined : byKey.get(`${property.user_id}:${property.project_id}`)
    return member ? { ...property, preferences: member.preferences ?? {}, sort_order: member.sort_order ?? property.sort_order } : property
  })
}
