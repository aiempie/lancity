import { and, eq, isNull, ne, or, sql } from 'drizzle-orm'
import { deployBoards } from '@/db/schema/content'
import { states } from '@/db/schema/issue'
import { userFavorites } from '@/db/schema/notification'
import { estimates, intakes } from '@/db/schema/planning'
import {
  projectIdentifiers,
  projectMembers,
  projects,
  workspaceMembers
} from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import { emitProjectEvent, MODEL_ACTIVITY_JOB, WEBHOOK_ACTIVITY_JOB } from '@/server/project/events'
import {
  DEFAULT_STATES,
  defaultLogoProps,
  getAnchor,
  initProject,
  isValidTimezone,
  memberDefaults,
  retimeIntakeSnoozesProject,
  saveProject,
  userPropertyInsert
} from '@/server/project/model-rules'
import {
  forbidden,
  hasPermissionProjectAdminPermission,
  hasPermissionProjectArchiveUnarchivePermission,
  hasPermissionProjectBasePermission,
  hasPermissionProjectMemberPermission,
  loadProjectScope
} from '@/server/project/permissions'
import { pickFields, presentProject } from '@/server/project/presenters'
import {
  projectMemberIds,
  projectOrderBy,
  projectOrderClauses,
  queryDeployBoard,
  queryProject,
  queryProjectFavorites,
  visibleToWorkspaceRole
} from '@/server/project/queries'
import { pageEnvelope, pageWindow } from '@/server/workspace/pagination'
import { getWorkspace } from '@/server/workspace/service'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import {
  projectSummaryFields,
  type CreateDeployBoardInput,
  type CreateProjectInput,
  type ProjectUserViewsInput,
  type UpdateDeployBoardInput,
  type UpdateProjectInput
} from '@/types/project/schema'

export type ProjectListOptions = {
  includeArchived?: boolean
  cursor?: string
  perPage?: number
  orderBy?: string
  fields?: string
}
/** `app` follows Plane's web views (a workspace admin may edit without joining). `api` follows the public API permission classes. */
export type ProjectAccessMode = 'app' | 'api'

async function activeWorkspaceMember(db: LancityDb, workspaceId: number, userId: number) {
  const [row] = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.memberId, userId),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt)
      )
    )
  return Boolean(row)
}

/** `project_lead` and `default_assignee` must be active workspace members (PD-0040, PD-0043, PD-0355). */
async function assertProjectUsers(
  db: LancityDb,
  workspaceId: number,
  input: { projectLeadId?: number | null; defaultAssigneeId?: number | null },
  current?: { projectLeadId: number | null; defaultAssigneeId: number | null }
) {
  for (const [field, key] of [
    ['project_lead', 'projectLeadId'],
    ['default_assignee', 'defaultAssigneeId']
  ] as const) {
    const userId = input[key]
    if (!userId || current?.[key] === userId) continue
    if (!(await activeWorkspaceMember(db, workspaceId, userId)))
      throw new ServiceError(400, 'INVALID_PROJECT_USER', `The ${field} must be a member of this workspace`, { field })
  }
}

async function loadDetail(db: LancityDb, actor: Actor, workspace: { id: number; slug: string }, projectId: number) {
  const [row] = await queryProject(db, actor.userId, workspace.id, eq(projects.id, projectId))
  if (!row) throw new ServiceError(404, 'PROJECT_NOT_FOUND', 'Project not found')
  const members = await projectMemberIds(db, workspace.id, [projectId])
  return presentProject(row, workspace.slug, members.get(projectId))
}

/** PD-0737 `ProjectViewSet.list`: the projects visible to the actor, archived ones only on request. */
export async function listProjects(db: LancityDb, actor: Actor, slug: string, options: ProjectListOptions = {}) {
  const { workspace, membership } = await getWorkspace(db, actor, slug)
  const rows = await queryProject(
    db,
    actor.userId,
    workspace.id,
    options.includeArchived ? undefined : isNull(projects.archivedAt),
    visibleToWorkspaceRole(membership.role, actor.userId)
  ).orderBy(projects.name)
  return rows.map(row => ({ ...row, inboxView: row.intakeView }))
}

