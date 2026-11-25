import { and, eq, isNull, sql } from 'drizzle-orm'
import { projectUserProperties } from '@/db/schema/workspace'
import { parseInput } from '@/server/api/v1/validation'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { JsonValue, LancityDb } from '@/types/database/schema'
import { projectUserPropertyInputSchema, type ProjectUserPropertyInput } from '@/types/issue/schema'

/** Defaults of `get_default_properties` (PD-1413): the legacy per-member column flags. */
export function getDefaultProperties() {
  return {
    assignee: true,
    start_date: true,
    due_date: true,
    labels: true,
    key: true,
    priority: true,
    state: true,
    sub_issue_count: true,
    link: true,
    attachment_count: true,
    estimate: true,
    created_on: true,
    updated_on: true
  }
}
/** Defaults of `get_default_filters` (PD-1414). */
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
/** Defaults of `get_default_display_filters` (PD-1415). */
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
/** Defaults of `get_default_display_properties` (PD-1416). */
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
/** Defaults of `get_default_preferences`. */
export const DEFAULT_PREFERENCES = {
  pages: { block_display: true },
  navigation: { default_tab: 'work_items', hide_in_more_menu: [] }
}

/** `get_or_create` of the actor's property row for a project, as Plane's `ProjectUserDisplayPropertyEndpoint` does. */
async function propertyRow(db: LancityDb, actor: Actor, projectId: number, workspaceId: number) {
  const where = and(
    eq(projectUserProperties.projectId, projectId),
    eq(projectUserProperties.userId, actor.userId),
    isNull(projectUserProperties.deletedAt)
  )
  const [existing] = await db.select().from(projectUserProperties).where(where)
  if (existing) return existing
  await db
    .insert(projectUserProperties)
    .values({
      projectId,
      workspaceId,
      userId: actor.userId,
      createdById: actor.userId,
      updatedById: actor.userId,
      filters: getDefaultFilters(),
      displayFilters: getDefaultDisplayFilters(),
      displayProperties: getDefaultDisplayProperties(),
      preferences: DEFAULT_PREFERENCES
    })
    .onConflictDoNothing()
  const [created] = await db.select().from(projectUserProperties).where(where)
  return created
}

/** Port of `ProjectUserDisplayPropertyEndpoint.get` (PD-0591). Every project role may read its own properties. */
export async function getProjectUserDisplayProperty(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 5)
  return propertyRow(db, actor, projectId, workspace.id)
}

/** Port of `ProjectUserDisplayPropertyEndpoint.patch` (PD-0590): a partial update of the actor's own row. */
export async function updateProjectUserDisplayProperty(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  raw: ProjectUserPropertyInput
) {
  const input = parseInput(projectUserPropertyInputSchema, raw)
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 5)
  const row = await propertyRow(db, actor, projectId, workspace.id)
  const [updated] = await db
    .update(projectUserProperties)
    .set({
      ...(input.displayProperties ? { displayProperties: input.displayProperties as JsonValue } : {}),
      ...(input.displayFilters ? { displayFilters: input.displayFilters as JsonValue } : {}),
      ...(input.filters ? { filters: input.filters as JsonValue } : {}),
      ...(input.richFilters ? { richFilters: input.richFilters as JsonValue } : {}),
      ...(input.preferences ? { preferences: input.preferences as JsonValue } : {}),
      ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
      updatedById: actor.userId,
      updatedAt: sql`max(${projectUserProperties.updatedAt} + 1, cast(unixepoch('subsec') * 1000 as integer))`
    })
    .where(and(eq(projectUserProperties.id, row.id), eq(projectUserProperties.userId, actor.userId)))
    .returning()
  return updated
}
