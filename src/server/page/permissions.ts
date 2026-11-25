import { and, eq, isNull } from 'drizzle-orm'
import { pages, projectPages } from '@/db/schema/content'
import { projectMembers, workspaces } from '@/db/schema/workspace'
import { ROLE } from '@/server/common/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

/**
 * Port of plane/app/permissions/page.py `ProjectPagePermission` (and its copy in utils/permissions/page.py).
 * The services enforce the same matrix inside `requirePageAccess`; these helpers expose it for other domains
 * (for example the live server) and for tests.
 */
export type PageHttpMethod = 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
const SAFE_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS']

/** PD-0279, PD-1967. */
export function checkProjectActionAccess(method: string, role: number): boolean {
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') return role === ROLE.ADMIN || role === ROLE.MEMBER
  if (SAFE_METHODS.includes(method)) return role === ROLE.ADMIN || role === ROLE.MEMBER || role === ROLE.GUEST
  if (method === 'DELETE') return role === ROLE.ADMIN
  return false
}

/** PD-0280, PD-1968. */
export function hasPublicPageActionAccess(method: string, role: number): boolean {
  return checkProjectActionAccess(method, role)
}

/** PD-0278, PD-1966: only the owner reads or writes a private page, and the owner is allowed before this check. */
export function hasPrivatePageActionAccess(): boolean {
  return false
}

/** PD-0276, PD-1964: active project role of the actor, or null. */
export async function checkProjectMemberAccess(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const [row] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(workspaces, eq(workspaces.id, projectMembers.workspaceId))
    .where(
      and(
        eq(projectMembers.memberId, actor.userId),
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt),
        eq(workspaces.slug, slug),
        isNull(workspaces.deletedAt)
      )
    )
    .limit(1)
  return row?.role ?? null
}

/** PD-0277, PD-1965. */
export async function checkAccessAndGetRole(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const role = await checkProjectMemberAccess(db, actor, slug, projectId)
  return role ? { allowed: true, role } : { allowed: false, role: null }
}

/** PD-0275, PD-1963: may `actor` perform `method` on the project (and on the page when `pageId` is set)? */
export async function hasPermissionProjectPagePermission(
  db: LancityDb,
  actor: Actor,
  scope: { slug: string; projectId: number; pageId?: number; method: string; guestViewAllFeatures?: boolean }
): Promise<boolean> {
  const { allowed, role } = await checkAccessAndGetRole(db, actor, scope.slug, scope.projectId)
  if (!allowed || role === null) return false
  if (scope.pageId !== undefined) {
    const [page] = await db
      .select({ ownedById: pages.ownedById, access: pages.access })
      .from(pages)
      .innerJoin(
        projectPages,
        and(
          eq(projectPages.pageId, pages.id),
          eq(projectPages.projectId, scope.projectId),
          isNull(projectPages.deletedAt)
        )
      )
      .where(and(eq(pages.id, scope.pageId), isNull(pages.deletedAt)))
      .limit(1)
    if (!page) return false
    if (page.ownedById === actor.userId) return true
    if (role === ROLE.GUEST && !scope.guestViewAllFeatures) return false
    if (page.access === 1) return hasPrivatePageActionAccess()
  }
  return hasPublicPageActionAccess(scope.method, role)
}