/** PD-0735 `ProjectViewSet.list_detail` with its `fields` filter and optional cursor pagination. */
export async function listDetailProject(db: LancityDb, actor: Actor, slug: string, options: ProjectListOptions = {}) {
  const { workspace, membership } = await getWorkspace(db, actor, slug)
  const fields = (options.fields ?? '').split(',').filter(Boolean)
  const paged = Boolean(options.perPage && options.cursor)
  const order = projectOrderBy(paged ? options.orderBy : undefined, paged ? '-created_at' : 'sort_order')
  const win = paged ? pageWindow(options.cursor, options.perPage!, 100) : undefined
  const query = queryProject(
    db,
    actor.userId,
    workspace.id,
    options.includeArchived === false ? isNull(projects.archivedAt) : undefined,
    visibleToWorkspaceRole(membership.role, actor.userId)
  ).orderBy(...projectOrderClauses(order, actor.userId))
  const rows = win ? await query.limit(win.limit + 1).offset(win.offset) : await query
  const visible = win ? rows.slice(0, win.limit) : rows
  const members = await projectMemberIds(db, workspace.id, visible.map(row => row.id))
  const results = visible.map(row => pickFields(presentProject(row, slug, members.get(row.id)), fields))
  if (!win) return results
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, workspace.id),
        isNull(projects.deletedAt),
        options.includeArchived === false ? isNull(projects.archivedAt) : undefined,
        visibleToWorkspaceRole(membership.role, actor.userId)
      )
    )
  return pageEnvelope(results, total, win)
}

/**
 * PD-0738 `ProjectViewSet.retrieve`. A non-member gets 403 for a secret project and 409 for a public one,
 * so the client can offer to join. Archived projects are not found.
 */
export async function getProject(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { workspace } = await getWorkspace(db, actor, slug)
  const [row] = await queryProject(db, actor.userId, workspace.id, eq(projects.id, projectId), isNull(projects.archivedAt))
  if (!row) throw new ServiceError(404, 'PROJECT_NOT_FOUND', 'Project does not exist')
  if (row.memberRole === null) {
    if (row.network === 0) throw new ServiceError(403, 'FORBIDDEN', 'You do not have permission')
    throw new ServiceError(409, 'NOT_PROJECT_MEMBER', 'You are not a member of this project')
  }
  const members = await projectMemberIds(db, workspace.id, [projectId])
  return presentProject(row, slug, members.get(projectId))
}

/** Duplicate name or identifier. Used after a failed write to turn a constraint error into 409. */
async function throwIfDuplicate(
  db: LancityDb,
  workspaceId: number,
  input: { name?: string; identifier?: string },
  excludeProjectId?: number
) {
  const conflicts = [
    ...(input.identifier ? [eq(projects.identifier, input.identifier)] : []),
    ...(input.name ? [eq(projects.name, input.name)] : [])
  ]
  const [duplicate] = conflicts.length
    ? await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.workspaceId, workspaceId),
            excludeProjectId ? ne(projects.id, excludeProjectId) : undefined,
            isNull(projects.deletedAt),
            or(...conflicts)
          )
        )
    : []
  const [reserved] = input.identifier
    ? await db
        .select({ id: projectIdentifiers.id })
        .from(projectIdentifiers)
        .where(
          and(
            eq(projectIdentifiers.workspaceId, workspaceId),
            eq(projectIdentifiers.name, input.identifier),
            excludeProjectId ? ne(projectIdentifiers.projectId, excludeProjectId) : undefined,
            isNull(projectIdentifiers.deletedAt)
          )
        )
    : []
  if (duplicate || reserved) throw new ServiceError(409, 'PROJECT_EXISTS', 'Project name or identifier already exists')
}

/**
 * PD-0739 `ProjectViewSet.create`, PD-0356 and PD-0041/PD-0044 serializer `create`: the project, its identifier, the creator
 * (and a distinct project lead) as admins with their user properties, and the default states, in one batch.
 */
