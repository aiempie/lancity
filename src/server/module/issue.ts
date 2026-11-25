import { outboxStatement } from '@/server/common/outbox'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { issues } from '@/db/schema/issue'
import { moduleIssues, modules } from '@/db/schema/planning'
import { ServiceError } from '@/server/common/errors'
import { pickFields } from '@/server/common/serializers'
import { ISSUE_LIST_SELECT, issueOnResults } from '@/server/issue/filter'
import { issueListContext, LIVE_ISSUES, listWhere, paginateIssues } from '@/server/issue/list'
import { chunk, findModule, moduleContext } from '@/server/module/access'
import { moduleActivityOutbox, publishModuleActivities, type ModuleIssueEvent } from '@/server/module/events'
import { moduleIssueQuery, queryModuleIssueBridges, type ModuleScope } from '@/server/module/queries'
import { requestedFields } from '@/server/module/serializers'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { IssueListQuery } from '@/types/issue/schema'
import type { IssueModulesInput } from '@/types/planning/p2-module-schema'

const ids = (list: readonly number[]) =>
  sql.join(
    list.map(id => sql`${id}`),
    sql`, `
  )

/** Lookups and inserts run in slices: D1 binds at most 100 parameters per statement and a row takes six. */
const LOOKUP_SLICE = 50
const INSERT_SLICE = 10

type Batch = Parameters<LancityDb['batch']>[0]
const runBatch = (db: LancityDb, statements: unknown[]) =>
  statements.length ? db.batch(statements as unknown as Batch) : Promise.resolve()

function insertAssignments(db: LancityDb, scope: ModuleScope, moduleId: number, issueIds: number[], actorId: number) {
  return chunk(issueIds, INSERT_SLICE).map(part =>
    db
      .insert(moduleIssues)
      .values(
        part.map(issueId => ({
          moduleId,
          issueId,
          projectId: scope.projectId,
          workspaceId: scope.workspaceId,
          createdById: actorId,
          updatedById: actorId
        }))
      )
      .onConflictDoNothing()
  )
}

type Assignment = { id: number; issueId: number; moduleId: number; moduleName: string }
async function currentAssignments(db: LancityDb, projectId: number, issueIds: number[]): Promise<Assignment[]> {
  const rows = await Promise.all(
    chunk(issueIds, LOOKUP_SLICE).map(part =>
      db
        .select({
          id: moduleIssues.id,
          issueId: moduleIssues.issueId,
          moduleId: moduleIssues.moduleId,
          moduleName: modules.name
        })
        .from(moduleIssues)
        .innerJoin(modules, eq(modules.id, moduleIssues.moduleId))
        .where(
          and(
            eq(moduleIssues.projectId, projectId),
            inArray(moduleIssues.issueId, part),
            isNull(moduleIssues.deletedAt),
            isNull(modules.deletedAt)
          )
        )
    )
  )
  return rows.flat().sort((a, b) => a.id - b.id)
}

/** Issues of the project that exist (not deleted). `live` limits them to `Issue.issue_objects` (no archived, draft or triage). */
async function existingIssues(db: LancityDb, scope: ModuleScope, issueIds: number[], live: boolean) {
  const found = await Promise.all(
    chunk(issueIds, LOOKUP_SLICE).map(part =>
      live
        ? db.all<{ id: number }>(
            sql`select issues.id as id from issues where issues.project_id = ${scope.projectId}
              and issues.workspace_id = ${scope.workspaceId} and issues.id in (${ids(part)}) and ${LIVE_ISSUES}`
          )
        : db
            .select({ id: issues.id })
            .from(issues)
            .where(
              and(
                eq(issues.projectId, scope.projectId),
                eq(issues.workspaceId, scope.workspaceId),
                inArray(issues.id, part),
                isNull(issues.deletedAt)
              )
            )
    )
  )
  return found.flat().map(row => row.id)
}

/** Legacy list of the assignments with their issue rows (role: project member). */
export async function listModuleIssues(db: LancityDb, actor: Actor, slug: string, projectId: number, moduleId: number) {
  const { scope } = await moduleContext(db, actor, slug, projectId, 15)
  const item = await findModule(db, scope, moduleId)
  return db
    .select({ assignment: moduleIssues, issue: issues })
    .from(moduleIssues)
    .innerJoin(issues, eq(moduleIssues.issueId, issues.id))
    .where(
      and(
        eq(moduleIssues.moduleId, item.id),
        eq(moduleIssues.projectId, projectId),
        isNull(moduleIssues.deletedAt),
        isNull(issues.deletedAt)
      )
    )
}

/**
 * PD-0691 / PD-0692 to PD-0694 `ModuleIssueViewSet.list`: the issue list of the project limited to one module.
 * Filters, ordering, grouping and the cursor come from the shared issue list (`paginateIssues`).
 */
export async function listModuleIssuesPaginated(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  moduleId: number,
  query: IssueListQuery
) {
  const ctx = await issueListContext(db, actor, slug, projectId, 15)
  await findModule(db, { workspaceId: ctx.workspaceId, projectId, userId: actor.userId }, moduleId)
  return paginateIssues(db, ctx, moduleIssueQuery(query, moduleId), 'live')
}

