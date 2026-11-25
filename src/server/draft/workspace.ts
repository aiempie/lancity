import { outboxStatement, publishOutbox } from '@/server/common/outbox'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { fileAssets } from '@/db/schema/content'
import { labels } from '@/db/schema/issue'
import {
  cycleIssues,
  cycles,
  draftIssueAssignees,
  draftIssueCycles,
  draftIssueLabels,
  draftIssueModules,
  draftIssues,
  issueTypes,
  moduleIssues,
  modules
} from '@/db/schema/planning'
import { projectMembers, workspaceMembers, workspaces } from '@/db/schema/workspace'
import { parseInput } from '@/server/api/v1/validation'
import { forbiddenError, notFoundError, ServiceError } from '@/server/common/errors'
import { OffsetPaginator, paginate } from '@/server/common/pagination'
import { requireWorkspaceRole, ROLE } from '@/server/common/permissions'
import { draftSortOrderSql, saveDraftIssue } from '@/server/draft/model-rules'
import { toDraftIssueDetailResponse, toDraftIssueResponse } from '@/server/draft/presenters'
import { draftFilters, findDraft, findDraftRow, queryWorkspaceDraftIssue } from '@/server/draft/queries'
import { sanitizeDescriptionHtml, stripTags } from '@/server/issue/sequence'
import { createIssue, runBatch } from '@/server/issue/service'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { IssueActivityJob } from '@/types/issue/p1-issue-background-schema'
import {
  createWorkspaceDraftInputSchema,
  draftToIssueInputSchema,
  updateWorkspaceDraftInputSchema,
  type CreateWorkspaceDraftInput
} from '@/types/planning/p2-draft-schema'

type Statement = BatchItem<'sqlite'>
type Query = Record<string, string | undefined>
const ALL_ROLES = [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST]
const BATCH_ROWS = 10 // rows per insert: D1 allows 100 bind parameters per statement

/**
 * PD-0882 `can_write_project`: an active admin or member of the project (which must belong to the URL workspace), or a
 * workspace admin who is an active member of the project at any role.
 */
export async function canWriteProject(db: LancityDb, actor: Actor, slug: string, projectId: number): Promise<boolean> {
  const [row] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(workspaces, eq(workspaces.id, projectMembers.workspaceId))
    .where(
      and(
        eq(workspaces.slug, slug),
        isNull(workspaces.deletedAt),
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.memberId, actor.userId),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt)
      )
    )
    .limit(1)
  if (!row) return false
  if (row.role === ROLE.ADMIN || row.role === ROLE.MEMBER) return true
  const [admin] = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaces.slug, slug),
        eq(workspaceMembers.memberId, actor.userId),
        eq(workspaceMembers.role, ROLE.ADMIN),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt)
      )
    )
    .limit(1)
  return Boolean(admin)
}

/** PD-0307 `check_cycle_and_modules`: the cycle and every module must belong to the project and workspace. */
export async function checkCycleAndModules(
  db: LancityDb,
  cycleId: number | null | undefined,
  moduleIds: number[] | undefined,
  projectId: number | null,
  workspaceId: number
) {
  if (cycleId) {
    const [cycle] = projectId
      ? await db
          .select({ id: cycles.id })
          .from(cycles)
          .where(
            and(
              eq(cycles.id, cycleId),
              eq(cycles.projectId, projectId),
              eq(cycles.workspaceId, workspaceId),
              isNull(cycles.deletedAt)
            )
          )
      : []
    if (!cycle) throw new ServiceError(400, 'VALIDATION_ERROR', 'Cycle is not valid please pass a valid cycle_id')
  }
  const unique = [...new Set(moduleIds ?? [])]
  if (unique.length) {
    const found = projectId
      ? await db
          .select({ id: modules.id })
          .from(modules)
          .where(
            and(
              inArray(modules.id, unique),
              eq(modules.projectId, projectId),
              eq(modules.workspaceId, workspaceId),
              isNull(modules.deletedAt)
            )
          )
      : []
    if (found.length !== unique.length)
      throw new ServiceError(400, 'VALIDATION_ERROR', 'Modules are not valid please pass valid module_ids')
  }
}

type DraftRelations = Pick<
  CreateWorkspaceDraftInput,
  'state_id' | 'parent_id' | 'estimate_point_id' | 'type_id' | 'label_ids' | 'assignee_ids' | 'cycle_id' | 'module_ids'
