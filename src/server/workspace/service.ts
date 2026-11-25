import { and, eq, isNull, sql } from 'drizzle-orm'
import { profiles } from '@/db/schema/identity'
import { workspaceMembers, workspaceThemes, workspaces } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import { workspaceCreationDisabled } from '@/server/instance/service'
import { deletedWorkspaceSlug, logoUrlWorkspace } from '@/server/workspace/model-rules'
import { queryWorkspace, queryWorkspaceTheme } from '@/server/workspace/queries'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import {
  createWorkspaceInputSchema,
  type CreateWorkspaceInput,
  type CreateWorkspaceTheme,
  type UpdateWorkspaceInput,
  type UpdateWorkspaceTheme,
  type WorkspaceListQuery,
  type WorkspaceRole
} from '@/types/workspace/schema'

/** Check active membership and return its workspace. The owner is identified by workspace.ownerId. */
export async function requireWorkspaceMember(
  db: LancityDb,
  actor: Actor,
  workspaceId: number,
  minimumRole: WorkspaceRole = 5
) {
  const [row] = await db
    .select({ workspace: workspaces, membership: workspaceMembers })
    .from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaces.id, workspaceId),
        isNull(workspaces.deletedAt),
        eq(workspaceMembers.memberId, actor.userId),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt)
      )
    )
  if (!row) throw new ServiceError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found')
  if (row.membership.role < minimumRole) throw new ServiceError(403, 'FORBIDDEN', 'Insufficient workspace permissions')
  return row
}

async function bySlug(db: LancityDb, actor: Actor, slug: string, minimumRole: WorkspaceRole = 5) {
  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.slug, slug), isNull(workspaces.deletedAt)))
  if (!workspace) throw new ServiceError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found')
  return requireWorkspaceMember(db, actor, workspace.id, minimumRole)
}

/** WorkSpaceViewSet.list: workspaces of the actor ordered by name, with role and member count. */
export async function listWorkspaces(db: LancityDb, actor: Actor, filters: WorkspaceListQuery = {}) {
  return queryWorkspace(db, actor, filters)
}

/**
 * UserWorkSpacesEndpoint.get: flat workspace DTOs (row fields, logo_url, role, total_members).
 * `fields` keeps only the named keys, like Plane's DynamicBaseSerializer.
 */
export async function listUserWorkspaces(db: LancityDb, actor: Actor, filters: WorkspaceListQuery = {}, fields = '') {
  const wanted = fields.split(',').filter(Boolean)
  const rows = await queryWorkspace(db, actor, filters)
  return rows.map(({ workspace, role, totalMembers }) => {
    const dto: Record<string, unknown> = { ...workspace, logoUrl: logoUrlWorkspace(workspace), role, totalMembers }
    return wanted.length ? Object.fromEntries(Object.entries(dto).filter(([key]) => wanted.includes(key))) : dto
  })
}

export async function getWorkspace(db: LancityDb, actor: Actor, slug: string, minimumRole: WorkspaceRole = 5) {
  return bySlug(db, actor, slug, minimumRole)
}

export async function checkWorkspaceSlug(db: LancityDb, slug: string | undefined) {
  if (!slug) throw new ServiceError(400, 'VALIDATION_ERROR', 'Workspace slug is required')
  const parsed = createWorkspaceInputSchema.shape.slug.safeParse(slug)
  if (!parsed.success) return { status: false }
  const [existing] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug)).limit(1)
  return { status: !existing }
}

export async function createWorkspace(db: LancityDb, actor: Actor, input: CreateWorkspaceInput) {
  if (await workspaceCreationDisabled(db))
    throw new ServiceError(403, 'WORKSPACE_CREATION_DISABLED', 'Workspace creation is disabled')
  const [existing] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, input.slug))
  if (existing) throw new ServiceError(409, 'WORKSPACE_SLUG_EXISTS', 'Workspace slug already exists')
  try {
    const [created] = await db.batch([
      db
        .insert(workspaces)
        .values({
          name: input.name,
          slug: input.slug,
          ownerId: actor.userId,
          createdById: actor.userId,
          updatedById: actor.userId
        })
        .returning(),
      db.insert(workspaceMembers).values({
        workspaceId: sql`(select id from workspaces where slug = ${input.slug})`,
        memberId: actor.userId,
        role: 20,
        companyRole: input.companyRole ?? '',
        createdById: actor.userId,
        updatedById: actor.userId
      })
    ])
    return { ...created[0], totalMembers: 1, role: 20 as const }
  } catch (error) {
    const [duplicate] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, input.slug))
    if (duplicate) throw new ServiceError(409, 'WORKSPACE_SLUG_EXISTS', 'Workspace slug already exists')
    throw error
  }
}

