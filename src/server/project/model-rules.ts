import { and, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'
import { intakeIssues } from '@/db/schema/planning'
import { projectUserProperties } from '@/db/schema/workspace'
import {
  DEFAULT_PREFERENCES,
  getDefaultDisplayFilters,
  getDefaultDisplayProperties,
  getDefaultFilters
} from '@/server/issue/properties'
import type { LancityDb } from '@/types/database/schema'

/** Plane `ROLE`. */
export const ROLE = { ADMIN: 20, MEMBER: 15, GUEST: 5 } as const
/** Plane `ProjectNetwork`. */
export const ProjectNetwork = { SECRET: 0, PUBLIC: 2 } as const
/** Plane `IntakeIssueStatus.SNOOZED`. */
const INTAKE_SNOOZED = 0

/** PD-1464 `ProjectNetwork.choices`. */
export function choicesProjectNetwork() {
  return [
    { value: ProjectNetwork.SECRET, label: 'Secret' },
    { value: ProjectNetwork.PUBLIC, label: 'Public' }
  ]
}

/** PD-1465 `get_default_props`: default `view_props` and `default_props` of a project member. */
export function getDefaultProps() {
  return {
    filters: {
      priority: null,
      state: null,
      state_group: null,
      assignees: null,
      created_by: null,
      labels: null,
      start_date: null,
      target_date: null,
      subscriber: null
    },
    display_filters: {
      group_by: null,
      order_by: '-created_at',
      type: null,
      sub_issue: true,
      show_empty_groups: true,
      layout: 'list',
      calendar_date_range: ''
    }
  }
}

/** PD-1466 `get_default_preferences`. */
export function getDefaultPreferences() {
  return { pages: { block_display: true }, navigation: { default_tab: 'work_items', hide_in_more_menu: [] as string[] } }
}

/** Column defaults of a new `project_members` row (Plane model defaults). */
export function memberDefaults() {
  return { viewProps: getDefaultProps(), defaultProps: getDefaultProps(), preferences: getDefaultPreferences() }
}

/** PD-1477 `get_default_views`: layouts a deploy board publishes. */
export function getDefaultViews() {
  return { list: true, kanban: true, calendar: true, gantt: true, spreadsheet: true }
}

/** PD-1476 `get_anchor`. */
export function getAnchor() {
  return crypto.randomUUID().replaceAll('-', '')
}

/** Plane `DEFAULT_STATES`. */
export const DEFAULT_STATES = [
  { name: 'Backlog', color: '#60646C', sequence: 15000, group: 'backlog', default: true },
  { name: 'Todo', color: '#60646C', sequence: 25000, group: 'unstarted', default: false },
  { name: 'In Progress', color: '#F59E0B', sequence: 35000, group: 'started', default: false },
  { name: 'Done', color: '#46A758', sequence: 45000, group: 'completed', default: false },
  { name: 'Cancelled', color: '#9AA4BC', sequence: 55000, group: 'cancelled', default: false },
  { name: 'Triage', color: '#4E5355', sequence: 65000, group: 'triage', default: false }
] as const

const ICON_COLORS = ['#95999f', '#6d7b8a', '#5e6ad2', '#02b5ed', '#02b55c', '#f2be02', '#e57a00', '#f38e82']
const ICONS = [
  'home', 'apps', 'settings', 'star', 'favorite', 'done', 'check_circle', 'add_task', 'create_new_folder', 'dataset',
  'terminal', 'key', 'rocket', 'public', 'quiz', 'mood', 'gavel', 'eco', 'diamond', 'forest', 'bolt', 'sync', 'cached',
  'library_add', 'view_timeline', 'view_kanban', 'empty_dashboard', 'cycle'
]
const pick = <T>(values: T[]) => values[crypto.getRandomValues(new Uint32Array(1))[0] % values.length]

/** `ProjectCreateSerializer.create`: a random icon and color when no logo is provided. */
export function defaultLogoProps() {
  return { in_use: 'icon', icon: { name: pick(ICONS), color: pick(ICON_COLORS) } }
}

/** PD-1468 `Project.cover_image_url`: uploaded asset first, then the plain cover URL. */
export function coverImageUrlProject(
  project: { id: number; coverImage: string | null; coverImageAssetId: number | null },
  slug: string
) {
  if (project.coverImageAssetId)
    return `/api/v1/workspaces/${slug}/projects/${project.id}/assets/${project.coverImageAssetId}`
  return project.coverImage || null
}

/** PD-1467 `Project.__init__` and `save`: a timezone provided by the caller wins over the workspace timezone. */
export function initProject(provided: string | undefined, workspaceTimezone: string) {
  return provided ?? workspaceTimezone
}

/** PD-1471 `Project.save`: the identifier is trimmed and upper-cased. */
export function saveProject<T extends { identifier?: string }>(values: T): T {
  return values.identifier === undefined ? values : { ...values, identifier: values.identifier.trim().toUpperCase() }
}

/** True when the zone name is known to the runtime. */
export function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

function zoneParts(timestamp: number, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    })
      .formatToParts(new Date(timestamp))
      .map(part => [part.type, Number(part.value)])
  )
  return parts as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>
}

