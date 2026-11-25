import { and, eq, isNull, notInArray, sql } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { userFavorites, userRecentVisits } from '@/db/schema/notification'
import {
  draftIssueModules,
  moduleIssues,
  moduleLinks,
  moduleMembers,
  moduleUserProperties,
  modules
} from '@/db/schema/planning'
import { ServiceError } from '@/server/common/errors'
import { requireProjectRole, requireWorkspaceRole, ROLE } from '@/server/common/permissions'
import { recordRecentVisit } from '@/server/workspace/recent-visit'
import { activeProjectMemberIds, chunk, findModule, moduleContext } from '@/server/module/access'
import { buildModuleDetail, paginateModules, projectUsesPoints, shapeModuleApi } from '@/server/module/detail'
import { moduleActivityOutbox, publishModuleActivities, emitModuleModelActivity } from '@/server/module/events'
import { saveModule } from '@/server/module/model-rules'
import { toModuleLite, toModuleRecord, type ModuleRecord } from '@/server/module/presenters'
import { moduleOrderBy, queryModules, queryWorkspaceModules, type ModuleScope } from '@/server/module/queries'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { RecordRecentVisit } from '@/types/workspace/schema'
import type { ModuleListQuery, ModuleUpdateInput, ModuleWriteInput } from '@/types/planning/p2-module-schema'

export * from '@/server/module/issue'
export * from '@/server/module/favorite'
export * from '@/server/module/link'
export * from '@/server/module/user-properties'

async function loadRecord(db: LancityDb, scope: ModuleScope, moduleId: number): Promise<ModuleRecord> {
  const [row] = await queryModules(db, scope, { moduleId, archived: 'any' })
  if (!row) throw new ServiceError(404, 'MODULE_NOT_FOUND', 'Module not found')
  return toModuleRecord(row)
}

/** PD-0668 `ModuleViewSet.list`: the live modules of the project, favorites first, then newest first. */
export async function listModules(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { scope } = await moduleContext(db, actor, slug, projectId)
  const rows = await queryModules(db, scope, { orderBy: moduleOrderBy(undefined, { favoriteFirst: true }) })
  return rows.map(toModuleRecord)
}

/** PD-0202 / PD-0203 `ModuleListCreateAPIEndpoint.get`: paginated live modules with `fields` and `expand`. */
export async function listModulesPaginated(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  query: ModuleListQuery
) {
  const { scope } = await moduleContext(db, actor, slug, projectId)
  return paginateModules(db, scope, query, {}, row => shapeModuleApi(db, row, query))
}

/** PD-0204 / PD-0205 `ModuleListLiteAPIEndpoint.get`: paginated lightweight modules for pickers. */
export async function listModulesLite(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  query: ModuleListQuery
) {
  const { scope } = await moduleContext(db, actor, slug, projectId)
  return paginateModules(db, scope, query, {}, toModuleLite)
}

/** The raw module row. Callers that only need to know the module exists and its role gate use this. */
export async function getModule(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  moduleId: number,
  minimumRole: 5 | 15 | 20 = 5
) {
  const { scope } = await moduleContext(db, actor, slug, projectId, minimumRole)
  return findModule(db, scope, moduleId)
}

/** PD-0208 `ModuleDetailAPIEndpoint.get`: one live module with `fields` and `expand`. */
export async function getModuleApi(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  moduleId: number,
  query: Pick<ModuleListQuery, 'fields' | 'expand'> = {}
) {
  const { scope } = await moduleContext(db, actor, slug, projectId)
  const [row] = await queryModules(db, scope, { moduleId })
  if (!row) throw new ServiceError(404, 'MODULE_NOT_FOUND', 'Module not found')
  return shapeModuleApi(db, row, query)
}

/**
 * PD-0669 `ModuleViewSet.retrieve`: the module detail with links, sub issue count, distributions and completion
 * charts. Archived modules are not found here. The visit is recorded for the recent list.
 */
