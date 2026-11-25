import { and, asc, desc, eq, exists, isNull, ne, notExists, or, sql } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { deployBoards } from '@/db/schema/content'
import { issues, labels, states } from '@/db/schema/issue'
import { cycles, intakes, modules } from '@/db/schema/planning'
import { projects, workspaces } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { PublicationSettings } from '@/types/content/p3-public-schema'
import type { LancityDb } from '@/types/database/schema'

function canManagePublication(actor: Actor, slug: string, projectId: number, allowArchived = false) {
  return sql`exists (select 1 from project_members pm
    join projects p on p.id = pm.project_id and p.workspace_id = pm.workspace_id
    join workspace_members wm on wm.workspace_id = pm.workspace_id and wm.member_id = pm.member_id
    join workspaces w on w.id = wm.workspace_id
    where p.id = ${projectId} and pm.member_id = ${actor.userId} and w.slug = ${slug}
      and (${allowArchived ? 1 : 0} = 1 or p.archived_at is null) and p.deleted_at is null and w.deleted_at is null
      and pm.is_active = 1 and wm.is_active = 1 and pm.deleted_at is null and wm.deleted_at is null
      and (pm.role = 20 or wm.role = 20))`
}

export async function publishProject(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { workspace, project } = await requireProjectAccess(db, actor, slug, projectId, 20)
  if (project.archivedAt) throw new ServiceError(409, 'PROJECT_ARCHIVED', 'Archived projects cannot be published')
  const [board] = await db
    .insert(deployBoards)
    .select(
      sql`select null, cast(unixepoch('subsec') * 1000 as integer), cast(unixepoch('subsec') * 1000 as integer),
      ${actor.userId}, null, ${projectId}, 'project', ${crypto.randomUUID().replaceAll('-', '')},
      0, 0, 0, '{}', ${projectId}, ${workspace.id}, null, 0, 0, null
      where ${canManagePublication(actor, slug, projectId)}`
    )
    .onConflictDoUpdate({
      target: [deployBoards.entityName, deployBoards.entityIdentifier],
      targetWhere: isNull(deployBoards.deletedAt),
      setWhere: and(eq(deployBoards.projectId, projectId), eq(deployBoards.workspaceId, workspace.id)),
      set: { isDisabled: false, updatedById: actor.userId }
    })
    .returning({ anchor: deployBoards.anchor })
  if (!board) {
    await requireProjectAccess(db, actor, slug, projectId, 20)
    throw new ServiceError(409, 'BOARD_CONFLICT', 'Project or publication changed')
  }
  return board
}

export async function unpublishProject(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 20)
  const [board] = await db
    .update(deployBoards)
    .set({ deletedAt: new Date(), isDisabled: true, updatedById: actor.userId })
    .where(
      and(
        eq(deployBoards.projectId, projectId),
        eq(deployBoards.workspaceId, workspace.id),
        eq(deployBoards.entityName, 'project'),
        isNull(deployBoards.deletedAt),
        canManagePublication(actor, slug, projectId, true)
      )
    )
    .returning({ id: deployBoards.id })
  if (!board) await requireProjectAccess(db, actor, slug, projectId, 20)
}

export function visibleBoard(anchor: string) {
  return and(
    eq(deployBoards.anchor, anchor),
    eq(deployBoards.entityName, 'project'),
    eq(deployBoards.entityIdentifier, projects.id),
    eq(deployBoards.isDisabled, false),
    isNull(deployBoards.deletedAt),
    isNull(projects.deletedAt),
    isNull(projects.archivedAt),
    isNull(workspaces.deletedAt)
  )
}

export function resourceOnBoard(
  db: LancityDb,
  anchor: string,
  projectId: AnySQLiteColumn,
  workspaceId: AnySQLiteColumn,
  comments = false
) {
  return exists(
    db
      .select({ id: deployBoards.id })
      .from(deployBoards)
      .innerJoin(
        projects,
        and(eq(projects.id, deployBoards.projectId), eq(projects.workspaceId, deployBoards.workspaceId))
      )
      .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
      .where(
        and(
          visibleBoard(anchor),
          eq(deployBoards.projectId, projectId),
          eq(deployBoards.workspaceId, workspaceId),
          comments ? eq(deployBoards.isCommentsEnabled, true) : undefined
        )
      )
  )
}

export async function getPublicBoard(db: LancityDb, anchor: string) {
  const { id, name, identifier, description } = await getPublicProjectMeta(db, anchor)
  return { anchor, project: { id, name, identifier, description } }
}

export async function getPublicProjectMeta(db: LancityDb, anchor: string) {
  const [project] = await db
    .select({
      id: projects.id,
      identifier: projects.identifier,
      name: projects.name,
      description: projects.description,
      cover_image: projects.coverImage,
      icon_prop: projects.iconProp,
      emoji: projects.emoji
    })
    .from(deployBoards)
    .innerJoin(
      projects,
      and(eq(projects.id, deployBoards.projectId), eq(projects.workspaceId, deployBoards.workspaceId))
    )
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .where(visibleBoard(anchor))
    .limit(1)
  if (!project) throw new ServiceError(404, 'BOARD_NOT_FOUND', 'Project is not published')
  return project
}

const issueSummaryFields = {
  id: issues.id,
  name: issues.name,
  sequenceId: issues.sequenceId,
  priority: issues.priority,
  stateId: issues.stateId,
  startDate: issues.startDate,
  targetDate: issues.targetDate
}

