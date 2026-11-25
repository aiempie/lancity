import { sql } from 'drizzle-orm'
import { user } from '@/db/schema/auth'
import { profiles } from '@/db/schema/identity'
import type { LancityDb } from '@/types/database/schema'

// Select fragment for the UserLiteSerializer fields of a member (id, names, avatar, display name, bot flag).
export const memberUserFields = {
  userId: user.id,
  email: user.email,
  username: user.username,
  name: user.name,
  image: user.image,
  firstName: profiles.firstName,
  lastName: profiles.lastName
}
export type MemberUserRow = {
  userId: number
  email: string
  username: string | null
  name: string
  image: string | null
  firstName: string | null
  lastName: string | null
}

/** UserLiteSerializer. Pass `withEmail` for UserAdminLiteSerializer (admins and members only). */
export function toUserLite(row: MemberUserRow, withEmail = false) {
  return {
    id: row.userId,
    first_name: row.firstName ?? row.name.split(' ')[0] ?? '',
    last_name: row.lastName ?? '',
    avatar_url: row.image,
    is_bot: false,
    display_name: row.username ?? row.name,
    ...(withEmail ? { email: row.email } : {})
  }
}

/** Link to the invitation page. The token is only put in e-mail (WorkSpaceMemberInviteSerializer.get_invite_link). */
export function getInviteLinkWorkspaceMemberInvite(invite: { id: number; token: string }, slug: string, baseUrl = '') {
  const query = new URLSearchParams({ invitation_id: String(invite.id), slug, token: invite.token })
  return `${baseUrl.replace(/\/$/, '')}/workspace-invitations/?${query}`
}