export async function getModuleDetail(db: LancityDb, actor: Actor, slug: string, projectId: number, moduleId: number) {
  const { scope, project } = await moduleContext(db, actor, slug, projectId)
  const [row] = await queryModules(db, scope, { moduleId })
  if (!row) throw new ServiceError(404, 'MODULE_NOT_FOUND', 'Module not found')
  const detail = await buildModuleDetail(db, scope, row, {
    points: await projectUsesPoints(db, project.estimateId),
    chartNeedsIssues: true
  })
  try {
    await recordRecentVisit(db, {
      // The recent visit schema lists issue, page and project only, but the column accepts any entity name.
      entity_name: 'module' as RecordRecentVisit['entity_name'],
      entity_identifier: moduleId,
      project_id: projectId,
      userId: actor.userId,
      workspaceId: scope.workspaceId
    })
  } catch (error) {
    console.error(JSON.stringify({ level: 'warn', label: 'module.recent_visit', message: String(error) }))
  }
  return detail
}

type Lead = { leadId: number | null | undefined; memberIds: number[] | undefined }
/** Plane lets any user lead; Lancity only accepts active members of the project. */
async function validatePeople(db: LancityDb, projectId: number, { leadId, memberIds }: Lead) {
  const wanted = [...(leadId ? [leadId] : []), ...(memberIds ?? [])]
  const valid = new Set(wanted.length ? await activeProjectMemberIds(db, projectId, wanted) : [])
  if (leadId && !valid.has(leadId)) throw new ServiceError(400, 'INVALID_LEAD', 'Lead must be a member of the project')
  // PD-0035 ModuleCreateSerializer.validate keeps only the project members; others are dropped silently.
  return memberIds === undefined ? undefined : [...new Set(memberIds)].filter(id => valid.has(id))
}

async function assertUniqueName(db: LancityDb, projectId: number, name: string, exceptId?: number) {
  const [existing] = await db
    .select({ id: modules.id })
    .from(modules)
    .where(and(eq(modules.projectId, projectId), eq(modules.name, name), isNull(modules.deletedAt)))
  if (existing && existing.id !== exceptId)
    throw new ServiceError(409, 'MODULE_NAME_ALREADY_EXISTS', 'Module name already exists', { id: existing.id })
}

async function assertUniqueExternalId(
  db: LancityDb,
  projectId: number,
  externalSource: string | null | undefined,
  externalId: string | null | undefined,
  exceptId?: number
) {
  if (!externalId || !externalSource) return
  const [existing] = await db
    .select({ id: modules.id })
    .from(modules)
    .where(
      and(
        eq(modules.projectId, projectId),
        eq(modules.externalSource, externalSource),
        eq(modules.externalId, externalId),
        isNull(modules.deletedAt)
      )
    )
  if (existing && existing.id !== exceptId)
    throw new ServiceError(
      409,
      'EXTERNAL_ID_EXISTS',
      'Module with the same external id and external source already exists',
      {
        id: existing.id
      }
    )
}

/**
 * PD-0667 `ModuleViewSet.create`, PD-0201 `ModuleListCreateAPIEndpoint.post`, PD-0036 and PD-0341: create a
 * module and its members. The sort order puts it first (PD-1448). Without `lead_id` the creator leads the module.
 * The webhook job (`model_activity`) is queued after the write.
 */
