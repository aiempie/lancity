import { and, asc, desc, eq, getTableColumns, inArray, isNull, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { user } from '@/db/schema/auth'
import { deployBoards } from '@/db/schema/content'
import { userFavorites } from '@/db/schema/notification'
import {
  projectMemberInvites,
  projectMembers,
  projects,
  workspaces
} from '@/db/schema/workspace'
import type { LancityDb } from '@/types/database/schema'

/** Plane `PROJECT_ORDER_BY_ALLOWLIST` in camelCase column terms. */
const ORDER_COLUMNS = {
  created_at: projects.createdAt,
  updated_at: projects.updatedAt,
  name: projects.name,
  network: projects.network
} as const

/** PD-1915 for projects: `-field` sorts descending. Fields outside the allowlist use the fallback. */
export function projectOrderBy(raw: string | undefined, fallback: string) {
  const parse = (value: string) => ({ field: value.replace(/^-/, ''), descending: value.startsWith('-') })
  const requested = parse(raw?.trim() || fallback)
  return requested.field === 'sort_order' || requested.field in ORDER_COLUMNS ? requested : parse(fallback)
}

/** ORDER BY clauses for a parsed order. `sort_order` is the actor's own project ordering, nulls last as in Postgres. */
export function projectOrderClauses(
  order: { field: string; descending: boolean },
  userId: number,
  source: 'user_property' | 'member' = 'user_property'
) {
  if (order.field === 'sort_order') {
    const expr = source === 'member' ? memberSortOrder(userId) : userSortOrder(userId)
    return [sql`(${expr}) is null`, order.descending ? desc(expr) : asc(expr), asc(projects.name)]
  }
  const column = ORDER_COLUMNS[order.field as keyof typeof ORDER_COLUMNS]
  return [order.descending ? desc(column) : asc(column), asc(projects.id)]
}

/** Fully qualified columns: Drizzle renders bare column names in single-table selects, which would bind to the subquery table. */
const PROJECT_ID = sql.raw('"projects"."id"')
const PROJECT_WORKSPACE_ID = sql.raw('"projects"."workspace_id"')

const memberSortOrder = (userId: number) => sql<number | null>`(select pm.sort_order from project_members pm
  where pm.project_id = ${projects.id} and pm.member_id = ${userId} and pm.is_active = 1 and pm.deleted_at is null)`
const userSortOrder = (userId: number) => sql<number | null>`(select up.sort_order from project_user_properties up
  where up.project_id = ${projects.id} and up.user_id = ${userId} and up.deleted_at is null)`

const activeMember = (userId: number) => sql`exists (select 1 from project_members pm where pm.project_id = ${projects.id}
  and pm.member_id = ${userId} and pm.is_active = 1 and pm.deleted_at is null)`

/** App visibility by workspace role: admins see every project, members public ones plus their own, guests only their own. */
export function visibleToWorkspaceRole(role: number, userId: number): SQL | undefined {
  if (role === 20) return undefined
  if (role === 15) return sql`(${activeMember(userId)} or ${projects.network} = 2)`
  return activeMember(userId)
}

/** Public API visibility (PD-0224, PD-0229, PD-0232): own projects, or public ones for non-guests. */
export function visibleToApi(role: number, userId: number): SQL {
  return role > 5 ? sql`(${activeMember(userId)} or ${projects.network} = 2)` : activeMember(userId)
}

/** Annotation columns of Plane's app `ProjectViewSet.get_queryset` (is_favorite, member_role, anchor, sort_order). */
function detailColumns(userId: number) {
  return {
    ...getTableColumns(projects),
    isFavorite: sql<boolean>`exists (select 1 from user_favorites f where f.user_id = ${userId} and f.entity_type = 'project'
      and f.entity_identifier = ${PROJECT_ID} and f.project_id = ${PROJECT_ID} and f.deleted_at is null)`.mapWith(Boolean),
    memberRole: sql<number | null>`(select pm.role from project_members pm where pm.project_id = ${PROJECT_ID}
      and pm.member_id = ${userId} and pm.is_active = 1 and pm.deleted_at is null)`,
    anchor: sql<string | null>`(select d.anchor from deploy_boards d where d.entity_name = 'project'
      and d.entity_identifier = ${PROJECT_ID} and d.workspace_id = ${PROJECT_WORKSPACE_ID} and d.deleted_at is null limit 1)`,
    sortOrder: userSortOrder(userId),
    intakeCount: sql<number>`(select count(*) from intake_issues ii where ii.project_id = ${PROJECT_ID} and ii.status = -2 and ii.deleted_at is null)`,
    nextWorkItemSequence: sql<number>`coalesce((select max(s.sequence) from issue_sequences s where s.project_id = ${PROJECT_ID}), 0) + 1`
  }
}

/** Annotation columns of the public API querysets (counts, is_member, is_deployed). */
function apiColumns(userId: number) {
  return {
    ...getTableColumns(projects),
    isMember: sql<boolean>`${activeMember(userId)}`.mapWith(Boolean),
    totalMembers: sql<number>`(select count(*) from project_members pm where pm.project_id = ${PROJECT_ID}
      and pm.is_active = 1 and pm.deleted_at is null
      and not exists (select 1 from user_security s where s.user_id = pm.member_id and s.is_bot = 1))`,
    totalCycles: sql<number>`(select count(*) from cycles c where c.project_id = ${PROJECT_ID} and c.deleted_at is null)`,
    totalModules: sql<number>`(select count(*) from modules m where m.project_id = ${PROJECT_ID} and m.deleted_at is null)`,
    memberRole: sql<number | null>`(select pm.role from project_members pm where pm.project_id = ${PROJECT_ID}
      and pm.member_id = ${userId} and pm.is_active = 1 and pm.deleted_at is null)`,
    sortOrder: memberSortOrder(userId),
    isDeployed: sql<boolean>`exists (select 1 from deploy_boards d where d.project_id = ${PROJECT_ID}
      and d.workspace_id = ${PROJECT_WORKSPACE_ID} and d.deleted_at is null)`.mapWith(Boolean)
  }
}

const notDeleted = isNull(projects.deletedAt)

/** PD-0734 `ProjectViewSet.get_queryset`: projects of the workspace with the actor's annotations. */
export function queryProject(db: LancityDb, userId: number, workspaceId: number, ...filters: (SQL | undefined)[]) {
  return db
    .select(detailColumns(userId))
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), notDeleted, ...filters))
}