>

/**
 * PD-0306 `DraftIssueCreateSerializer.validate` (the part that reads D1): assignees keep only active project members
 * above guest, labels keep only the project's labels; state, parent and estimate point must belong to the project.
 */
async function validateRelations(db: LancityDb, workspaceId: number, projectId: number | null, input: DraftRelations) {
  const bad = (message: string) => new ServiceError(400, 'VALIDATION_ERROR', message)
  const owns = async (table: 'states' | 'issues' | 'estimate_points', id: number) =>
    projectId !== null &&
    (
      await db.all<{
        one: number
      }>(sql`select 1 as one from ${sql.raw(table)} where id = ${id} and project_id = ${projectId} and deleted_at is null
      ${table === 'states' ? sql`and is_triage = 0` : sql``} limit 1`)
    ).length > 0
  if (input.state_id && !(await owns('states', input.state_id)))
    throw bad('State is not valid please pass a valid state_id')
  if (input.parent_id && !(await owns('issues', input.parent_id)))
    throw bad('Parent is not valid issue_id please pass a valid issue_id')
  if (input.estimate_point_id && !(await owns('estimate_points', input.estimate_point_id)))
    throw bad('Estimate point is not valid please pass a valid estimate_point_id')
  if (input.type_id) {
    const [type] = await db
      .select({ id: issueTypes.id })
      .from(issueTypes)
      .where(
        and(eq(issueTypes.id, input.type_id), eq(issueTypes.workspaceId, workspaceId), isNull(issueTypes.deletedAt))
      )
    if (!type) throw bad('Issue type does not belong to this workspace')
  }
  await checkCycleAndModules(db, input.cycle_id, input.module_ids, projectId, workspaceId)
  const assigneeIds =
    input.assignee_ids?.length && projectId !== null
      ? (
          await db
            .select({ id: projectMembers.memberId })
            .from(projectMembers)
            .where(
              and(
                eq(projectMembers.projectId, projectId),
                inArray(projectMembers.memberId, input.assignee_ids),
                eq(projectMembers.isActive, true),
                isNull(projectMembers.deletedAt),
                sql`${projectMembers.role} >= ${ROLE.MEMBER}`
              )
            )
        ).flatMap(row => (row.id === null ? [] : [row.id]))
      : []
  const labelIds =
    input.label_ids?.length && projectId !== null
      ? (
          await db
            .select({ id: labels.id })
            .from(labels)
            .where(and(eq(labels.projectId, projectId), inArray(labels.id, input.label_ids), isNull(labels.deletedAt)))
        ).map(row => row.id)
      : []
  return { assigneeIds, labelIds }
}

type LinkInput = {
  draftId: ReturnType<typeof sql<number>> | number
  workspaceId: number
  projectId: number | null
  actor: Actor
  assigneeIds?: number[]
  labelIds?: number[]
  cycleId?: number | null
  moduleIds?: number[]
}

/** Inserts of the draft's assignee, label, cycle and module links (`DraftIssueCreateSerializer.create`). */
function linkStatements(db: LancityDb, input: LinkInput) {
  const base = {
    draftIssueId: input.draftId as number,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    createdById: input.actor.userId,
    updatedById: input.actor.userId
  }
  const statements: Statement[] = []
  const chunks = <T>(items: T[]) =>
    Array.from({ length: Math.ceil(items.length / BATCH_ROWS) }, (_, i) =>
      items.slice(i * BATCH_ROWS, (i + 1) * BATCH_ROWS)
    )
  for (const part of chunks([...new Set(input.assigneeIds ?? [])]))
    statements.push(db.insert(draftIssueAssignees).values(part.map(assigneeId => ({ ...base, assigneeId }))))
  for (const part of chunks([...new Set(input.labelIds ?? [])]))
    statements.push(db.insert(draftIssueLabels).values(part.map(labelId => ({ ...base, labelId }))))
  if (input.cycleId) statements.push(db.insert(draftIssueCycles).values({ ...base, cycleId: input.cycleId }))
  for (const part of chunks([...new Set(input.moduleIds ?? [])]))
    statements.push(db.insert(draftIssueModules).values(part.map(moduleId => ({ ...base, moduleId }))))
  return statements
}