export async function createProject(db: LancityDb, actor: Actor, slug: string, input: CreateProjectInput) {
  const { workspace, membership } = await getWorkspace(db, actor, slug)
  if (membership.role < 15) throw new ServiceError(403, 'FORBIDDEN', 'Insufficient workspace permissions')
  await assertProjectUsers(db, workspace.id, input)
  if (input.timezone && !isValidTimezone(input.timezone))
    throw new ServiceError(400, 'INVALID_TIMEZONE', 'Unknown timezone', { field: 'timezone' })
  const values = saveProject({
    ...input,
    timezone: initProject(input.timezone, workspace.timezone),
    logoProps: input.logoProps ?? defaultLogoProps()
  })
  const projectId = sql`(select id from projects where workspace_id = ${workspace.id} and identifier = ${input.identifier} and deleted_at is null)`
  const lead = input.projectLeadId && input.projectLeadId !== actor.userId ? input.projectLeadId : null
  let created: { id: number }
  try {
    const result = await db.batch([
      db
        .insert(projects)
        .values({ ...values, workspaceId: workspace.id, createdById: actor.userId, updatedById: actor.userId })
        .returning({ id: projects.id }),
      db
        .insert(projectIdentifiers)
        .values({ name: input.identifier, projectId, workspaceId: workspace.id, createdById: actor.userId }),
      db
        .insert(projectMembers)
        .values({
          projectId,
          workspaceId: workspace.id,
          memberId: actor.userId,
          role: 20,
          ...memberDefaults(),
          createdById: actor.userId
        }),
      userPropertyInsert(db, { projectId, userId: actor.userId, actorId: actor.userId }),
      ...(lead
        ? [
            db
              .insert(projectMembers)
              .values({
                projectId,
                workspaceId: workspace.id,
                memberId: lead,
                role: 20,
                ...memberDefaults(),
                createdById: actor.userId
              })
              .onConflictDoNothing(),
            userPropertyInsert(db, { projectId, userId: lead, actorId: actor.userId })
          ]
        : []),
      ...DEFAULT_STATES.map(state =>
        db.insert(states).values({
          name: state.name,
          color: state.color,
          sequence: state.sequence,
          group: state.group,
          default: state.default,
          isTriage: state.group === 'triage',
          slug: state.name.toLowerCase().replaceAll(' ', '-'),
          projectId,
          workspaceId: workspace.id,
          createdById: actor.userId
        })
      )
    ] as unknown as Parameters<typeof db.batch>[0])
    created = (result[0] as unknown as { id: number }[])[0]
  } catch (error) {
    await throwIfDuplicate(db, workspace.id, input)
    throw error
  }
  await emitProjectEvent(MODEL_ACTIVITY_JOB, {
    model_name: 'project',
    model_id: created.id,
    requested_data: input,
    current_instance: null,
    actor_id: actor.userId,
    slug
  })
  return loadDetail(db, actor, workspace, created.id)
}

/**
 * PD-0740 `ProjectViewSet.partial_update`, PD-0733 (PUT), PD-0234 and PD-0042/PD-0043: update a project.
 * The default state and the estimate must belong to the project, archived projects are read-only and an enabled
 * intake view gets its default intake.
 */