/** Active, non-deleted member user ids of the given projects. */
export async function projectMemberIds(db: LancityDb, workspaceId: number, projectIds: number[]) {
  const map = new Map<number, number[]>()
  if (!projectIds.length) return map
  const rows = await db
    .select({ projectId: projectMembers.projectId, memberId: projectMembers.memberId })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.workspaceId, workspaceId),
        inArray(projectMembers.projectId, projectIds),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt)
      )
    )
  for (const row of rows) if (row.memberId !== null) map.set(row.projectId, [...(map.get(row.projectId) ?? []), row.memberId])
  return map
}

/** PD-0748 `ProjectFavoritesViewSet.get_queryset`: the actor's project favorites in the workspace. */
export function queryProjectFavorites(db: LancityDb, userId: number, workspaceId: number) {
  return db
    .select({
      id: userFavorites.id,
      project: userFavorites.projectId,
      entityType: userFavorites.entityType,
      entityIdentifier: userFavorites.entityIdentifier,
      workspaceId: userFavorites.workspaceId,
      createdAt: userFavorites.createdAt
    })
    .from(userFavorites)
    .innerJoin(projects, eq(projects.id, userFavorites.projectId))
    .where(
      and(
        eq(userFavorites.workspaceId, workspaceId),
        eq(userFavorites.userId, userId),
        eq(userFavorites.entityType, 'project'),
        isNull(userFavorites.deletedAt),
        notDeleted
      )
    )
    .orderBy(asc(userFavorites.sequence), asc(userFavorites.id))
}

/** PD-0753 `DeployBoardViewSet.get_queryset`: boards of one project, scoped by workspace and project. */
export function queryDeployBoard(db: LancityDb, workspaceId: number, projectId: number) {
  return db
    .select()
    .from(deployBoards)
    .where(
      and(
        eq(deployBoards.workspaceId, workspaceId),
        eq(deployBoards.entityName, 'project'),
        eq(deployBoards.entityIdentifier, projectId),
        eq(deployBoards.projectId, projectId),
        isNull(deployBoards.deletedAt)
      )
    )
}

const inviteColumns = {
  id: projectMemberInvites.id,
  email: projectMemberInvites.email,
  role: projectMemberInvites.role,
  accepted: projectMemberInvites.accepted,
  message: projectMemberInvites.message,
  respondedAt: projectMemberInvites.respondedAt,
  projectId: projectMemberInvites.projectId,
  workspaceId: projectMemberInvites.workspaceId,
  createdAt: projectMemberInvites.createdAt
}