/** Soft delete the live link rows of a draft (all of them, or one kind). */
function unlinkStatements(db: LancityDb, draftId: number, only?: 'assignees' | 'labels' | 'cycle' | 'modules') {
  const at = { deletedAt: new Date() }
  const all = {
    assignees: () =>
      db
        .update(draftIssueAssignees)
        .set(at)
        .where(and(eq(draftIssueAssignees.draftIssueId, draftId), isNull(draftIssueAssignees.deletedAt))),
    labels: () =>
      db
        .update(draftIssueLabels)
        .set(at)
        .where(and(eq(draftIssueLabels.draftIssueId, draftId), isNull(draftIssueLabels.deletedAt))),
    cycle: () =>
      db
        .update(draftIssueCycles)
        .set(at)
        .where(and(eq(draftIssueCycles.draftIssueId, draftId), isNull(draftIssueCycles.deletedAt))),
    modules: () =>
      db
        .update(draftIssueModules)
        .set(at)
        .where(and(eq(draftIssueModules.draftIssueId, draftId), isNull(draftIssueModules.deletedAt)))
  }
  return (only ? [only] : (Object.keys(all) as (keyof typeof all)[])).map(key => all[key]() as Statement)
}

// ---------------------------------------------------------------------------------------------------------------

/** PD-0884, PD-0885 `WorkspaceDraftIssueViewSet.list`: the caller's drafts, newest first, paginated. */
export async function listWorkspaceDraftIssues(db: LancityDb, actor: Actor, slug: string, query: Query = {}) {
  const { workspaceId } = await requireWorkspaceRole(db, actor, slug, ALL_ROLES)
  const source = queryWorkspaceDraftIssue(db, workspaceId, actor.userId, draftFilters(query))
  return paginate(query, {
    paginator: new OffsetPaginator({
      orderBy: '-created_at',
      count: source.count,
      fetch: async (offset, limit) => (await source.page(offset, limit)).map(toDraftIssueResponse)
    })
  })
}

/** PD-0886, PD-0308 `WorkspaceDraftIssueViewSet.create`. A draft may have no project. */
export async function createWorkspaceDraftIssue(db: LancityDb, actor: Actor, slug: string, raw: unknown) {
  const input = parseInput(createWorkspaceDraftInputSchema, raw)
  const { workspaceId } = await requireWorkspaceRole(db, actor, slug, ALL_ROLES)
  const projectId = input.project_id ?? null
  if (projectId && !(await canWriteProject(db, actor, slug, projectId))) throw forbiddenError()
  const { assigneeIds, labelIds } = await validateRelations(db, workspaceId, projectId, input)
  const html = sanitizeDescriptionHtml(input.description_html ?? '<p></p>')
  const rules = await saveDraftIssue(db, { projectId, stateId: input.state_id ?? null, descriptionHtml: html })
  // The batch is atomic, so this user's newest draft id is the row inserted by its first statement.
  const draftId = sql<number>`(select max(id) from draft_issues where created_by_id = ${actor.userId})`
  const results = await runBatch(db, [
    db
      .insert(draftIssues)
      .values({
        name: input.name ?? null,
        descriptionHtml: html,
        descriptionStripped: rules.descriptionStripped,
        ...(input.description_json === undefined ? {} : { descriptionJson: input.description_json }),
        priority: input.priority ?? 'none',
        startDate: input.start_date ?? null,
        targetDate: input.target_date ?? null,
        sortOrder: draftSortOrderSql(projectId, rules.stateId),
        completedAt: rules.completedAt ?? null,
        estimatePointId: input.estimate_point_id ?? null,
        parentId: input.parent_id ?? null,
        projectId,
        stateId: rules.stateId,
        typeId: input.type_id ?? null,
        workspaceId,
        createdById: actor.userId,
        updatedById: actor.userId
      })
      .returning({ id: draftIssues.id }),
    ...linkStatements(db, {
      draftId,
      workspaceId,
      projectId,
      actor,
      assigneeIds,
      labelIds,
      cycleId: input.cycle_id,
      moduleIds: input.module_ids
    })
  ])
  const [created] = results[0] as { id: number }[]
  const row = await findDraftRow(db, workspaceId, actor.userId, created.id)
  return toDraftIssueResponse(row!)
}