export async function createModule(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  input: ModuleWriteInput
) {
  const { workspace, project, scope } = await moduleContext(db, actor, slug, projectId, 15)
  if (!project.moduleView) throw new ServiceError(400, 'MODULES_DISABLED', 'Modules are not enabled for this project')
  await assertUniqueName(db, projectId, input.name)
  await assertUniqueExternalId(db, projectId, input.external_source, input.external_id)
  const leadId = input.lead_id === undefined ? actor.userId : input.lead_id
  const memberIds = await validatePeople(db, projectId, { leadId, memberIds: input.member_ids })
  const sortOrder = input.sort_order ?? (await saveModule(db, projectId))
  const insert = db
    .insert(modules)
    .values({
      name: input.name,
      description: input.description ?? '',
      descriptionText: input.description_text,
      descriptionHtml: input.description_html,
      startDate: input.start_date,
      targetDate: input.target_date,
      status: input.status,
      leadId,
      viewProps: input.view_props,
      sortOrder,
      externalSource: input.external_source,
      externalId: input.external_id,
      logoProps: input.logo_props,
      projectId,
      workspaceId: workspace.id,
      createdById: actor.userId,
      updatedById: actor.userId
    })
    .returning({ id: modules.id })
  const moduleOfName = sql<number>`(select id from modules where project_id = ${projectId} and name = ${input.name} and deleted_at is null)`
  const memberInserts = chunk(memberIds ?? [], 10).map(part =>
    db
      .insert(moduleMembers)
      .values(
        part.map(memberId => ({
          moduleId: moduleOfName,
          memberId,
          projectId,
          workspaceId: workspace.id,
          createdById: actor.userId,
          updatedById: actor.userId
        }))
      )
      .onConflictDoNothing()
  )
  const result = await db.batch([insert, ...memberInserts] as unknown as Parameters<typeof db.batch>[0])
  const created = (result[0] as unknown as { id: number }[])[0]
  await emitModuleModelActivity({
    moduleId: created.id,
    requestedData: input,
    currentInstance: null,
    actorId: actor.userId,
    slug
  })
  return loadRecord(db, scope, created.id)
}

/**
 * PD-0670 `ModuleViewSet.partial_update`, PD-0664 (PUT), PD-0207 `ModuleDetailAPIEndpoint.patch`, PD-0037 and
 * PD-0342: update a module. Archived modules are read only. `member_ids` replaces the member list.
 */
export async function updateModule(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  moduleId: number,
  input: ModuleUpdateInput
) {
  const { project, scope } = await moduleContext(db, actor, slug, projectId, 15)
  const item = await findModule(db, scope, moduleId)
  if (item.archivedAt) throw new ServiceError(400, 'MODULE_ARCHIVED', 'Archived module cannot be updated')
  if (!project.moduleView) throw new ServiceError(400, 'MODULES_DISABLED', 'Modules are not enabled for this project')
  if (input.name && input.name !== item.name) await assertUniqueName(db, projectId, input.name, item.id)
  if (input.external_id && input.external_id !== item.externalId)
    await assertUniqueExternalId(
      db,
      projectId,
      input.external_source ?? item.externalSource,
      input.external_id,
      item.id
    )
  const start = input.start_date === undefined ? item.startDate : input.start_date
  const end = input.target_date === undefined ? item.targetDate : input.target_date
  if (start && end && start > end) throw new ServiceError(400, 'INVALID_DATES', 'Start date cannot exceed target date')
  const memberIds = await validatePeople(db, projectId, { leadId: input.lead_id, memberIds: input.member_ids })
  const before = await loadRecord(db, scope, moduleId)

  const statements: unknown[] = [
    db
      .update(modules)
      .set({
        name: input.name,
        description: input.description,
        descriptionText: input.description_text,
        descriptionHtml: input.description_html,
        startDate: input.start_date,
        targetDate: input.target_date,
        status: input.status,
        leadId: input.lead_id,
        viewProps: input.view_props,
        sortOrder: input.sort_order,
        externalSource: input.external_source,
        externalId: input.external_id,
        logoProps: input.logo_props,
        updatedById: actor.userId
      })
      .where(and(eq(modules.id, item.id), eq(modules.projectId, projectId), isNull(modules.deletedAt)))
  ]
  if (memberIds !== undefined) {
    const stay = memberIds.slice(0, 80)
    statements.push(
      db
        .delete(moduleMembers)
        .where(
          and(
            eq(moduleMembers.moduleId, item.id),
            isNull(moduleMembers.deletedAt),
            stay.length ? notInArray(moduleMembers.memberId, stay) : undefined
          )
        ),
      ...chunk(memberIds, 10).map(part =>
        db
          .insert(moduleMembers)
          .values(
            part.map(memberId => ({
              moduleId: item.id,
              memberId,
              projectId,
              workspaceId: item.workspaceId,
              createdById: actor.userId,
              updatedById: actor.userId
            }))
          )
          .onConflictDoNothing()
      )
    )
  }
  await db.batch(statements as unknown as Parameters<typeof db.batch>[0])
  await emitModuleModelActivity({
    moduleId: item.id,
    requestedData: input,
    currentInstance: before,
    actorId: actor.userId,
    slug
  })
  return loadRecord(db, scope, moduleId)
}

