import { and, eq, isNull, sql } from 'drizzle-orm'
import { fileAssets, pages, projectPages } from '@/db/schema/content'
import { issueComments, issues } from '@/db/schema/issue'
import { draftIssues } from '@/db/schema/planning'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { projectMembers, projects, workspaceMembers } from '@/db/schema/workspace'
import { ROLE } from '@/server/common/permissions'
import type { EntityBinding, FileAssetRow } from '@/server/asset/model-rules'
import type { LancityDb } from '@/types/database/schema'

type AssetScope = Pick<FileAssetRow, 'workspaceId' | 'projectId' | 'entityType' | 'createdById'>

async function workspaceRoleOf(db: LancityDb, userId: number, workspaceId: number | null) {
  if (workspaceId == null) return null
  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.memberId, userId),
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt)
      )
    )
    .limit(1)
  return row?.role ?? null
}

/**
 * PD-0441 `can_modify_asset`: whether the user may confirm, update or delete the asset. The workspace logo needs a
 * workspace admin and a project cover a project admin, an issue attachment a project admin or its uploader, and any
 * other asset a member, an admin or its uploader. The uploader must still be an active member of the asset's project.
 */
export async function canModifyAsset(db: LancityDb, userId: number, asset: AssetScope): Promise<boolean> {
  const workspaceRole = await workspaceRoleOf(db, userId, asset.workspaceId)
  if (asset.entityType === 'WORKSPACE_LOGO') return workspaceRole === ROLE.ADMIN
  let role: number | null = workspaceRole
  if (asset.projectId) {
    const [member] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.memberId, userId),
          eq(projectMembers.workspaceId, asset.workspaceId ?? -1),
          eq(projectMembers.projectId, asset.projectId),
          eq(projectMembers.isActive, true),
          isNull(projectMembers.deletedAt)
        )
      )
      .limit(1)
    role = member?.role ?? null
    // Workspace admins act as admins in the projects they belong to.
    if (role !== null && workspaceRole === ROLE.ADMIN) role = ROLE.ADMIN
    if (asset.entityType === 'PROJECT_COVER') return role === ROLE.ADMIN
  }
  if (asset.createdById === userId && role !== null) return true
  if (asset.entityType === 'ISSUE_ATTACHMENT') return role === ROLE.ADMIN
  return role === ROLE.ADMIN || role === ROLE.MEMBER
}

async function exists(query: PromiseLike<unknown[]>) {
  return (await query).length > 0
}

/**
 * PD-0442 `can_bind_asset`: whether an asset may be bound to the entity in `binding`. An issue, comment or page must
 * belong to the workspace and to `projectId` or, without one, to a project the user is an active member of. A draft
 * must be the user's own and a user asset can only be bound to the user. No identifier leaves the asset unbound.
 */
export async function canBindAsset(
  db: LancityDb,
  userId: number,
  workspaceId: number,
  binding: EntityBinding | null,
  projectId?: number | null
): Promise<boolean> {
  if (!binding?.id) return true
  const { field, id } = binding
  if (field === 'user_id') return id === userId
  if (field === 'draft_issue_id')
    return exists(
      db
        .select({ one: sql`1` })
        .from(draftIssues)
        .where(
          and(
            eq(draftIssues.id, id),
            eq(draftIssues.workspaceId, workspaceId),
            eq(draftIssues.createdById, userId),
            isNull(draftIssues.deletedAt)
          )
        )
        .limit(1)
    )
  const scoped = (column: AnySQLiteColumn) =>
    projectId
      ? eq(column, projectId)
      : sql`exists (select 1 from project_members pm where pm.project_id = ${column} and pm.member_id = ${userId}
          and pm.is_active = 1 and pm.deleted_at is null)`
  if (field === 'issue_id')
    return exists(
      db
        .select({ one: sql`1` })
        .from(issues)
        .where(
          and(
            eq(issues.id, id),
            eq(issues.workspaceId, workspaceId),
            isNull(issues.deletedAt),
            scoped(issues.projectId)
          )
        )
        .limit(1)
    )
  if (field === 'comment_id')
    return exists(
      db
        .select({ one: sql`1` })
        .from(issueComments)
        .where(
          and(
            eq(issueComments.id, id),
            eq(issueComments.workspaceId, workspaceId),
            isNull(issueComments.deletedAt),
            scoped(issueComments.projectId)
          )
        )
        .limit(1)
    )
  if (field === 'page_id')
    return exists(
      db
        .select({ one: sql`1` })
        .from(pages)
        .innerJoin(
          projectPages,
          and(
            eq(projectPages.pageId, pages.id),
            isNull(projectPages.deletedAt),
            eq(projectPages.workspaceId, workspaceId)
          )
        )
        .where(
          and(
            eq(pages.id, id),
            eq(pages.workspaceId, workspaceId),
            isNull(pages.deletedAt),
            scoped(projectPages.projectId)
          )
        )
        .limit(1)
    )
  return true
}

/**
 * PD-1376 `FileAsset.is_project_accessible_to`: the user must be an active member of the asset's project. A restricted
 * guest (a guest of a project with `guest_view_all_features` off) also reaches only the assets of issues they created
 * and those issues' comments. Assets without a project are workspace level, so they are accessible.
 */
export async function isProjectAccessibleTo(
  db: LancityDb,
  userId: number,
  asset: Pick<FileAssetRow, 'workspaceId' | 'projectId' | 'issueId' | 'commentId'>
): Promise<boolean> {
  if (asset.projectId == null) return true
  const [member] = await db
    .select({ role: projectMembers.role, guestViewAll: projects.guestViewAllFeatures })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(
      and(
        eq(projectMembers.memberId, userId),
        eq(projectMembers.workspaceId, asset.workspaceId ?? -1),
        eq(projectMembers.projectId, asset.projectId),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt)
      )
    )
    .limit(1)
  if (!member) return false
  if (member.role !== ROLE.GUEST || member.guestViewAll) return true
  let issueId = asset.issueId
  if (!issueId && asset.commentId) {
    const [comment] = await db
      .select({ issueId: issueComments.issueId })
      .from(issueComments)
      .where(eq(issueComments.id, asset.commentId))
      .limit(1)
    issueId = comment?.issueId ?? null
  }
  if (!issueId) return true
  return exists(
    db
      .select({ one: sql`1` })
      .from(issues)
      .where(
        and(
          eq(issues.id, issueId),
          eq(issues.projectId, asset.projectId),
          eq(issues.createdById, userId),
          isNull(issues.deletedAt)
        )
      )
      .limit(1)
  )
}

/** Plane `FileAsset.objects`: assets that are not soft deleted. */
export const liveAsset = (id: number) => and(eq(fileAssets.id, id), isNull(fileAssets.deletedAt))