/** PD-0888 `WorkspaceDraftIssueViewSet.retrieve`: only the creator reads a draft. */
export async function getWorkspaceDraftIssue(db: LancityDb, actor: Actor, slug: string, draftId: number) {
  const { workspaceId } = await requireWorkspaceRole(db, actor, slug, ALL_ROLES)
  const row = await findDraftRow(db, workspaceId, actor.userId, draftId)
  if (!row) throw notFoundError()
  return toDraftIssueDetailResponse(row)
}

/**
 * PD-0887, PD-0309 `WorkspaceDraftIssueViewSet.partial_update`. The draft stays in its own project. Supplying
 * `assignee_ids`, `label_ids` or `module_ids` replaces the whole set; `cycle_id` (even null) replaces the cycle.
 */
export async function updateWorkspaceDraftIssue(
  db: LancityDb,
  actor: Actor,
  slug: string,
  draftId: number,
  raw: unknown
) {
  const input = parseInput(updateWorkspaceDraftInputSchema, raw)
  // Plane `partial_update` allows ADMIN and MEMBER only; its creator shortcut checks the wrong model and never matches.
  const { workspaceId } = await requireWorkspaceRole(db, actor, slug, [ROLE.ADMIN, ROLE.MEMBER])
  const draft = await findDraft(db, workspaceId, draftId)
  if (!draft || draft.createdById !== actor.userId) throw notFoundError('Issue not found')
  for (const projectId of new Set(
    [draft.projectId, input.project_id ?? draft.projectId].filter((id): id is number => Boolean(id))
  ))
    if (!(await canWriteProject(db, actor, slug, projectId))) throw forbiddenError()
  const { assigneeIds, labelIds } = await validateRelations(db, workspaceId, draft.projectId, input)
  const html =
    input.description_html === undefined
      ? draft.descriptionHtml
      : sanitizeDescriptionHtml(input.description_html ?? '<p></p>')
  const rules = await saveDraftIssue(db, {
    projectId: draft.projectId,
    stateId: input.state_id === undefined ? draft.stateId : input.state_id,
    descriptionHtml: html
  })
  const statements: Statement[] = [
    db
      .update(draftIssues)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description_html === undefined
          ? {}
          : { descriptionHtml: html, descriptionStripped: stripTags(html) }),
        ...(input.description_json === undefined ? {} : { descriptionJson: input.description_json }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.start_date === undefined ? {} : { startDate: input.start_date }),
        ...(input.target_date === undefined ? {} : { targetDate: input.target_date }),
        ...(input.parent_id === undefined ? {} : { parentId: input.parent_id }),
        ...(input.estimate_point_id === undefined ? {} : { estimatePointId: input.estimate_point_id }),
        ...(input.type_id === undefined ? {} : { typeId: input.type_id }),
        stateId: rules.stateId,
        ...(rules.completedAt === undefined ? {} : { completedAt: rules.completedAt }),
        updatedById: actor.userId
      })
      .where(and(eq(draftIssues.id, draftId), isNull(draftIssues.deletedAt)))
  ]
  const link = { draftId, workspaceId, projectId: draft.projectId, actor }
  if (input.assignee_ids !== undefined)
    statements.push(...unlinkStatements(db, draftId, 'assignees'), ...linkStatements(db, { ...link, assigneeIds }))
  if (input.label_ids !== undefined)
    statements.push(...unlinkStatements(db, draftId, 'labels'), ...linkStatements(db, { ...link, labelIds }))
  if (input.cycle_id !== undefined)
    statements.push(
      ...unlinkStatements(db, draftId, 'cycle'),
      ...linkStatements(db, { ...link, cycleId: input.cycle_id })
    )
  if (input.module_ids !== undefined)
    statements.push(
      ...unlinkStatements(db, draftId, 'modules'),
      ...linkStatements(db, { ...link, moduleIds: input.module_ids })
    )
  await runBatch(db, statements)
}

/** PD-0889 `WorkspaceDraftIssueViewSet.destroy`: the creator or a workspace admin. */
export async function deleteWorkspaceDraftIssue(db: LancityDb, actor: Actor, slug: string, draftId: number) {
  const { workspaceId, workspaceRole } = await requireWorkspaceRole(db, actor, slug, ALL_ROLES)
  const draft = await findDraft(db, workspaceId, draftId)
  if (!draft) throw notFoundError()
  if (workspaceRole !== ROLE.ADMIN && draft.createdById !== actor.userId) throw forbiddenError()
  await runBatch(db, [
    db.update(draftIssues).set({ deletedAt: new Date(), updatedById: actor.userId }).where(eq(draftIssues.id, draftId)),
    ...unlinkStatements(db, draftId)
  ])
}