/**
 * PD-0671 `ModuleViewSet.destroy`, PD-0209 `ModuleDetailAPIEndpoint.delete`: the project admin or the creator
 * deletes a module. Its issue assignments, members, links, properties, favorites and recent visits go with it
 * and every issue that was in it gets a "removed from module" activity.
 */
export async function deleteModule(db: LancityDb, actor: Actor, slug: string, projectId: number, moduleId: number) {
  const { scope } = await moduleContext(db, actor, slug, projectId)
  const item = await findModule(db, scope, moduleId)
  await requireProjectRole(db, actor, slug, projectId, [ROLE.ADMIN], {
    creator: true,
    pk: moduleId,
    model: { table: modules, id: modules.id, createdById: modules.createdById, deletedAt: modules.deletedAt }
  })
  const assigned = await db
    .select({ issueId: moduleIssues.issueId })
    .from(moduleIssues)
    .where(
      and(eq(moduleIssues.moduleId, item.id), eq(moduleIssues.projectId, projectId), isNull(moduleIssues.deletedAt))
    )
  const now = new Date()
  const gone = (table: { moduleId: AnySQLiteColumn; deletedAt: AnySQLiteColumn }) =>
    and(eq(table.moduleId, item.id), isNull(table.deletedAt))
  const outbox = moduleActivityOutbox(db, actor.userId, projectId, assigned.map(row => ({
    type: 'module.activity.deleted' as const, issueId: row.issueId, moduleId: item.id, moduleName: item.name
  })))
  await db.batch([
    db
      .update(modules)
      .set({ deletedAt: now, updatedById: actor.userId })
      .where(and(eq(modules.id, item.id), isNull(modules.deletedAt))),
    // Assignments are removed for good, like the other module issue writes, so issue lists never see a deleted module.
    db.delete(moduleIssues).where(eq(moduleIssues.moduleId, item.id)),
    db.update(moduleMembers).set({ deletedAt: now }).where(gone(moduleMembers)),
    db.update(moduleLinks).set({ deletedAt: now }).where(gone(moduleLinks)),
    db.update(moduleUserProperties).set({ deletedAt: now }).where(gone(moduleUserProperties)),
    db.update(draftIssueModules).set({ deletedAt: now }).where(gone(draftIssueModules)),
    db
      .delete(userFavorites)
      .where(
        and(
          eq(userFavorites.entityType, 'module'),
          eq(userFavorites.entityIdentifier, item.id),
          eq(userFavorites.projectId, projectId)
        )
      ),
    db
      .delete(userRecentVisits)
      .where(
        and(
          eq(userRecentVisits.entityName, 'module'),
          eq(userRecentVisits.entityIdentifier, item.id),
          eq(userRecentVisits.projectId, projectId)
        )
      ),
    ...outbox.statements
  ])
  await publishModuleActivities(db, outbox.keys)
}

/**
 * PD-0922 `WorkspaceModulesEndpoint.get`: live modules of the projects the member belongs to. Any workspace
 * member may call it.
 */
export async function getWorkspaceModules(db: LancityDb, actor: Actor, slug: string, orderBy?: string) {
  const context = await requireWorkspaceRole(db, actor, slug, [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
  const rows = await queryWorkspaceModules(db, context.workspaceId, actor.userId, orderBy)
  return rows.map(toModuleRecord)
}