export function visibleIssues(db: LancityDb, anchor: string, comments = false) {
  return and(
    resourceOnBoard(db, anchor, issues.projectId, issues.workspaceId, comments),
    isNull(issues.deletedAt),
    isNull(issues.archivedAt),
    eq(issues.isDraft, false),
    notExists(
      db
        .select({ id: states.id })
        .from(states)
        .where(and(eq(states.id, issues.stateId), or(eq(states.group, 'triage'), eq(states.isTriage, true))))
    )
  )
}

export async function setPublicationComments(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  enabled: boolean
) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 20)
  const [board] = await db
    .update(deployBoards)
    .set({ isCommentsEnabled: enabled, updatedById: actor.userId })
    .where(
      and(
        eq(deployBoards.projectId, projectId),
        eq(deployBoards.workspaceId, workspace.id),
        eq(deployBoards.entityIdentifier, projectId),
        eq(deployBoards.entityName, 'project'),
        eq(deployBoards.isDisabled, false),
        isNull(deployBoards.deletedAt),
        canManagePublication(actor, slug, projectId)
      )
    )
    .returning({ anchor: deployBoards.anchor, is_comments_enabled: deployBoards.isCommentsEnabled })
  if (!board) throw new ServiceError(404, 'BOARD_NOT_FOUND', 'Project is not published')
  return board
}

/**
 * Board owner settings (PD-1635 context): comments, reactions, votes and the intake that takes public submissions.
 * `setPublicationComments` stays for existing callers.
 */
export async function setPublicationSettings(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  patch: PublicationSettings
) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 20)
  if (patch.intake) {
    const [intake] = await db
      .select({ id: intakes.id })
      .from(intakes)
      .where(and(eq(intakes.id, patch.intake), eq(intakes.projectId, projectId), isNull(intakes.deletedAt)))
      .limit(1)
    if (!intake) throw new ServiceError(400, 'INTAKE_NOT_FOUND', 'Intake does not belong to this project')
  }
  const [board] = await db
    .update(deployBoards)
    .set({
      updatedById: actor.userId,
      ...(patch.is_comments_enabled === undefined ? {} : { isCommentsEnabled: patch.is_comments_enabled }),
      ...(patch.is_reactions_enabled === undefined ? {} : { isReactionsEnabled: patch.is_reactions_enabled }),
      ...(patch.is_votes_enabled === undefined ? {} : { isVotesEnabled: patch.is_votes_enabled }),
      ...(patch.intake === undefined ? {} : { intakeId: patch.intake })
    })
    .where(
      and(
        eq(deployBoards.projectId, projectId),
        eq(deployBoards.workspaceId, workspace.id),
        eq(deployBoards.entityIdentifier, projectId),
        eq(deployBoards.entityName, 'project'),
        eq(deployBoards.isDisabled, false),
        isNull(deployBoards.deletedAt),
        canManagePublication(actor, slug, projectId)
      )
    )
    .returning({
      anchor: deployBoards.anchor,
      is_comments_enabled: deployBoards.isCommentsEnabled,
      is_reactions_enabled: deployBoards.isReactionsEnabled,
      is_votes_enabled: deployBoards.isVotesEnabled,
      intake: deployBoards.intakeId
    })
  if (!board) throw new ServiceError(404, 'BOARD_NOT_FOUND', 'Project is not published')
  return board
}

export async function listPublicIssues(db: LancityDb, anchor: string) {
  await getPublicBoard(db, anchor)
  return db
    .select(issueSummaryFields)
    .from(issues)
    .where(visibleIssues(db, anchor))
    .orderBy(desc(issues.sequenceId))
    .limit(100)
}

export async function getPublicIssue(db: LancityDb, anchor: string, issueId: number) {
  const [issue] = await db
    .select({ ...issueSummaryFields, description: issues.descriptionStripped })
    .from(issues)
    .where(and(visibleIssues(db, anchor), eq(issues.id, issueId)))
    .limit(1)
  if (!issue) throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Issue not found on this board')
  return issue
}

export async function listPublicLabels(db: LancityDb, anchor: string) {
  await getPublicBoard(db, anchor)
  return db
    .select({ id: labels.id, name: labels.name, color: labels.color, parent: labels.parentId })
    .from(labels)
    .where(and(resourceOnBoard(db, anchor, labels.projectId, labels.workspaceId), isNull(labels.deletedAt)))
    .orderBy(asc(labels.sortOrder), asc(labels.id))
}

export async function listPublicStates(db: LancityDb, anchor: string) {
  await getPublicBoard(db, anchor)
  return db
    .select({
      id: states.id,
      name: states.name,
      group: states.group,
      color: states.color,
      sequence: states.sequence
    })
    .from(states)
    .where(
      and(
        resourceOnBoard(db, anchor, states.projectId, states.workspaceId),
        isNull(states.deletedAt),
        ne(states.name, 'Triage'),
        eq(states.isTriage, false)
      )
    )
    .orderBy(asc(states.sequence), asc(states.id))
}

export async function listPublicCycles(db: LancityDb, anchor: string) {
  await getPublicBoard(db, anchor)
  return db
    .select({ id: cycles.id, name: cycles.name })
    .from(cycles)
    .where(and(resourceOnBoard(db, anchor, cycles.projectId, cycles.workspaceId), isNull(cycles.deletedAt)))
    .orderBy(desc(cycles.createdAt), desc(cycles.id))
}

export async function listPublicModules(db: LancityDb, anchor: string) {
  await getPublicBoard(db, anchor)
  return db
    .select({ id: modules.id, name: modules.name })
    .from(modules)
    .where(and(resourceOnBoard(db, anchor, modules.projectId, modules.workspaceId), isNull(modules.deletedAt)))
    .orderBy(desc(modules.createdAt), desc(modules.id))
}