/**
 * PD-0211 / PD-0212 `ModuleIssueListCreateAPIEndpoint.get`: the same list for the external API. Order defaults to
 * `created_at`, every item gets the id of its assignment (`bridgeId`) and `fields` restricts the keys. Restricted
 * guests only see the issues they created.
 */
export async function listModuleIssuesApi(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  moduleId: number,
  query: IssueListQuery
) {
  const ctx = await issueListContext(db, actor, slug, projectId, 5)
  const scope = { workspaceId: ctx.workspaceId, projectId, userId: actor.userId }
  await findModule(db, scope, moduleId)
  const page = await paginateIssues(
    db,
    ctx,
    moduleIssueQuery({ ...query, order_by: query.order_by ?? 'created_at' }, moduleId),
    'live'
  )
  if (!Array.isArray(page.results)) return page
  const items = page.results as { id: number }[]
  const bridges = await queryModuleIssueBridges(
    db,
    scope,
    moduleId,
    items.map(item => item.id)
  )
  const fields = requestedFields({ fields: query.fields })
  return {
    ...page,
    results: items.map(item => pickFields({ ...item, bridgeId: bridges.get(item.id) ?? null }, fields))
  }
}

/**
 * PD-0215 / PD-0216 `ModuleIssueDetailAPIEndpoint.get` and PD-0687 `ModuleIssueViewSet.retrieve`: one issue of the
 * module in the list shape. 404 when the issue is not in the module or the guest may not see it.
 */
export async function getModuleIssueItem(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  moduleId: number,
  issueId: number
) {
  const ctx = await issueListContext(db, actor, slug, projectId, 5)
  const scope = { workspaceId: ctx.workspaceId, projectId, userId: actor.userId }
  await findModule(db, scope, moduleId)
  const where = listWhere(ctx, {}, 'live', [
    sql`issues.id = ${issueId}`,
    sql`exists (select 1 from module_issues x where x.issue_id = issues.id and x.module_id = ${moduleId} and x.deleted_at is null)`
  ])
  const rows = await db.all<Record<string, unknown>>(sql`select ${ISSUE_LIST_SELECT} from issues where ${where}`)
  if (!rows.length) throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Module issue not found')
  const bridges = await queryModuleIssueBridges(db, scope, moduleId, [issueId])
  return { ...issueOnResults(rows)[0], bridgeId: bridges.get(issueId) ?? null }
}

/**
 * PD-0213 `ModuleIssueListCreateAPIEndpoint.post`: put issues into a module. An issue that sits in another module
 * moves to this one (Plane moves its first assignment), the others are added. Every id must be an issue of the project.
 */
export async function assignModuleIssues(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  moduleId: number,
  input: number[]
) {
  const { scope } = await moduleContext(db, actor, slug, projectId, 15)
  const item = await findModule(db, scope, moduleId)
  if (item.archivedAt) throw new ServiceError(400, 'MODULE_ARCHIVED', 'Cannot add issues to an archived module')
  const wanted = [...new Set(input)]
  if ((await existingIssues(db, scope, wanted, false)).length !== wanted.length)
    throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Issue not found in project')
  const byIssue = new Map<number, Assignment[]>()
  for (const row of await currentAssignments(db, projectId, wanted))
    byIssue.set(row.issueId, [...(byIssue.get(row.issueId) ?? []), row])
  const statements: unknown[] = []
  const events: ModuleIssueEvent[] = []
  const created: number[] = []
  for (const issueId of wanted) {
    const rows = byIssue.get(issueId) ?? []
    if (rows.some(row => row.moduleId === moduleId)) continue
    if (rows.length) {
      statements.push(
        db.update(moduleIssues).set({ moduleId, updatedById: actor.userId }).where(eq(moduleIssues.id, rows[0].id))
      )
      events.push({
        type: 'module.activity.deleted',
        issueId,
        moduleId: rows[0].moduleId,
        moduleName: rows[0].moduleName
      })
    } else created.push(issueId)
    events.push({ type: 'module.activity.created', issueId, moduleId })
  }
  statements.push(...insertAssignments(db, scope, moduleId, created, actor.userId))
  const outbox = moduleActivityOutbox(db, actor.userId, projectId, events)
  await runBatch(db, [...statements, ...outbox.statements])
  await publishModuleActivities(db, outbox.keys)
}

/**
 * PD-0695 `ModuleIssueViewSet.create_module_issues`: add issues to a module. Ids that are not live issues of the
 * project are ignored and issues already in the module are left alone. An issue may sit in several modules.
 */
