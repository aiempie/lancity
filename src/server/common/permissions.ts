import { and, eq, isNull, sql } from 'drizzle-orm'
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { createMiddleware } from 'hono/factory'
import { issues } from '@/db/schema/issue'
import { projectMembers, projects, workspaceMembers, workspaces } from '@/db/schema/workspace'
import { forbiddenError, ServiceError } from '@/server/common/errors'
import type { ApiEnv, PermissionContext } from '@/types/api/schema'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

/** Plane `ROLE`: numeric roles stored in workspace_members.role and project_members.role. */
export const ROLE = { ADMIN: 20, MEMBER: 15, GUEST: 5 } as const
export type Role = (typeof ROLE)[keyof typeof ROLE]

export type PermissionLevel = 'PROJECT' | 'WORKSPACE'

/** Model whose rows may be touched by their creator regardless of role (Plane `creator=True, model=...`). */
export type CreatorModel = {
  table: SQLiteTable
  id: AnySQLiteColumn
  createdById: AnySQLiteColumn
  deletedAt?: AnySQLiteColumn
}

export type PermissionOptions = {
  /** Default `PROJECT`. Workspace level checks ignore the project. */
  level?: PermissionLevel
  /** Allow the creator of record `pk` even when the role is not in the allowed list. */
  creator?: boolean
  model?: CreatorModel
}

export type PermissionScope = { slug: string; projectId?: number; pk?: number }

async function workspaceMembership(db: LancityDb, userId: number, slug: string) {
  const [row] = await db
    .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaces.slug, slug),
        isNull(workspaces.deletedAt),
        eq(workspaceMembers.memberId, userId),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt)
      )
    )
    .limit(1)
  return row ?? null
}

async function projectMembership(db: LancityDb, userId: number, slug: string, projectId: number) {
  const [row] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(workspaces, eq(workspaces.id, projectMembers.workspaceId))
    .where(
      and(
        eq(workspaces.slug, slug),
        isNull(workspaces.deletedAt),
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.memberId, userId),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt)
      )
    )
    .limit(1)
  return row ?? null
}

async function createdByActor(db: LancityDb, userId: number, model: CreatorModel, pk: number): Promise<boolean> {
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(model.table)
    .where(and(eq(model.id, pk), eq(model.createdById, userId), model.deletedAt ? isNull(model.deletedAt) : undefined))
    .limit(1)
  return Boolean(row)
}

/**
 * Plane `allow_permission` as a function: resolve the caller's membership and return it when the caller
 * may proceed, otherwise null.
 *
 * - `creator` + `model`: the caller must be an active workspace member (and an active project member at
 *   project level). If they created record `pk` they pass without a role check.
 * - `WORKSPACE`: the workspace role must be in `allowedRoles`.
 * - `PROJECT` (default): the project role must be in `allowedRoles`; a workspace admin who is an active
 *   member of the project also passes, whatever the project role.
 */
export async function resolvePermission(
  db: LancityDb,
  actor: Actor,
  scope: PermissionScope,
  allowedRoles: readonly number[],
  options: PermissionOptions = {}
): Promise<PermissionContext | null> {
  const { level = 'PROJECT', creator = false, model } = options
  const projectLevel = level !== 'WORKSPACE'
  if (projectLevel && !Number.isSafeInteger(scope.projectId)) return null
  const [workspace, project] = await Promise.all([
    workspaceMembership(db, actor.userId, scope.slug),
    projectLevel ? projectMembership(db, actor.userId, scope.slug, scope.projectId!) : Promise.resolve(null)
  ])

  if (creator && model) {
    if (!workspace || (projectLevel && !project)) return null
    if (scope.pk !== undefined && (await createdByActor(db, actor.userId, model, scope.pk))) {
      return { workspaceId: workspace.workspaceId, workspaceRole: workspace.role, projectRole: project?.role ?? null }
    }
  }

  if (!workspace) return null
  const context: PermissionContext = {
    workspaceId: workspace.workspaceId,
    workspaceRole: workspace.role,
    ...(projectLevel ? { projectRole: project?.role ?? null } : {})
  }
  if (!projectLevel) return allowedRoles.includes(workspace.role) ? context : null
  if (project && allowedRoles.includes(project.role)) return context
  return project && workspace.role === ROLE.ADMIN ? context : null
}