export async function updateProject(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  input: UpdateProjectInput,
  mode: ProjectAccessMode = 'app'
) {
  const { workspace, project, access } = await loadProjectScope(db, actor, slug, projectId)
  forbidden(
    mode === 'api'
      ? hasPermissionProjectBasePermission(access, 'write')
      : access.projectRole === 20 || access.workspaceRole === 20,
    "You don't have the required permissions."
  )
  if (project.archivedAt) throw new ServiceError(400, 'PROJECT_ARCHIVED', 'Archived projects cannot be updated')
  await assertProjectUsers(db, workspace.id, input, project)
  if (input.timezone && !isValidTimezone(input.timezone))
    throw new ServiceError(400, 'INVALID_TIMEZONE', 'Unknown timezone', { field: 'timezone' })
  if (input.defaultStateId) {
    const [state] = await db
      .select({ id: states.id })
      .from(states)
      .where(and(eq(states.id, input.defaultStateId), eq(states.projectId, projectId), isNull(states.deletedAt)))
    if (!state) throw new ServiceError(400, 'INVALID_DEFAULT_STATE', 'Default state should be a state in the project')
  }
  if (input.estimateId) {
    const [estimate] = await db
      .select({ id: estimates.id })
      .from(estimates)
      .where(and(eq(estimates.id, input.estimateId), eq(estimates.projectId, projectId), isNull(estimates.deletedAt)))
    if (!estimate) throw new ServiceError(400, 'INVALID_ESTIMATE', 'Estimate should be an estimate in the project')
  }
  const values = saveProject(input)
  const retime =
    input.timezone && input.timezone !== project.timezone
      ? await retimeIntakeSnoozesProject(db, projectId, project.timezone, input.timezone)
      : []
  const intakeView = input.intakeView ?? project.intakeView
  const defaultIntake = intakeView
    ? [
        db.run(sql`insert into intakes (name, project_id, workspace_id, is_default, created_by_id, updated_by_id)
          select ${`${input.name ?? project.name} Intake`}, p.id, p.workspace_id, 1, ${actor.userId}, ${actor.userId}
          from projects p where p.id = ${projectId}
            and not exists (select 1 from intakes i where i.project_id = p.id and i.is_default = 1 and i.deleted_at is null)
          on conflict do nothing`)
      ]
    : []
  try {
    await db.batch([
      db
        .update(projects)
        .set({ ...values, updatedById: actor.userId })
        .where(eq(projects.id, projectId))
        .returning({ id: projects.id }),
      db
        .update(projectIdentifiers)
        .set({ ...(values.identifier ? { name: values.identifier } : {}), updatedById: actor.userId })
        .where(and(eq(projectIdentifiers.projectId, projectId), isNull(projectIdentifiers.deletedAt))),
      ...defaultIntake,
      ...retime
    ] as unknown as Parameters<typeof db.batch>[0])
  } catch (error) {
    await throwIfDuplicate(db, workspace.id, input, projectId)
    throw error
  }
  await emitProjectEvent(MODEL_ACTIVITY_JOB, {
    model_name: 'project',
    model_id: projectId,
    requested_data: input,
    current_instance: project,
    actor_id: actor.userId,
    slug
  })
  return loadDetail(db, actor, workspace, projectId)
}

/** PD-0741 `ProjectViewSet.destroy`, PD-0235: soft delete with its identifier, deploy boards and favorites. */
export async function deleteProject(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  mode: ProjectAccessMode = 'app'
) {
  const { workspace, access } = await loadProjectScope(db, actor, slug, projectId)
  forbidden(
    mode === 'api'
      ? hasPermissionProjectBasePermission(access, 'write')
      : access.projectRole === 20 || access.workspaceRole === 20,
    "You don't have the required permissions."
  )
  const now = new Date()
  await db.batch([
    db.update(projects).set({ deletedAt: now, updatedById: actor.userId }).where(eq(projects.id, projectId)),
    db
      .update(projectIdentifiers)
      .set({ deletedAt: now, updatedById: actor.userId })
      .where(eq(projectIdentifiers.projectId, projectId)),
    db
      .update(deployBoards)
      .set({ deletedAt: now, updatedById: actor.userId })
      .where(and(eq(deployBoards.projectId, projectId), isNull(deployBoards.deletedAt))),
    db.delete(userFavorites).where(and(eq(userFavorites.projectId, projectId), eq(userFavorites.workspaceId, workspace.id)))
  ])
  await emitProjectEvent(WEBHOOK_ACTIVITY_JOB, {
    event: 'project',
    verb: 'deleted',
    field: null,
    old_value: null,
    new_value: null,
    actor_id: actor.userId,
    slug,
    event_id: projectId,
    old_identifier: null,
    new_identifier: null
  })
}

/** PD-0742 `ProjectArchiveUnarchiveEndpoint.post`, PD-0236: archive and drop the project from everyone's favorites. */
export async function createProjectArchiveUnarchive(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { workspace, access } = await loadProjectScope(db, actor, slug, projectId)
  forbidden(hasPermissionProjectArchiveUnarchivePermission(access))
  const archivedAt = new Date()
  await db.batch([
    db.update(projects).set({ archivedAt, updatedById: actor.userId }).where(eq(projects.id, projectId)),
    db.delete(userFavorites).where(and(eq(userFavorites.projectId, projectId), eq(userFavorites.workspaceId, workspace.id)))
  ])
  return { archivedAt }
}