export async function createModuleIssues(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  moduleId: number,
  input: number[]
) {
  const { scope } = await moduleContext(db, actor, slug, projectId, 15)
  await findModule(db, scope, moduleId)
  const found = await existingIssues(db, scope, [...new Set(input)], true)
  const already = new Set(
    (
      await Promise.all(
        chunk(found, LOOKUP_SLICE).map(part =>
          db
            .select({ issueId: moduleIssues.issueId })
            .from(moduleIssues)
            .where(
              and(
                eq(moduleIssues.moduleId, moduleId),
                inArray(moduleIssues.issueId, part),
                isNull(moduleIssues.deletedAt)
              )
            )
        )
      )
    )
      .flat()
      .map(row => row.issueId)
  )
  const created = found.filter(issueId => !already.has(issueId))
  const outbox = moduleActivityOutbox(db, actor.userId, projectId,
    created.map(issueId => ({ type: 'module.activity.created' as const, issueId, moduleId })))
  await runBatch(db, [...insertAssignments(db, scope, moduleId, created, actor.userId), ...outbox.statements])
  await publishModuleActivities(db, outbox.keys)
  return { added: created.length }
}

/**
 * PD-0696 `ModuleIssueViewSet.create_issue_modules`: add one issue to several modules and remove it from others in
 * one call. Modules outside the project are ignored.
 */
export async function createIssueModules(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  input: IssueModulesInput
) {
  const { scope } = await moduleContext(db, actor, slug, projectId, 15)
  const [issue] = await db
    .select({ id: issues.id })
    .from(issues)
    .where(
      and(
        eq(issues.id, issueId),
        eq(issues.projectId, projectId),
        eq(issues.workspaceId, scope.workspaceId),
        isNull(issues.deletedAt)
      )
    )
  if (!issue) throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Issue not found')
  const projectModules = async (wanted: number[]) =>
    (
      await Promise.all(
        chunk([...new Set(wanted)], LOOKUP_SLICE).map(part =>
          db
            .select({ id: modules.id, name: modules.name })
            .from(modules)
            .where(
              and(
                eq(modules.projectId, projectId),
                eq(modules.workspaceId, scope.workspaceId),
                inArray(modules.id, part),
                isNull(modules.deletedAt)
              )
            )
        )
      )
    ).flat()
  const [toAdd, toRemove] = await Promise.all([projectModules(input.modules), projectModules(input.removed_modules)])
  const current = new Map((await currentAssignments(db, projectId, [issueId])).map(row => [row.moduleId, row]))
  const added = toAdd.filter(item => !current.has(item.id))
  const removed = toRemove.flatMap(item =>
    current.has(item.id) ? [{ ...item, assignmentId: current.get(item.id)!.id }] : []
  )
  const statements: unknown[] = [
    ...chunk(added, INSERT_SLICE).map(part =>
      db
        .insert(moduleIssues)
        .values(
          part.map(item => ({
            moduleId: item.id,
            issueId,
            projectId,
            workspaceId: scope.workspaceId,
            createdById: actor.userId,
            updatedById: actor.userId
          }))
        )
        .onConflictDoNothing()
    ),
    ...chunk(removed, LOOKUP_SLICE).map(part =>
      db.delete(moduleIssues).where(
        inArray(
          moduleIssues.id,
          part.map(item => item.assignmentId)
        )
      )
    )
  ]
  const outbox = moduleActivityOutbox(db, actor.userId, projectId, [
    ...added.map(item => ({ type: 'module.activity.created' as const, issueId, moduleId: item.id })),
    ...removed.map(item => ({
      type: 'module.activity.deleted' as const,
      issueId,
      moduleId: item.id,
      moduleName: item.name
    }))
  ])
  await runBatch(db, [...statements, ...outbox.statements])
  await publishModuleActivities(db, outbox.keys)
  return { added: added.length, removed: removed.length }
}

/**
 * PD-0697 `ModuleIssueViewSet.destroy` and PD-0217 `ModuleIssueDetailAPIEndpoint.delete`: take an issue out of a
 * module. The API answers 404 for an issue that is not in the module, the app (`ignoreMissing`) answers 204.
 */
export async function removeModuleIssue(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  moduleId: number,
  issueId: number,
  options: { ignoreMissing?: boolean } = {}
) {
  const { scope } = await moduleContext(db, actor, slug, projectId, 15)
  const item = await findModule(db, scope, moduleId)
  const outbox = moduleActivityOutbox(db, actor.userId, projectId, [
    { type: 'module.activity.deleted', issueId, moduleId, moduleName: item.name }
  ])
  const [removed] = await db.batch([db
    .delete(moduleIssues)
    .where(
      and(
        eq(moduleIssues.moduleId, moduleId),
        eq(moduleIssues.projectId, projectId),
        eq(moduleIssues.issueId, issueId),
        isNull(moduleIssues.deletedAt)
      )
    )
    .returning({ id: moduleIssues.id }), outboxStatement(db, outbox.keys[0], 'issue.activity', {
      type: 'module.activity.deleted', issueId, projectId, actorId: actor.userId,
      requestedData: { module_id: moduleId }, currentInstance: { module_name: item.name },
      notification: true, epoch: Math.floor(Date.now() / 1000)
    }, sql`changes() = 1`)])
  if (!removed.length) {
    if (options.ignoreMissing) return
    throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Module issue not found')
  }
  await publishModuleActivities(db, outbox.keys)
}
