import { and, asc, eq, isNull, or, sql } from 'drizzle-orm'
import { user } from '@/db/schema/auth'
import { pages, projectPages } from '@/db/schema/content'
import { profiles } from '@/db/schema/identity'
import { projectMembers, projects, workspaceMembers, workspaces } from '@/db/schema/workspace'
import { AppError } from '@/server/collaboration/errors'
import { ServiceError } from '@/server/common/errors'
import type { Actor } from '@/types/auth/schema'
import type { PageLiveAction } from '@/types/content/schema'
import type { LancityDb } from '@/types/database/schema'

export async function getPageLiveAccess(
  db: LancityDb,
  actor: Actor,
  slug: string,
  pageId: number,
  action: PageLiveAction
) {
  const owner = eq(pages.ownedById, actor.userId)
  const readOnly = sql<boolean>`not (${owner}) and ${projectMembers.role} = 5`
  const [link] = await db
    .select({ projectId: projects.id, readOnly: readOnly.mapWith(Boolean) })
    .from(projectPages)
    .innerJoin(pages, and(eq(pages.id, projectPages.pageId), eq(pages.workspaceId, projectPages.workspaceId)))
    .innerJoin(projects, and(eq(projects.id, projectPages.projectId), eq(projects.workspaceId, pages.workspaceId)))
    .innerJoin(workspaces, eq(workspaces.id, pages.workspaceId))
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.memberId, actor.userId))
    )
    .innerJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, projects.id),
        eq(projectMembers.workspaceId, workspaces.id),
        eq(projectMembers.memberId, actor.userId)
      )
    )
    .where(
      and(
        eq(workspaces.slug, slug),
        eq(pages.id, pageId),
        isNull(pages.deletedAt),
        isNull(projectPages.deletedAt),
        isNull(projects.deletedAt),
        isNull(workspaces.deletedAt),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt),
        or(
          owner,
          and(eq(pages.access, 0), or(sql`${projectMembers.role} >= 15`, eq(projects.guestViewAllFeatures, true)))
        ),
        action === 'edit' ? sql`not (${readOnly})` : undefined
      )
    )
    .orderBy(asc(readOnly), asc(projects.id))
    .limit(1)

  if (!link) throw new ServiceError(404, 'PAGE_NOT_FOUND', 'Page not found')
  return action === 'edit'
    ? { project_id: String(link.projectId) }
    : { project_id: String(link.projectId), read_only: link.readOnly }
}

/**
 * PD-2124 `requireSecretKey`: constant-time check of the `live-server-secret-key` header on server-to-server calls.
 * A missing expected key rejects everything, so an unconfigured Worker never accepts an empty secret.
 */
export async function verifySecretKey(provided: string | null | undefined, expected: string | null | undefined): Promise<boolean> {
  if (!provided || !expected) return false
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  const [a, b] = await Promise.all([digest(provided), digest(expected)])
  let difference = 0
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index]
  return difference === 0
}

/** PD-2331 to PD-2334: the signed-in user as the editor shows it (`id` and `display_name`). */
export async function getLiveUser(db: LancityDb, actor: Actor): Promise<{ id: string; display_name: string }> {
  const [row] = await db
    .select({ name: user.name, username: user.username, firstName: profiles.firstName, lastName: profiles.lastName })
    .from(user)
    .leftJoin(profiles, eq(profiles.userId, user.id))
    .where(eq(user.id, actor.userId))
    .limit(1)
  if (!row) throw new AppError('User not found', { statusCode: 404, code: 'USER_NOT_FOUND' })
  return { id: String(actor.userId), display_name: row.username || [row.firstName, row.lastName].filter(Boolean).join(' ') || row.name }
}

/**
 * PD-2126, PD-2335, PD-2336: whether the user may open the page and whether the socket must be read-only. A denial maps
 * to `AUTH_PAGE_ACCESS_DENIED`, like Plane (Django answered 404). The project comes from the checked page, never from
 * the client.
 */
export async function authorizePage(
  db: LancityDb,
  actor: Actor,
  slug: string,
  pageId: number
): Promise<{ projectId: number; readOnly: boolean }> {
  try {
    const access = (await getPageLiveAccess(db, actor, slug, pageId, 'view')) as { project_id: string; read_only?: boolean }
    if (typeof access.read_only !== 'boolean') throw new AppError('Page access unknown', { code: 'AUTH_PAGE_ACCESS_UNKNOWN' })
    return { projectId: Number(access.project_id), readOnly: access.read_only }
  } catch (error) {
    if (error instanceof AppError) throw error
    const appError = AppError.from(error, { context: { operation: 'authorizePage', pageId } })
    throw new AppError('Page access denied', { code: appError.statusCode === 404 ? 'AUTH_PAGE_ACCESS_DENIED' : appError.code })
  }
}

/**
 * PD-2127 `handleAuthentication`: the token the editor sends names the user, which must be the session user.
 * The cookie in the token is not used: the session was already resolved from the upgrade request.
 */
export function checkAuthToken(token: string, userId: number): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(token)
  } catch {
    throw new AppError('Credentials not provided', { code: 'AUTH_MISSING_CREDENTIALS' })
  }
  const id = typeof parsed === 'object' && parsed !== null ? (parsed as { id?: unknown }).id : undefined
  if (id === undefined || id === null || id === '') throw new AppError('Credentials not provided', { code: 'AUTH_MISSING_CREDENTIALS' })
  if (String(id) !== String(userId))
    throw new AppError('Authentication unsuccessful: User ID mismatch', { code: 'AUTH_USER_MISMATCH' })
}