/** PD-0743 `ProjectArchiveUnarchiveEndpoint.delete`, PD-0237. */
export async function deleteProjectArchiveUnarchive(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { access } = await loadProjectScope(db, actor, slug, projectId)
  forbidden(hasPermissionProjectArchiveUnarchivePermission(access))
  await db.update(projects).set({ archivedAt: null, updatedById: actor.userId }).where(eq(projects.id, projectId))
}

/** PD-0744 `ProjectIdentifierEndpoint.get`: does the identifier exist in the workspace. */
export async function getProjectIdentifier(db: LancityDb, actor: Actor, slug: string, rawName: string) {
  const { workspace, membership } = await getWorkspace(db, actor, slug)
  forbidden(membership.role >= 15, 'Insufficient workspace permissions')
  const name = rawName.trim().toUpperCase()
  if (!name) throw new ServiceError(400, 'NAME_REQUIRED', 'Name is required')
  const identifiers = await db
    .select({ id: projectIdentifiers.id, name: projectIdentifiers.name, project: projectIdentifiers.projectId })
    .from(projectIdentifiers)
    .where(
      and(
        eq(projectIdentifiers.workspaceId, workspace.id),
        eq(projectIdentifiers.name, name),
        isNull(projectIdentifiers.deletedAt)
      )
    )
  return { exists: identifiers.length, identifiers }
}

/** PD-0745 `ProjectIdentifierEndpoint.delete`: free an identifier that no project uses any more. */
export async function deleteProjectIdentifier(db: LancityDb, actor: Actor, slug: string, rawName: string) {
  const { workspace, membership } = await getWorkspace(db, actor, slug)
  forbidden(membership.role >= 15, 'Insufficient workspace permissions')
  const name = rawName.trim().toUpperCase()
  if (!name) throw new ServiceError(400, 'NAME_REQUIRED', 'Name is required')
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.workspaceId, workspace.id), eq(projects.identifier, name), isNull(projects.deletedAt)))
  if (project)
    throw new ServiceError(400, 'IDENTIFIER_IN_USE', 'Cannot delete an identifier of an existing project')
  await db
    .update(projectIdentifiers)
    .set({ deletedAt: new Date(), updatedById: actor.userId })
    .where(
      and(
        eq(projectIdentifiers.workspaceId, workspace.id),
        eq(projectIdentifiers.name, name),
        isNull(projectIdentifiers.deletedAt)
      )
    )
}

/** PD-0746 `ProjectUserViewsEndpoint.post`: a member stores their own view props, default props, preferences and order. */
export async function createProjectUserViews(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  input: ProjectUserViewsInput
) {
  const { access } = await loadProjectScope(db, actor, slug, projectId)
  forbidden(access.projectRole !== null, 'Forbidden')
  await db
    .update(projectMembers)
    .set({
      ...(input.viewProps ? { viewProps: input.viewProps } : {}),
      ...(input.defaultProps ? { defaultProps: input.defaultProps } : {}),
      ...(input.preferences ? { preferences: input.preferences } : {}),
      ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
      updatedById: actor.userId
    })
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.memberId, actor.userId),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt)
      )
    )
}

/** PD-0747 `ProjectFavoritesViewSet.list`. */
export async function listProjectFavorites(db: LancityDb, actor: Actor, slug: string) {
  const { workspace } = await getWorkspace(db, actor, slug)
  return queryProjectFavorites(db, actor.userId, workspace.id)
}

/**
 * PD-0750 `ProjectFavoritesViewSet.create` and PD-0749 `perform_create`: favorite a project the actor belongs to.
 * Repeating the call keeps the existing favorite.
 */
export async function createProjectFavorites(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { workspace, access } = await loadProjectScope(db, actor, slug, projectId)
  if (access.projectRole === null) throw new ServiceError(404, 'PROJECT_NOT_FOUND', 'Project not found')
  await db
    .insert(userFavorites)
    .values({
      userId: actor.userId,
      entityType: 'project',
      entityIdentifier: projectId,
      projectId,
      workspaceId: workspace.id,
      createdById: actor.userId,
      updatedById: actor.userId
    })
    .onConflictDoNothing()
}