/** PD-0758 `ProjectInvitationsViewset.get_queryset`. The token is never selected. */
export function queryProjectInvitations(db: LancityDb, workspaceId: number, projectId: number) {
  return db
    .select(inviteColumns)
    .from(projectMemberInvites)
    .where(
      and(
        eq(projectMemberInvites.workspaceId, workspaceId),
        eq(projectMemberInvites.projectId, projectId),
        isNull(projectMemberInvites.deletedAt)
      )
    )
    .orderBy(desc(projectMemberInvites.createdAt))
}

/** PD-0764 `UserProjectInvitationsViewset.get_queryset`: invitations addressed to the actor's email. */
export function queryUserProjectInvitations(db: LancityDb, email: string, workspaceId?: number) {
  return db
    .select({ ...inviteColumns, projectName: projects.name, workspaceSlug: workspaces.slug })
    .from(projectMemberInvites)
    .innerJoin(projects, eq(projects.id, projectMemberInvites.projectId))
    .innerJoin(workspaces, eq(workspaces.id, projectMemberInvites.workspaceId))
    .where(
      and(
        sql`lower(${projectMemberInvites.email}) = ${email.toLowerCase()}`,
        workspaceId === undefined ? undefined : eq(projectMemberInvites.workspaceId, workspaceId),
        isNull(projectMemberInvites.deletedAt),
        isNull(projects.deletedAt)
      )
    )
}

/** Plane filters `member__is_bot=False` on member lists and counts. */
export const notBot = (memberId: SQLWrapper) =>
  sql`not exists (select 1 from user_security s where s.user_id = ${memberId} and s.is_bot = 1)`

/** PD-0769 `ProjectMemberViewSet.get_queryset`: members of one project with their user data. */
export function queryProjectMember(db: LancityDb, workspaceId: number, projectId: number, ...filters: (SQL | undefined)[]) {
  return db
    .select({
      id: projectMembers.id,
      memberId: projectMembers.memberId,
      role: projectMembers.role,
      comment: projectMembers.comment,
      isActive: projectMembers.isActive,
      sortOrder: projectMembers.sortOrder,
      viewProps: projectMembers.viewProps,
      defaultProps: projectMembers.defaultProps,
      preferences: projectMembers.preferences,
      createdAt: projectMembers.createdAt,
      workspaceId: projectMembers.workspaceId,
      projectId: projectMembers.projectId,
      name: user.name,
      email: user.email,
      image: user.image
    })
    .from(projectMembers)
    .innerJoin(user, eq(user.id, projectMembers.memberId))
    .where(
      and(
        eq(projectMembers.workspaceId, workspaceId),
        eq(projectMembers.projectId, projectId),
        isNull(projectMembers.deletedAt),
        notBot(projectMembers.memberId),
        ...filters
      )
    )
    .orderBy(desc(projectMembers.createdAt), desc(projectMembers.id))
}

/** PD-0778 `ProjectMemberPreferenceEndpoint.get_queryset`. */
export function queryProjectMemberPreference(db: LancityDb, workspaceId: number, projectId: number, memberId: number) {
  return db
    .select({ id: projectMembers.id, preferences: projectMembers.preferences, projectId: projectMembers.projectId, memberId: projectMembers.memberId, workspaceId: projectMembers.workspaceId })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.workspaceId, workspaceId),
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.memberId, memberId),
        isNull(projectMembers.deletedAt)
      )
    )
}

/** PD-0224 `ProjectListCreateAPIEndpoint.get_queryset`. */
export function queryProjectListCreateAPI(
  db: LancityDb,
  userId: number,
  workspaceId: number,
  workspaceRole: number,
  ...filters: (SQL | undefined)[]
) {
  return db
    .select(apiColumns(userId))
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), notDeleted, visibleToApi(workspaceRole, userId), ...filters))
}

/** PD-0229 `ProjectListLiteAPIEndpoint.get_queryset`. */
export function queryProjectListLiteAPI(
  db: LancityDb,
  userId: number,
  workspaceId: number,
  workspaceRole: number,
  ...filters: (SQL | undefined)[]
) {
  return db
    .select({
      id: projects.id,
      identifier: projects.identifier,
      name: projects.name,
      coverImage: projects.coverImage,
      coverImageAssetId: projects.coverImageAssetId,
      logoProps: projects.logoProps,
      description: projects.description,
      archivedAt: projects.archivedAt
    })
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), notDeleted, visibleToApi(workspaceRole, userId), ...filters))
}

/** PD-0232 `ProjectDetailAPIEndpoint.get_queryset`. */
export function queryProjectDetailAPI(
  db: LancityDb,
  userId: number,
  workspaceId: number,
  workspaceRole: number,
  ...filters: (SQL | undefined)[]
) {
  return queryProjectListCreateAPI(db, userId, workspaceId, workspaceRole, ...filters)
}