export async function updateWorkspace(db: LancityDb, actor: Actor, slug: string, input: UpdateWorkspaceInput) {
  const { workspace } = await bySlug(db, actor, slug, 20)
  if (input.slug && input.slug !== slug) {
    const [existing] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, input.slug))
    if (existing) throw new ServiceError(409, 'WORKSPACE_SLUG_EXISTS', 'Workspace slug already exists')
  }
  const [updated] = await db
    .update(workspaces)
    .set({ ...input, updatedById: actor.userId })
    .where(eq(workspaces.id, workspace.id))
    .returning()
  return updated
}

/** WorkSpaceViewSet.remove_last_workspace_ids_from_user_settings. */
export const removeLastWorkspaceIdsFromUserSettings = (db: LancityDb, workspaceId: number) =>
  db.update(profiles).set({ lastWorkspaceId: null }).where(eq(profiles.lastWorkspaceId, workspaceId))

/** WorkSpaceViewSet.destroy (WorkSpaceBasePermission: any active admin, not only the owner) + Workspace.delete: soft delete and rename the slug so it can be reused. */
export async function deleteWorkspace(db: LancityDb, actor: Actor, slug: string) {
  const { workspace } = await bySlug(db, actor, slug, 20)
  const deletedAt = new Date()
  await db.batch([
    removeLastWorkspaceIdsFromUserSettings(db, workspace.id),
    db
      .update(workspaces)
      .set({ deletedAt, slug: deletedWorkspaceSlug(workspace.slug, deletedAt), updatedById: actor.userId })
      .where(and(eq(workspaces.id, workspace.id), isNull(workspaces.deletedAt)))
  ])
}

// WorkspaceThemeViewSet (WorkSpaceAdminPermission: admins and members).
async function findTheme(db: LancityDb, workspaceId: number, id: number) {
  const [theme] = await db
    .select()
    .from(workspaceThemes)
    .where(
      and(eq(workspaceThemes.id, id), eq(workspaceThemes.workspaceId, workspaceId), isNull(workspaceThemes.deletedAt))
    )
  if (!theme) throw new ServiceError(404, 'THEME_NOT_FOUND', 'Workspace theme not found')
  return theme
}
async function themeConflict(db: LancityDb, error: unknown, workspaceId: number, name: string | undefined) {
  if (name) {
    const [duplicate] = await db
      .select({ id: workspaceThemes.id })
      .from(workspaceThemes)
      .where(
        and(
          eq(workspaceThemes.workspaceId, workspaceId),
          eq(workspaceThemes.name, name),
          isNull(workspaceThemes.deletedAt)
        )
      )
    if (duplicate) return new ServiceError(409, 'THEME_EXISTS', 'A theme with this name already exists')
  }
  return error
}
export async function listWorkspaceThemes(db: LancityDb, actor: Actor, slug: string) {
  const { workspace } = await bySlug(db, actor, slug, 15)
  return queryWorkspaceTheme(db, workspace.id)
}
export async function getWorkspaceTheme(db: LancityDb, actor: Actor, slug: string, id: number) {
  const { workspace } = await bySlug(db, actor, slug, 15)
  return findTheme(db, workspace.id, id)
}
export async function createWorkspaceTheme(db: LancityDb, actor: Actor, slug: string, input: CreateWorkspaceTheme) {
  const { workspace } = await bySlug(db, actor, slug, 15)
  try {
    const [theme] = await db
      .insert(workspaceThemes)
      .values({
        name: input.name,
        colors: input.colors as never,
        workspaceId: workspace.id,
        actorId: actor.userId,
        createdById: actor.userId,
        updatedById: actor.userId
      })
      .returning()
    return theme
  } catch (error) {
    throw await themeConflict(db, error, workspace.id, input.name)
  }
}
export async function updateWorkspaceTheme(
  db: LancityDb,
  actor: Actor,
  slug: string,
  id: number,
  input: UpdateWorkspaceTheme
) {
  const { workspace } = await bySlug(db, actor, slug, 15)
  await findTheme(db, workspace.id, id)
  try {
    const [theme] = await db
      .update(workspaceThemes)
      .set({ name: input.name, colors: input.colors as never, updatedById: actor.userId })
      .where(and(eq(workspaceThemes.id, id), eq(workspaceThemes.workspaceId, workspace.id)))
      .returning()
    return theme
  } catch (error) {
    throw await themeConflict(db, error, workspace.id, input.name)
  }
}
export async function deleteWorkspaceTheme(db: LancityDb, actor: Actor, slug: string, id: number) {
  const { workspace } = await bySlug(db, actor, slug, 15)
  await findTheme(db, workspace.id, id)
  await db
    .update(workspaceThemes)
    .set({ deletedAt: new Date(), updatedById: actor.userId })
    .where(and(eq(workspaceThemes.id, id), eq(workspaceThemes.workspaceId, workspace.id)))
}