/**
 * PD-0890 `create_draft_to_issue`: turn the caller's draft into a work item. As in Plane the issue is built from the
 * request body, not from the stored draft. The cycle, modules and uploaded assets move to the new issue and the
 * draft is deleted. The issue itself is created through the issue service, the follow-up writes are one more batch.
 */
export async function createDraftToIssue(db: LancityDb, actor: Actor, slug: string, draftId: number, raw: unknown) {
  const { workspaceId } = await requireWorkspaceRole(db, actor, slug, [ROLE.ADMIN, ROLE.MEMBER])
  const draft = await findDraft(db, workspaceId, draftId)
  if (!draft || draft.createdById !== actor.userId) throw notFoundError()
  if (!draft.projectId) throw new ServiceError(400, 'PROJECT_REQUIRED', 'Project is required to create an issue.')
  const projectId = draft.projectId
  if (!(await canWriteProject(db, actor, slug, projectId))) throw forbiddenError()
  const input = parseInput(draftToIssueInputSchema, raw)
  await checkCycleAndModules(db, input.cycle_id, input.module_ids, projectId, workspaceId)
  const issue = await createIssue(db, actor, slug, projectId, {
    name: input.name,
    ...(input.priority === undefined ? {} : { priority: input.priority }),
    ...(input.description_html ? { descriptionHtml: input.description_html } : {}),
    ...(input.description_json === undefined ? {} : { descriptionJson: input.description_json }),
    ...(input.start_date === undefined ? {} : { startDate: input.start_date }),
    ...(input.target_date === undefined ? {} : { targetDate: input.target_date }),
    ...(input.state_id === undefined ? {} : { stateId: input.state_id }),
    ...(input.parent_id === undefined ? {} : { parentId: input.parent_id }),
    ...(input.estimate_point_id === undefined ? {} : { estimatePointId: input.estimate_point_id }),
    ...(input.type_id === undefined ? {} : { typeId: input.type_id }),
    ...(input.assignee_ids === undefined ? {} : { assigneeIds: input.assignee_ids }),
    ...(input.label_ids === undefined ? {} : { labelIds: input.label_ids })
  })
  const owner = {
    projectId,
    workspaceId: draft.workspaceId,
    createdById: draft.createdById,
    updatedById: draft.updatedById
  }
  const moduleIdList = [...new Set(input.module_ids ?? [])]
  const statements: Statement[] = [
    ...(input.cycle_id
      ? [db.insert(cycleIssues).values({ ...owner, cycleId: input.cycle_id, issueId: issue.id })]
      : []),
    ...(moduleIdList.length
      ? [db.insert(moduleIssues).values(moduleIdList.map(moduleId => ({ ...owner, moduleId, issueId: issue.id })))]
      : []),
    db
      .update(fileAssets)
      .set({ issueId: issue.id, entityType: 'ISSUE_DESCRIPTION', draftIssueId: null })
      .where(eq(fileAssets.draftIssueId, draftId)),
    db.update(draftIssues).set({ deletedAt: new Date(), updatedById: actor.userId }).where(eq(draftIssues.id, draftId)),
    ...unlinkStatements(db, draftId)
  ]
  const epoch = Math.floor(Date.now() / 1000)
  const jobs: IssueActivityJob[] = [
    ...(input.cycle_id
      ? [
          {
            type: 'cycle.activity.created',
            requestedData: null,
            currentInstance: {
              updated_cycle_issues: null,
              created_cycle_issues: [{ fields: { issue: issue.id, cycle: input.cycle_id } }]
            },
            issueId: null,
            actorId: actor.userId,
            projectId,
            epoch,
            notification: true
          }
        ]
      : []),
    ...moduleIdList.map(moduleId => ({
      type: 'module.activity.created',
      requestedData: { module_id: moduleId },
      currentInstance: null,
      issueId: issue.id,
      actorId: actor.userId,
      projectId,
      epoch,
      notification: true
    }))
  ]
  const keys = jobs.map(() => crypto.randomUUID())
  statements.push(...jobs.map((job, index) => outboxStatement(db, keys[index], 'issue.activity', job)))
  await runBatch(db, statements)
  for (const key of keys) await publishOutbox(db, key)
  return issue
}