/** Boolean form of `resolvePermission`. */
export async function hasPermission(
  db: LancityDb,
  actor: Actor,
  scope: PermissionScope,
  allowedRoles: readonly number[],
  options?: PermissionOptions
): Promise<boolean> {
  return (await resolvePermission(db, actor, scope, allowedRoles, options)) !== null
}

/** Throws 403 "You don't have the required permissions." when `resolvePermission` returns null. */
export async function requirePermission(
  db: LancityDb,
  actor: Actor,
  scope: PermissionScope,
  allowedRoles: readonly number[],
  options?: PermissionOptions
): Promise<PermissionContext> {
  const context = await resolvePermission(db, actor, scope, allowedRoles, options)
  if (!context) throw forbiddenError()
  return context
}

/** Workspace level role check. Shared by Server Actions and Hono routes. */
export function requireWorkspaceRole(db: LancityDb, actor: Actor, slug: string, allowedRoles: readonly number[]) {
  return requirePermission(db, actor, { slug }, allowedRoles, { level: 'WORKSPACE' })
}

/** Project level role check (workspace admins who belong to the project pass too). */
export function requireProjectRole(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  allowedRoles: readonly number[],
  options: Omit<PermissionOptions, 'level'> & { pk?: number } = {}
) {
  const { pk, ...rest } = options
  return requirePermission(db, actor, { slug, projectId, pk }, allowedRoles, { ...rest, level: 'PROJECT' })
}

function positiveInt(value: string | undefined): number | undefined {
  return value !== undefined && /^[1-9]\d{0,15}$/.test(value) ? Number(value) : undefined
}

/**
 * Plane `allow_permission` decorator for Hono routes. Mount after `authenticate`. Reads `:slug`,
 * `:projectId` and (for creator checks) the param named by `pkParam`, then stores the membership
 * in `c.get('permission')`.
 */
export function allowPermission(allowedRoles: readonly number[], options: PermissionOptions & { pkParam?: string } = {}) {
  const { pkParam = 'id', ...permissionOptions } = options
  return createMiddleware<ApiEnv>(async (c, next) => {
    const actor = c.get('actor')
    if (!actor) throw new ServiceError(401, 'UNAUTHORIZED', 'Authentication required')
    const slug = c.req.param('slug')
    if (!slug) throw new ServiceError(500, 'INTERNAL_ERROR', 'Route has no :slug parameter')
    const { getDb } = await import('@/db/client')
    const context = await requirePermission(
      getDb(),
      actor,
      { slug, projectId: positiveInt(c.req.param('projectId')), pk: positiveInt(c.req.param(pkParam)) },
      allowedRoles,
      permissionOptions
    )
    c.set('permission', context)
    await next()
  })
}

/**
 * Plane `issue_hidden_from_guest`: true when the caller is a project guest on a project that does not let
 * guests view everything (`guest_view_all_features` off) and did not create the issue. Callers turn true
 * into a 403. Ownership ignores archived, draft and triage state, only deleted issues do not count.
 */
export async function issueHiddenFromGuest(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number
): Promise<boolean> {
  const [restricted] = await db
    .select({ one: sql<number>`1` })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(workspaces, eq(workspaces.id, projectMembers.workspaceId))
    .where(
      and(
        eq(workspaces.slug, slug),
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.memberId, actor.userId),
        eq(projectMembers.role, ROLE.GUEST),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt),
        eq(projects.guestViewAllFeatures, false)
      )
    )
    .limit(1)
  if (!restricted) return false
  const [owned] = await db
    .select({ one: sql<number>`1` })
    .from(issues)
    .innerJoin(workspaces, eq(workspaces.id, issues.workspaceId))
    .where(
      and(
        eq(issues.id, issueId),
        eq(workspaces.slug, slug),
        eq(issues.projectId, projectId),
        eq(issues.createdById, actor.userId),
        isNull(issues.deletedAt)
      )
    )
    .limit(1)
  return !owned
}
