import { and, eq, isNull, sql } from 'drizzle-orm'
import { projectMembers, workspaceMembers, workspaces } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

/** Active workspace membership by slug. Every workspace-wide issue read starts here. */
export async function requireWorkspaceBySlug(db: LancityDb, actor: Actor, slug: string, minimumRole = 5) {
  const [row] = await db
    .select({ workspace: workspaces, membership: workspaceMembers })
    .from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaces.slug, slug),
        isNull(workspaces.deletedAt),
        eq(workspaceMembers.memberId, actor.userId),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt)
      )
    )
    .limit(1)
  if (!row) throw new ServiceError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found')
  if (row.membership.role < minimumRole) throw new ServiceError(403, 'FORBIDDEN', 'Insufficient workspace permissions')
  return row
}

/** Port of `user_has_issue_permission` (PD-0134): the creator, or an active project member with an allowed role. */
export async function userHasIssuePermission(
  db: LancityDb,
  userId: number,
  projectId: number,
  issue?: { createdById: number | null } | null,
  allowedRoles?: number[],
  allowCreator = true
) {
  if (allowCreator && issue && issue.createdById === userId) return true
  const rows = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.memberId, userId),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt)
      )
    )
    .limit(1)
  return rows.length > 0 && (!allowedRoles || allowedRoles.includes(rows[0].role))
}

/** Port of `is_active_project_member` (PD-0135). */
export function isActiveProjectMember(db: LancityDb, userId: number, projectId: number) {
  return userHasIssuePermission(db, userId, projectId, null, undefined, false)
}

/** Port of `is_project_or_workspace_admin` (PD-0136): project admin, or workspace admin who is an active project member. */
export async function isProjectOrWorkspaceAdmin(db: LancityDb, userId: number, projectId: number, slug: string) {
  const [row] = await db
    .select({ role: projectMembers.role, workspaceRole: workspaceMembers.role })
    .from(projectMembers)
    .innerJoin(workspaces, eq(workspaces.id, projectMembers.workspaceId))
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.memberId, userId),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt)
      )
    )
    .where(
      and(
        eq(workspaces.slug, slug),
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.memberId, userId),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt)
      )
    )
    .limit(1)
  return Boolean(row && (row.role === 20 || row.workspaceRole === 20))
}

/**
 * Port of `is_restricted_guest` (PD-0137): the actor holds the guest role on a project that does not share all
 * features, so only the issues they created are visible.
 */
export async function isRestrictedGuest(db: LancityDb, userId: number, projectId: number, slug: string) {
  const rows = await db.all<{ one: number }>(sql`select 1 as one from project_members pm
    join projects p on p.id = pm.project_id and p.workspace_id = pm.workspace_id
    join workspaces w on w.id = p.workspace_id
    where w.slug = ${slug} and pm.project_id = ${projectId} and pm.member_id = ${userId}
      and pm.is_active = 1 and pm.deleted_at is null and pm.role = 5 and p.guest_view_all_features = 0 limit 1`)
  return rows.length > 0
}

/** Port of `guest_cannot_view_issue` (PD-0138). Callers answer 404, the same as for a missing issue. */
export async function guestCannotViewIssue(
  db: LancityDb,
  userId: number,
  issue: { createdById: number | null; projectId: number } | null,
  slug: string
) {
  return Boolean(issue && issue.createdById !== userId && (await isRestrictedGuest(db, userId, issue.projectId, slug)))
}

/**
 * Port of `visible_issue_q` (PD-0139) as a SQL predicate on the `issues` table: every issue of a project where the
 * actor is an active member above guest, or a guest of a project sharing all features, or the issue's creator.
 */
export function visibleIssueSql(userId: number) {
  return sql`exists (select 1 from project_members vpm join projects vp on vp.id = vpm.project_id
    where vpm.project_id = issues.project_id and vpm.member_id = ${userId} and vpm.is_active = 1 and vpm.deleted_at is null
      and (vpm.role > 5 or vp.guest_view_all_features = 1 or issues.created_by_id = ${userId}))`
}