/** PD-0751 `ProjectFavoritesViewSet.destroy`: a hard delete, as `delete(soft=False)` in Plane. */
export async function deleteProjectFavorites(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { workspace } = await getWorkspace(db, actor, slug)
  const deleted = await db
    .delete(userFavorites)
    .where(
      and(
        eq(userFavorites.workspaceId, workspace.id),
        eq(userFavorites.userId, actor.userId),
        eq(userFavorites.entityType, 'project'),
        eq(userFavorites.entityIdentifier, projectId),
        eq(userFavorites.projectId, projectId)
      )
    )
    .returning({ id: userFavorites.id })
  if (!deleted.length) throw new ServiceError(404, 'FAVORITE_NOT_FOUND', 'Favorite not found')
}

/** PD-0754 `DeployBoardViewSet.list`: the project's board, or `null` when it is not published. */
export async function listDeployBoards(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { workspace, access } = await loadProjectScope(db, actor, slug, projectId)
  forbidden(hasPermissionProjectMemberPermission(access, 'read'))
  const [board] = await queryDeployBoard(db, workspace.id, projectId)
  return board ?? null
}

/** PD-0752 `DeployBoardViewSet.retrieve`. */
export async function getDeployBoard(db: LancityDb, actor: Actor, slug: string, projectId: number, boardId: number) {
  const { workspace, access } = await loadProjectScope(db, actor, slug, projectId)
  forbidden(hasPermissionProjectMemberPermission(access, 'read'))
  const [board] = await queryDeployBoard(db, workspace.id, projectId).limit(1)
  if (!board || board.id !== boardId) throw new ServiceError(404, 'DEPLOY_BOARD_NOT_FOUND', 'Deploy board not found')
  return board
}

/** PD-0360 `DeployBoardSerializer.validate_intake`: a board can only publish an intake of its own project. */
async function assertBoardIntake(db: LancityDb, projectId: number, intakeId: number | null | undefined) {
  if (!intakeId) return
  const [intake] = await db
    .select({ id: intakes.id })
    .from(intakes)
    .where(and(eq(intakes.id, intakeId), eq(intakes.projectId, projectId), isNull(intakes.deletedAt)))
  if (!intake) throw new ServiceError(400, 'INVALID_INTAKE', 'Intake is not valid please pass a valid intake')
}

/** PD-0755 `DeployBoardViewSet.create`: publish the project (project admins only). Repeating the call updates the board. */
export async function createDeployBoard(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  input: CreateDeployBoardInput
) {
  const { workspace, access } = await loadProjectScope(db, actor, slug, projectId)
  forbidden(hasPermissionProjectAdminPermission(access))
  await assertBoardIntake(db, projectId, input.intakeId)
  const values = {
    intakeId: input.intakeId,
    viewProps: input.views,
    isVotesEnabled: input.isVotesEnabled,
    isCommentsEnabled: input.isCommentsEnabled,
    isReactionsEnabled: input.isReactionsEnabled,
    updatedById: actor.userId
  }
  const [board] = await db
    .insert(deployBoards)
    .values({
      ...values,
      anchor: getAnchor(),
      entityName: 'project',
      entityIdentifier: projectId,
      projectId,
      workspaceId: workspace.id,
      createdById: actor.userId
    })
    .onConflictDoUpdate({
      target: [deployBoards.entityName, deployBoards.entityIdentifier],
      targetWhere: isNull(deployBoards.deletedAt),
      set: values
    })
    .returning()
  return board
}