function zoneOffset(timestamp: number, timezone: string) {
  const p = zoneParts(timestamp, timezone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(timestamp / 1000) * 1000
}

/** Midnight of a local calendar day as an instant (what Plane `project_day_start` returns). */
function dayStart(year: number, month: number, day: number, timezone: string) {
  const guess = Date.UTC(year, month - 1, day)
  let start = guess - zoneOffset(guess, timezone)
  start = guess - zoneOffset(start, timezone)
  return start
}

/**
 * PD-1470 `Project._retime_intake_snoozes`: keep each open snooze on the same calendar day, at midnight of the new zone.
 * Returns the update statements so the caller runs them in the same batch as the timezone change.
 */
export async function retimeIntakeSnoozesProject(db: LancityDb, projectId: number, oldTimezone: string, newTimezone: string) {
  if (oldTimezone === newTimezone) return []
  const rows = await db
    .select({ id: intakeIssues.id, snoozedTill: intakeIssues.snoozedTill })
    .from(intakeIssues)
    .where(
      and(
        eq(intakeIssues.projectId, projectId),
        eq(intakeIssues.status, INTAKE_SNOOZED),
        isNotNull(intakeIssues.snoozedTill),
        isNull(intakeIssues.deletedAt)
      )
    )
  return rows.map(row => {
    const local = zoneParts(row.snoozedTill!.getTime(), oldTimezone)
    const value = new Date(dayStart(local.year, local.month, local.day, newTimezone))
    return db.update(intakeIssues).set({ snoozedTill: value }).where(eq(intakeIssues.id, row.id))
  })
}

/**
 * PD-1474 `ProjectMember.save` and PD-1472 `ProjectBaseModel.save`: new members get a `project_user_properties` row sorted
 * above their existing projects (min sort_order - 10000), in the project's own workspace.
 */
export function userPropertyInsert(db: LancityDb, input: { projectId: number | SQL; userId: number; actorId: number }) {
  // A builder (not db.run) so the statement can take part in db.batch on D1.
  return db
    .insert(projectUserProperties)
    .values({
      projectId: sql`${input.projectId}`,
      workspaceId: sql`(select p.workspace_id from projects p where p.id = ${input.projectId})`,
      userId: input.userId,
      // Plane's JSONFields default to these callables, so a new row carries them instead of `{}`.
      filters: getDefaultFilters(),
      displayFilters: getDefaultDisplayFilters(),
      displayProperties: getDefaultDisplayProperties(),
      preferences: DEFAULT_PREFERENCES,
      sortOrder: sql`coalesce((select min(up.sort_order) - 10000 from project_user_properties up
        where up.workspace_id = (select p.workspace_id from projects p where p.id = ${input.projectId})
        and up.user_id = ${input.userId} and up.deleted_at is null), 65535)`,
      createdById: input.actorId,
      updatedById: input.actorId
    })
    .onConflictDoNothing()
}
