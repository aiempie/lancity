import { and, eq, isNull, max } from 'drizzle-orm'
import { userFavorites } from '@/db/schema/notification'
import { projects } from '@/db/schema/workspace'
import { restrictedWorkspaceSlugs } from '@/types/workspace/schema'
import type { LancityDb } from '@/types/database/schema'

// plane/db/models/workspace.py default JSON blobs (get_default_props, get_default_filters,
// get_default_display_filters, get_default_display_properties, get_issue_props).
export const getDefaultFilters = () => ({
  priority: null,
  state: null,
  state_group: null,
  assignees: null,
  created_by: null,
  labels: null,
  start_date: null,
  target_date: null,
  subscriber: null
})
const displayFilters = () => ({
  group_by: null,
  order_by: '-created_at',
  type: null,
  sub_issue: true,
  show_empty_groups: true,
  layout: 'list',
  calendar_date_range: ''
})
const displayProperties = () => ({
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
})
export const getDefaultDisplayFilters = () => ({ display_filters: displayFilters() })
export const getDefaultDisplayProperties = () => ({ display_properties: displayProperties() })
export const getDefaultProps = () => ({
  filters: getDefaultFilters(),
  display_filters: displayFilters(),
  display_properties: displayProperties()
})
export const getIssueProps = () => ({ subscribed: true, assigned: true, created: true, all_issues: true })

/** Throw-free port of slug_validator: true when the slug is not reserved. */
export function slugValidator(value: string): boolean {
  return !restrictedWorkspaceSlugs.has(value)
}

/** Workspace.logo_url: the uploaded asset URL when one exists, else the legacy logo text, else null. */
export function logoUrlWorkspace(workspace: {
  slug: string
  logo: string | null
  logoAssetId: number | null
}): string | null {
  if (workspace.logoAssetId) return `/api/v1/workspaces/${workspace.slug}/assets/${workspace.logoAssetId}`
  return workspace.logo || null
}

/** Workspace.delete: soft delete renames the slug with the deletion epoch so the slug can be reused. */
export function deletedWorkspaceSlug(slug: string, deletedAt: Date): string {
  return `${slug}__${Math.floor(deletedAt.getTime() / 1000)}`
}

/** WorkspaceBaseModel.save: a row tied to a project always takes the project's workspace. */
export async function saveWorkspaceBaseModel(
  db: LancityDb,
  row: { workspaceId: number; projectId?: number | null }
): Promise<{ workspaceId: number; projectId: number | null }> {
  if (!row.projectId) return { workspaceId: row.workspaceId, projectId: null }
  const [project] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(and(eq(projects.id, row.projectId), isNull(projects.deletedAt)))
  return { workspaceId: project?.workspaceId ?? row.workspaceId, projectId: row.projectId }
}

/** UserFavorite.save: a new favorite is placed 10000 after the largest sequence of the workspace. */
export async function saveUserFavorite(db: LancityDb, workspaceId: number): Promise<number> {
  const [row] = await db
    .select({ largest: max(userFavorites.sequence) })
    .from(userFavorites)
    .where(and(eq(userFavorites.workspaceId, workspaceId), isNull(userFavorites.deletedAt)))
  return row?.largest == null ? 65535 : row.largest + 10000
}