/** PD-0756 `DeployBoardViewSet.partial_update`. */
export async function updateDeployBoard(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  boardId: number,
  input: UpdateDeployBoardInput
) {
  const { workspace, access } = await loadProjectScope(db, actor, slug, projectId)
  forbidden(hasPermissionProjectAdminPermission(access))
  await assertBoardIntake(db, projectId, input.intakeId)
  const [board] = await db
    .update(deployBoards)
    .set({
      ...(input.isCommentsEnabled === undefined ? {} : { isCommentsEnabled: input.isCommentsEnabled }),
      ...(input.isReactionsEnabled === undefined ? {} : { isReactionsEnabled: input.isReactionsEnabled }),
      ...(input.isVotesEnabled === undefined ? {} : { isVotesEnabled: input.isVotesEnabled }),
      ...(input.isActivityEnabled === undefined ? {} : { isActivityEnabled: input.isActivityEnabled }),
      ...(input.intakeId === undefined ? {} : { intakeId: input.intakeId }),
      ...(input.views ? { viewProps: input.views } : {}),
      updatedById: actor.userId
    })
    .where(
      and(
        eq(deployBoards.id, boardId),
        eq(deployBoards.workspaceId, workspace.id),
        eq(deployBoards.entityName, 'project'),
        eq(deployBoards.entityIdentifier, projectId),
        eq(deployBoards.projectId, projectId),
        isNull(deployBoards.deletedAt)
      )
    )
    .returning()
  if (!board) throw new ServiceError(404, 'DEPLOY_BOARD_NOT_FOUND', 'Deploy board not found')
  return board
}

/** PD-0757 `DeployBoardViewSet.destroy`: unpublish. */
export async function deleteDeployBoard(db: LancityDb, actor: Actor, slug: string, projectId: number, boardId: number) {
  const { workspace, access } = await loadProjectScope(db, actor, slug, projectId)
  forbidden(hasPermissionProjectAdminPermission(access))
  const [board] = await db
    .update(deployBoards)
    .set({ deletedAt: new Date(), updatedById: actor.userId })
    .where(
      and(
        eq(deployBoards.id, boardId),
        eq(deployBoards.workspaceId, workspace.id),
        eq(deployBoards.entityName, 'project'),
        eq(deployBoards.entityIdentifier, projectId),
        isNull(deployBoards.deletedAt)
      )
    )
    .returning({ id: deployBoards.id })
  if (!board) throw new ServiceError(404, 'DEPLOY_BOARD_NOT_FOUND', 'Deploy board not found')
}

/**
 * PD-0238 `ProjectSummaryAPIEndpoint.get` with PD-0239..PD-0248 counts. Workspace admins only. Counts are scoped to
 * non-deleted rows; work items also skip triage, archived and draft items, as Plane's `Issue.objects` does.
 */
export async function getProjectSummary(db: LancityDb, actor: Actor, slug: string, projectId: number, rawFields?: string) {
  const { project, access } = await loadProjectScope(db, actor, slug, projectId)
  forbidden(access.workspaceRole === 20, 'Insufficient workspace permissions')
  const wanted = new Set(
    (rawFields ?? '')
      .split(',')
      .map(field => field.trim())
      .filter(field => (projectSummaryFields as readonly string[]).includes(field))
  )
  const fields = wanted.size ? [...wanted] : [...projectSummaryFields]
  const counters: Record<(typeof projectSummaryFields)[number], string> = {
    members:
      'select count(*) from project_members where project_id = ? and is_active = 1 and deleted_at is null and not exists (select 1 from user_security s where s.user_id = project_members.member_id and s.is_bot = 1)',
    states: 'select count(*) from states where project_id = ? and deleted_at is null',
    labels: 'select count(*) from labels where project_id = ? and deleted_at is null',
    cycles: 'select count(*) from cycles where project_id = ? and deleted_at is null',
    modules: 'select count(*) from modules where project_id = ? and deleted_at is null',
    issues: `select count(*) from issues i left join states s on s.id = i.state_id where i.project_id = ?
      and i.deleted_at is null and i.archived_at is null and i.is_draft = 0 and coalesce(s."group", '') != 'triage'
      and not exists (select 1 from projects p where p.id = i.project_id and p.archived_at is not null)`,
    intakes: 'select count(*) from intake_issues where project_id = ? and deleted_at is null',
    pages: 'select count(*) from project_pages where project_id = ? and deleted_at is null'
  }
  const rows = await db.$client.batch(
    fields.map(field => db.$client.prepare(counters[field as keyof typeof counters]).bind(projectId))
  )
  const counts = Object.fromEntries(
    fields.map((field, index) => [field, Number(Object.values(rows[index].results[0] as Record<string, unknown>)[0] ?? 0)])
  )
  return { id: project.id, name: project.name, identifier: project.identifier, counts }
}