const parseJson = (value: unknown) => {
  if (typeof value !== 'string') return value ?? {}
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

export type FavoriteEntityType = 'cycle' | 'issue' | 'module' | 'view' | 'page' | 'project' | 'folder'
/** get_entity_model_and_serializer: entity types that carry resolvable data. */
export function getEntityModelAndSerializer(entityType: string): { table: string | null; lite: boolean } {
  const table = {
    cycle: 'cycles',
    issue: 'issues',
    module: 'modules',
    view: 'issue_views',
    page: 'pages',
    project: 'projects'
  }[entityType]
  return { table: table ?? null, lite: ['cycle', 'module', 'view', 'page', 'project'].includes(entityType) }
}

type EntityRef = { entityType: string; entityIdentifier: number | null; projectId: number | null; workspaceId: number }

/**
 * get_favorite_entities + the lite serializers: the entity of a favorite or recent visit when the user can still
 * see it. Pages and views are owner-only unless public; guests without guest_view_all_features only see their own.
 * Returns null when the entity is gone or hidden.
 */
export async function getFavoriteEntities(
  db: LancityDb,
  userId: number,
  ref: EntityRef,
  shape: 'favorite' | 'recent' = 'favorite'
): Promise<Record<string, unknown> | null> {
  const id = ref.entityIdentifier
  const { workspaceId, projectId } = ref
  if (!id) return null
  const member = (pid: unknown) => sql`exists (select 1 from project_members pm join projects p on p.id = pm.project_id
    where pm.project_id = ${pid} and pm.member_id = ${userId} and pm.is_active = 1 and pm.deleted_at is null
      and p.archived_at is null and p.deleted_at is null)`
  const restricted = (
    pid: unknown
  ) => sql`exists (select 1 from project_members pm join projects p on p.id = pm.project_id
    where pm.project_id = ${pid} and pm.member_id = ${userId} and pm.is_active = 1 and pm.deleted_at is null
      and pm.role = 5 and p.guest_view_all_features = 0)`
  const first = async (query: ReturnType<typeof sql>) => (await db.all<Record<string, unknown>>(query))[0] ?? null
  if (ref.entityType === 'view' && !projectId) {
    const row = await first(sql`select v.id, v.name, v.logo_props, v.project_id from issue_views v
      where v.id = ${id} and v.workspace_id = ${workspaceId} and v.project_id is null and v.deleted_at is null
        and exists (select 1 from workspace_members w where w.workspace_id = v.workspace_id and w.member_id = ${userId} and w.is_active = 1 and w.deleted_at is null)
        and (v.owned_by_id = ${userId} or (v.access = 1 and not exists (select 1 from workspace_members w where w.workspace_id = v.workspace_id and w.member_id = ${userId} and w.is_active = 1 and w.role = 5)))`)
    return row ? { id: row.id, name: row.name, logo_props: parseJson(row.logo_props), project_id: null } : null
  }
  if (!projectId) return null
  const inProject = member(projectId)
  switch (ref.entityType) {
    case 'project': {
      if (projectId !== id) return null
      const row = await first(sql`select p.id, p.name, p.logo_props, p.identifier from projects p
        where p.id = ${id} and p.workspace_id = ${workspaceId} and p.deleted_at is null and ${inProject}`)
      if (!row) return null
      if (shape === 'favorite') return { id: row.id, name: row.name, logo_props: parseJson(row.logo_props) }
      const members = await db.all<{ member_id: number }>(
        sql`select member_id from project_members where project_id = ${id} and is_active = 1 and deleted_at is null`
      )
      return {
        id: row.id,
        name: row.name,
        logo_props: parseJson(row.logo_props),
        project_members: members.map(item => item.member_id),
        identifier: row.identifier
      }
    }
    case 'cycle':
    case 'module': {
      const table = ref.entityType === 'cycle' ? 'cycles' : 'modules'
      const row = await first(sql`select t.id, t.name, t.logo_props, t.project_id
        from ${sql.raw(table)} t where t.id = ${id} and t.project_id = ${projectId} and t.workspace_id = ${workspaceId}
        and t.deleted_at is null and ${inProject}`)
      return row
        ? { id: row.id, name: row.name, logo_props: parseJson(row.logo_props), project_id: row.project_id }
        : null
    }
    case 'view': {
      const row = await first(sql`select v.id, v.name, v.logo_props, v.project_id from issue_views v
        where v.id = ${id} and v.project_id = ${projectId} and v.workspace_id = ${workspaceId} and v.deleted_at is null
        and ${inProject} and (v.owned_by_id = ${userId} or (v.access = 1 and not ${restricted(projectId)}))`)
      return row
        ? { id: row.id, name: row.name, logo_props: parseJson(row.logo_props), project_id: row.project_id }
        : null
    }
    case 'page': {
      const row = await first(sql`select g.id, g.name, g.logo_props, g.owned_by_id, pr.identifier from pages g
        join project_pages pp on pp.page_id = g.id and pp.project_id = ${projectId} and pp.deleted_at is null
        join projects pr on pr.id = pp.project_id
        where g.id = ${id} and g.workspace_id = ${workspaceId} and g.deleted_at is null and ${inProject}
        and (g.owned_by_id = ${userId} or (g.access = 0 and not ${restricted(projectId)}))`)
      if (!row) return null
      const lite = { id: row.id, name: row.name, logo_props: parseJson(row.logo_props), project_id: projectId }
      return shape === 'favorite' ? lite : { ...lite, owned_by: row.owned_by_id, project_identifier: row.identifier }
    }
    case 'issue': {
      if (shape === 'favorite') return null
      const row =
        await first(sql`select i.id, i.name, i.state_id, i.priority, i.type_id, i.sequence_id, i.project_id, pr.identifier
        from issues i join projects pr on pr.id = i.project_id
        where i.id = ${id} and i.project_id = ${projectId} and i.workspace_id = ${workspaceId} and i.deleted_at is null
        and ${inProject} and (i.created_by_id = ${userId} or not ${restricted(projectId)})`)
      if (!row) return null
      const assignees = await db.all<{ assignee_id: number }>(
        sql`select assignee_id from issue_assignees where issue_id = ${id} and deleted_at is null`
      )
      return {
        id: row.id,
        name: row.name,
        state: row.state_id,
        priority: row.priority,
        assignees: assignees.map(item => item.assignee_id),
        type: row.type_id,
        sequence_id: row.sequence_id,
        project_id: row.project_id,
        project_identifier: row.identifier
      }
    }
    default:
      return null
  }
}

/** UserFavoriteSerializer.get_entity_data. */
export const getEntityDataUserFavorite = (db: LancityDb, userId: number, ref: EntityRef) =>
  getFavoriteEntities(db, userId, ref, 'favorite')
/** WorkspaceRecentVisitSerializer.get_entity_data and the issue/project/page recent serializers. */
export const getEntityDataWorkspaceRecentVisit = (db: LancityDb, userId: number, ref: EntityRef) =>
  getFavoriteEntities(db, userId, ref, 'recent')
export const getProjectIdPageFavoriteLite = (projectId: number | null) => projectId
export const getProjectIdentifierIssueRecentVisit = (identifier: string | null) => identifier ?? null
export const getAssigneesIssueRecentVisit = (rows: { assignee_id: number }[]) => rows.map(row => row.assignee_id)
export const getProjectMembersProjectRecentVisit = (rows: { member_id: number }[]) => rows.map(row => row.member_id)
export const getProjectIdPageRecentVisit = getProjectIdPageFavoriteLite
export const getProjectIdentifierPageRecentVisit = getProjectIdentifierIssueRecentVisit

// Model __str__ labels (reference only: logs and display labels).
export const formatUserFavorite = (email: string, entityType: string) => `${email} <${entityType}>`
export const formatUserRecentVisit = (email: string, entityName: string) => `${entityName} ${email}`
export const formatWorkspace = (workspace: { name: string }) => workspace.name
export const formatWorkspaceMember = (workspaceName: string, email: string) => `${email} <${workspaceName}>`
export const formatWorkspaceMemberInvite = (workspaceName: string, email: string, accepted: boolean) =>
  `${workspaceName} ${email} ${accepted ? 'True' : 'False'}`
export const formatTeam = (team: { name: string }, workspaceName: string) => `${team.name} <${workspaceName}>`
export const formatWorkspaceTheme = (theme: { name: string }, actorEmail: string) => `${theme.name}${actorEmail}`
export const formatWorkspaceUserProperties = (workspaceName: string, email: string) => `${workspaceName} ${email}`
export const formatWorkspaceUserLink = (workspaceId: number, url: string) => `${workspaceId} ${url}`
export const formatWorkspaceHomePreference = (workspaceName: string, email: string, key: string) =>
  `${workspaceName} ${email} ${key}`
