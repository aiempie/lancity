import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { issues } from '@/db/schema/issue'
import { userFavorites, userRecentVisits } from '@/db/schema/notification'
import { cycleIssues, cycles, cycleUserProperties } from '@/db/schema/planning'
import { projectMembers } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import { publishOutbox } from '@/server/common/outbox'
import { OffsetPaginator, paginate } from '@/server/common/pagination'
import { assertTimeZone, convertDateToUtc, formatInTimeZone } from '@/server/common/timezone-converter'
import { cycleAccess, loadCycle } from '@/server/cycle/access'
import { cycleIssueActivityStatement, emitCycleModelActivity, emitCycleWebhook } from '@/server/cycle/events'
import {
  cycleOrderBy,
  cycleViewCondition,
  getDefaultDisplayFilters,
  getDefaultDisplayProperties,
  getDefaultFilters,
  isCycleCompleted,
  nextCycleSortOrder
} from '@/server/cycle/model-rules'
import { presentCycle, presentCycleLite, presentCycleUserProperties } from '@/server/cycle/presenters'
import {
  annotatedCyclesSql,
  countCycles,
  countCycleSubIssues,
  cycleScope,
  joinAnd,
  runCycleQuery,
  type CycleSqlRow
} from '@/server/cycle/queries'
import { requireWorkspaceBySlug } from '@/server/issue/access'
import { saveUserFavorite } from '@/server/workspace/model-rules'
import type { Actor } from '@/types/auth/schema'
import type { JsonValue, LancityDb } from '@/types/database/schema'
import {
  cycleListQuerySchema,
  type CycleDateCheckInput,
  type CycleListQuery,
  type CycleUserPropertiesInput
} from '@/types/planning/p2-cycle-schema'

export { getCycleAnalytics, getCycleProgress } from '@/server/cycle/progress'

type DateInput = Date | string | null | undefined

/** Cycle fields a client may write. `CreateCycleInput` and `UpdateCycleInput` of `types/planning/schema.ts` fit it. */
export type CycleWriteInput = {
  name?: string
  description?: string
  start_date?: DateInput
  end_date?: DateInput
  timezone?: string
  owned_by?: number | null
  external_source?: string | null
  external_id?: string | null
  view_props?: Record<string, unknown>
  logo_props?: Record<string, unknown>
  sort_order?: number
}

/** D1 allows 100 bound variables per statement. */
export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function invalidDates(message = 'Cycle dates must both be set and in order'): never {
  throw new ServiceError(400, 'INVALID_DATES', message)
}

function validTimezone(timeZone: string): string {
  try {
    assertTimeZone(timeZone)
  } catch {
    throw new ServiceError(400, 'INVALID_TIMEZONE', 'Invalid timezone')
  }
  return timeZone
}

/** Calendar day (`YYYY-MM-DD`) of a client value in the project timezone. */
function localDay(value: Date | string, timeZone: string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return formatInTimeZone(new Date(value), timeZone).slice(0, 10)
}

/** PD-0011, PD-0304: both dates become UTC instants of the project day (`convert_to_utc`). */
function toUtc(value: Date | string, timeZone: string, isStart: boolean): Date {
  return convertDateToUtc(localDay(value, timeZone), timeZone, isStart)
}

async function assertProjectMember(db: LancityDb, projectId: number, userId: number) {
  const [member] = await db
    .select({ id: projectMembers.id })
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
  if (!member) throw new ServiceError(400, 'INVALID_OWNER', 'The owner must be an active member of the project')
}

/** Plane answers 409 with the id of the cycle that already uses the external id. */
async function assertExternalFree(
  db: LancityDb,
  workspaceId: number,
  projectId: number,
  source: string | null | undefined,
  externalId: string | null | undefined
) {
  if (!externalId || !source) return
  const [existing] = await db
    .select({ id: cycles.id })
    .from(cycles)
    .where(
      and(
        eq(cycles.workspaceId, workspaceId),
        eq(cycles.projectId, projectId),
        eq(cycles.externalSource, source),
        eq(cycles.externalId, externalId),
        isNull(cycles.deletedAt)
      )
    )
    .limit(1)
  if (existing)
    throw new ServiceError(
      409,
      'CYCLE_EXTERNAL_ID_EXISTS',
      'Cycle with the same external id and external source already exists',
      {
        id: existing.id
      }
    )
}

// ------------------------------------------------------------------ list

/**
 * PD-0495 `CycleViewSet.list` (and the `cycle_view` filters of PD-0081). Archived cycles are left out. `current`
 * falls back to the full list when no cycle is running, like the app endpoint. Favorites come first.
 */
export async function listCycles(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  query: Partial<CycleListQuery> = {}
) {
  const { workspace, project } = await cycleAccess(db, actor, slug, projectId, 5, true)
  const now = Date.now()
  const run = (view: CycleListQuery['cycle_view']) =>
    runCycleQuery(
      db,
      annotatedCyclesSql({
        userId: actor.userId,
        workspaceId: workspace.id,
        now,
        where: joinAnd([
          cycleScope(workspace.id, projectId),
          sql`c.archived_at is null`,
          cycleViewCondition(view, now)
        ]),
        order: sql`is_favorite desc, c.created_at desc, c.id desc`
      })
    )
  let rows = query.cycle_view === 'current' ? await run('current') : []
  if (!rows.length) rows = await run(query.cycle_view && query.cycle_view !== 'current' ? query.cycle_view : 'all')
  return rows.map(row => presentCycle(row, project.timezone))
}

/**
 * PD-0081 `CycleListCreateAPIEndpoint.get`: filtered by `cycle_view`, ordered by an allow-listed `order_by`, and
 * paginated with Plane's envelope. `current` answers a plain array (Plane does not paginate it).
 */
export async function listCyclesPaginated(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  params: URLSearchParams
) {
  const { workspace, project } = await cycleAccess(db, actor, slug, projectId, 5, true)
  const query = cycleListQuerySchema.parse(Object.fromEntries(params))
  const now = Date.now()
  const where = joinAnd([
    cycleScope(workspace.id, projectId),
    sql`c.archived_at is null`,
    cycleViewCondition(query.cycle_view, now)
  ])
  const order = cycleOrderBy(query.order_by)
  const build = (limit?: number, offset?: number) =>
    annotatedCyclesSql({ userId: actor.userId, workspaceId: workspace.id, now, where, order, limit, offset })
  if (query.cycle_view === 'current') {
    return (await runCycleQuery(db, build())).map(row => presentCycle(row, project.timezone))
  }
  return paginate<CycleSqlRow>(params, {
    paginator: new OffsetPaginator<CycleSqlRow>({
      fetch: (offset, limit) => runCycleQuery(db, build(limit, offset)),
      count: () => countCycles(db, where),
      orderBy: query.order_by
    }),
    onResults: rows => rows.map(row => presentCycle(row, project.timezone))
  })
}

/** PD-0088 `CycleListLiteAPIEndpoint.get`: paginated cycle columns for pickers, no annotations. */
export async function listCyclesLite(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  params: URLSearchParams
) {
  const { workspace } = await cycleAccess(db, actor, slug, projectId, 5)
  const where = joinAnd([cycleScope(workspace.id, projectId), sql`c.archived_at is null`])
  const order = cycleOrderBy(params.get('order_by'))
  return paginate<CycleSqlRow>(params, {
    paginator: new OffsetPaginator<CycleSqlRow>({
      fetch: (offset, limit) =>
        runCycleQuery(
          db,
          sql`select c.* from cycles c where ${where} order by ${order} limit ${limit} offset ${offset}`
        ),
      count: () => countCycles(db, where),
      orderBy: params.get('order_by')
    }),
    onResults: rows => rows.map(row => presentCycleLite(row))
  })
}

/** PD-0881 `WorkspaceCyclesEndpoint.get`: cycles of every project the actor belongs to. */
export async function getWorkspaceCycles(db: LancityDb, actor: Actor, slug: string, orderBy?: string | null) {
  const { workspace } = await requireWorkspaceBySlug(db, actor, slug, 5)
  const rows = await runCycleQuery(
    db,
    annotatedCyclesSql({
      userId: actor.userId,
      workspaceId: workspace.id,
      now: Date.now(),
      where: joinAnd([
        sql`c.workspace_id = ${workspace.id} and c.deleted_at is null and c.archived_at is null`,
        sql`exists (select 1 from project_members pm join projects p on p.id = pm.project_id
          where pm.project_id = c.project_id and pm.member_id = ${actor.userId} and pm.is_active = 1
            and pm.deleted_at is null and p.archived_at is null and p.deleted_at is null)`
      ]),
      order: cycleOrderBy(orderBy)
    })
  )
  return rows.map(row => presentCycle(row))
}

/** PD-0498 and PD-0091: one cycle with the annotations and the sub-issue count. Archived cycles answer 404. */
export async function retrieveCycle(db: LancityDb, actor: Actor, slug: string, projectId: number, cycleId: number) {
  const { workspace, project } = await cycleAccess(db, actor, slug, projectId, 15, true)
  const [row] = await runCycleQuery(
    db,
    annotatedCyclesSql({
      userId: actor.userId,
      workspaceId: workspace.id,
      now: Date.now(),
      where: joinAnd([cycleScope(workspace.id, projectId), sql`c.archived_at is null`, sql`c.id = ${cycleId}`]),
      order: sql`c.id`
    })
  )
  if (!row) throw new ServiceError(404, 'CYCLE_NOT_FOUND', 'Cycle not found')
  return { ...presentCycle(row, project.timezone), subIssues: await countCycleSubIssues(db, projectId, cycleId) }
}

export async function getCycle(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  cycleId: number,
  minimumRole: 5 | 15 | 20 = 5
) {
  const { workspace } = await cycleAccess(db, actor, slug, projectId, minimumRole)
  return loadCycle(db, workspace.id, projectId, cycleId)
}

// ------------------------------------------------------------------ write

/**
 * PD-0496 `CycleViewSet.create` and PD-0087. Dates become UTC instants of the project's days. A cycle needs both
 * dates or none. The cycle goes to the top of the project's sort order and a `model_activity` job tells the webhook domain.
 */
export async function createCycle(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  input: CycleWriteInput & { name: string }
) {
  const { workspace, project } = await cycleAccess(db, actor, slug, projectId, 15)
  if (!project.cycleView) throw new ServiceError(400, 'CYCLES_DISABLED', 'Cycles are not enabled for this project')
  if (Boolean(input.start_date) !== Boolean(input.end_date))
    invalidDates('Both start date and end date are either required or are to be null')
  const start = input.start_date ? toUtc(input.start_date, project.timezone, true) : null
  const end = input.end_date ? toUtc(input.end_date, project.timezone, false) : null
  if (start && end && start > end) invalidDates('Start date cannot exceed end date')
  if (input.timezone) validTimezone(input.timezone)
  await assertExternalFree(db, workspace.id, projectId, input.external_source, input.external_id)
  const ownerId = input.owned_by ?? actor.userId
  if (ownerId !== actor.userId) await assertProjectMember(db, projectId, ownerId)
  const [cycle] = await db
    .insert(cycles)
    .values({
      name: input.name,
      description: input.description,
      startDate: start,
      endDate: end,
      timezone: input.timezone,
      ownedById: ownerId,
      externalSource: input.external_source ?? null,
      externalId: input.external_id ?? null,
      viewProps: (input.view_props ?? {}) as JsonValue,
      logoProps: (input.logo_props ?? {}) as JsonValue,
      sortOrder: input.sort_order ?? nextCycleSortOrder(projectId),
      projectId,
      workspaceId: workspace.id,
      createdById: actor.userId,
      updatedById: actor.userId
    })
    .returning()
  await emitCycleModelActivity({
    cycleId: cycle.id,
    actorId: actor.userId,
    slug,
    requestedData: input,
    currentInstance: null
  })
  return cycle
}

/**
 * PD-0497 `CycleViewSet.partial_update` and PD-0092. Archived cycles cannot change; a completed cycle only accepts
 * `sort_order`. Dates are merged with the stored ones and converted like on create.
 */
export async function updateCycle(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  cycleId: number,
  input: CycleWriteInput
) {
  const { workspace, project } = await cycleAccess(db, actor, slug, projectId, 15)
  if (!project.cycleView) throw new ServiceError(400, 'CYCLES_DISABLED', 'Cycles are not enabled for this project')
  const cycle = await loadCycle(db, workspace.id, projectId, cycleId)
  if (cycle.archivedAt) throw new ServiceError(400, 'CYCLE_ARCHIVED', 'Archived cycle cannot be updated')
  let data = input
  if (isCycleCompleted(cycle.endDate)) {
    if (input.sort_order === undefined)
      throw new ServiceError(400, 'CYCLE_COMPLETED', 'The Cycle has already been completed so it cannot be edited')
    data = { sort_order: input.sort_order }
  }
  let start = cycle.startDate
  let end = cycle.endDate
  if (data.start_date !== undefined) start = data.start_date ? toUtc(data.start_date, project.timezone, true) : null
  if (data.end_date !== undefined) end = data.end_date ? toUtc(data.end_date, project.timezone, false) : null
  if (data.start_date !== undefined || data.end_date !== undefined) {
    if (Boolean(start) !== Boolean(end) || (start && end && start > end)) invalidDates()
  }
  if (data.timezone) validTimezone(data.timezone)
  if (data.external_id && data.external_id !== cycle.externalId)
    await assertExternalFree(
      db,
      workspace.id,
      projectId,
      data.external_source ?? cycle.externalSource,
      data.external_id
    )
  // Plane: an explicit null owner means the requester.
  const ownerId = data.owned_by === undefined ? undefined : (data.owned_by ?? actor.userId)
  if (ownerId !== undefined && ownerId !== cycle.ownedById) await assertProjectMember(db, projectId, ownerId)
  const patch: Partial<typeof cycles.$inferInsert> = { updatedById: actor.userId }
  if (data.name !== undefined) patch.name = data.name
  if (data.description !== undefined) patch.description = data.description
  if (data.start_date !== undefined) patch.startDate = start
  if (data.end_date !== undefined) patch.endDate = end
  if (data.timezone !== undefined) patch.timezone = data.timezone
  if (ownerId !== undefined) patch.ownedById = ownerId
  if (data.external_source !== undefined) patch.externalSource = data.external_source
  if (data.external_id !== undefined) patch.externalId = data.external_id
  if (data.view_props !== undefined) patch.viewProps = data.view_props as JsonValue
  if (data.logo_props !== undefined) patch.logoProps = data.logo_props as JsonValue
  if (data.sort_order !== undefined) patch.sortOrder = data.sort_order
  const [updated] = await db
    .update(cycles)
    .set(patch)
    .where(
      and(eq(cycles.id, cycle.id), eq(cycles.projectId, projectId), isNull(cycles.deletedAt), isNull(cycles.archivedAt))
    )
    .returning()
  if (!updated) throw new ServiceError(409, 'CYCLE_CHANGED', 'Cycle changed while it was being updated')
  await emitCycleModelActivity({
    cycleId: cycle.id,
    actorId: actor.userId,
    slug,
    requestedData: input,
    currentInstance: cycle
  })
  return updated
}

/**
 * PD-0499 `CycleViewSet.destroy` and PD-0093: project admins and the creator only. The cycle, its assignments and
 * the actor-visible user properties are soft-deleted; favorites and recent visits of the cycle are removed.
 */
export async function deleteCycle(db: LancityDb, actor: Actor, slug: string, projectId: number, cycleId: number) {
  const { workspace, role } = await cycleAccess(db, actor, slug, projectId, 5)
  const cycle = await loadCycle(db, workspace.id, projectId, cycleId)
  if (role < 20 && cycle.createdById !== actor.userId)
    throw new ServiceError(403, 'FORBIDDEN', 'Only admin or creator can delete the cycle')
  const assigned = await db
    .select({ issueId: cycleIssues.issueId })
    .from(cycleIssues)
    .where(and(eq(cycleIssues.cycleId, cycleId), isNull(cycleIssues.deletedAt)))
  const now = new Date()
  const audit = { deletedAt: now, updatedById: actor.userId }
  const activityKey = crypto.randomUUID()
  const activity = {
      type: 'cycle.activity.deleted',
      requestedData: { cycle_id: cycleId, cycle_name: cycle.name, issues: assigned.map(row => row.issueId) },
      currentInstance: null,
      issueId: null,
      actorId: actor.userId,
      projectId
  } as const
  await db.batch([
    db
      .update(cycles)
      .set(audit)
      .where(and(eq(cycles.id, cycleId), eq(cycles.projectId, projectId), isNull(cycles.deletedAt))),
    ...(assigned.length ? [cycleIssueActivityStatement(db, activityKey, activity, sql`changes() = 1`)] : []),
    db
      .update(cycleIssues)
      .set(audit)
      .where(and(eq(cycleIssues.cycleId, cycleId), isNull(cycleIssues.deletedAt))),
    db
      .update(cycleUserProperties)
      .set(audit)
      .where(and(eq(cycleUserProperties.cycleId, cycleId), isNull(cycleUserProperties.deletedAt))),
    db
      .delete(userFavorites)
      .where(
        and(
          eq(userFavorites.entityType, 'cycle'),
          eq(userFavorites.entityIdentifier, cycleId),
          eq(userFavorites.projectId, projectId)
        )
      ),
    db
      .delete(userRecentVisits)
      .where(
        and(
          eq(userRecentVisits.entityName, 'cycle'),
          eq(userRecentVisits.entityIdentifier, cycleId),
          eq(userRecentVisits.projectId, projectId)
        )
      )
  ])
  if (assigned.length) await publishOutbox(db, activityKey)

  await emitCycleWebhook({ verb: 'deleted', cycleId, actorId: actor.userId, slug })
}

/**
 * PD-0500 `CycleDateCheckEndpoint.post`: does another cycle of the project overlap the given dates? Both dates are
 * converted with the project timezone first. `cycle_id` excludes the cycle being edited.
 */
export async function checkCycleDates(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  input: CycleDateCheckInput
) {
  const { workspace, project } = await cycleAccess(db, actor, slug, projectId, 15)
  const start = toUtc(input.start_date, project.timezone, true).getTime()
  const end = toUtc(input.end_date, project.timezone, false).getTime()
  const rows = await db.all<{ one: number }>(
    sql`select 1 as one from cycles c
      where c.workspace_id = ${workspace.id} and c.project_id = ${projectId} and c.deleted_at is null
        ${input.cycle_id ? sql`and c.id != ${input.cycle_id}` : sql``}
        and ((c.start_date <= ${start} and c.end_date >= ${start})
          or (c.start_date <= ${end} and c.end_date >= ${end})
          or (c.start_date >= ${start} and c.end_date <= ${end}))
      limit 1`
  )
  if (rows.length)
    return {
      status: false,
      error:
        'You have a cycle already on the given dates, if you want to create a draft cycle you can do that by removing dates'
    }
  return { status: true }
}

// ------------------------------------------------------------------ favorites

/** PD-0501: the cycles the actor starred in the project. */
export async function listCycleFavorites(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { workspace, project } = await cycleAccess(db, actor, slug, projectId, 15, true)
  const rows = await runCycleQuery(
    db,
    annotatedCyclesSql({
      userId: actor.userId,
      workspaceId: workspace.id,
      now: Date.now(),
      where: joinAnd([
        cycleScope(workspace.id, projectId),
        sql`c.archived_at is null`,
        sql`exists (select 1 from user_favorites f where f.user_id = ${actor.userId} and f.entity_type = 'cycle'
          and f.entity_identifier = c.id and f.project_id = c.project_id and f.deleted_at is null)`
      ]),
      order: sql`c.created_at desc, c.id desc`
    })
  )
  return rows.map(row => presentCycle(row, project.timezone))
}

/** PD-0503 `CycleFavoriteViewSet.create`: 404 unless the cycle belongs to the project. Starring twice is a no-op. */
export async function createCycleFavorite(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  cycleId: number
) {
  const { workspace } = await cycleAccess(db, actor, slug, projectId, 15, true)
  await loadCycle(db, workspace.id, projectId, cycleId)
  const [existing] = await db
    .select({ id: userFavorites.id })
    .from(userFavorites)
    .where(
      and(
        eq(userFavorites.entityType, 'cycle'),
        eq(userFavorites.entityIdentifier, cycleId),
        eq(userFavorites.userId, actor.userId),
        isNull(userFavorites.deletedAt)
      )
    )
    .limit(1)
  if (existing) return
  await db.insert(userFavorites).values({
    entityType: 'cycle',
    entityIdentifier: cycleId,
    sequence: await saveUserFavorite(db, workspace.id),
    projectId,
    workspaceId: workspace.id,
    userId: actor.userId,
    createdById: actor.userId,
    updatedById: actor.userId
  })
}

/** PD-0504 `CycleFavoriteViewSet.destroy`: 404 when the actor has not starred the cycle. */
export async function deleteCycleFavorite(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  cycleId: number
) {
  const { workspace } = await cycleAccess(db, actor, slug, projectId, 15)
  const removed = await db
    .delete(userFavorites)
    .where(
      and(
        eq(userFavorites.entityType, 'cycle'),
        eq(userFavorites.entityIdentifier, cycleId),
        eq(userFavorites.userId, actor.userId),
        eq(userFavorites.projectId, projectId),
        eq(userFavorites.workspaceId, workspace.id)
      )
    )
    .returning({ id: userFavorites.id })
  if (!removed.length) throw new ServiceError(404, 'FAVORITE_NOT_FOUND', 'Favorite not found')
}

// ------------------------------------------------------------------ user properties

async function ensureUserProperties(
  db: LancityDb,
  actor: Actor,
  workspaceId: number,
  projectId: number,
  cycleId: number
) {
  const where = and(
    eq(cycleUserProperties.cycleId, cycleId),
    eq(cycleUserProperties.userId, actor.userId),
    eq(cycleUserProperties.projectId, projectId),
    eq(cycleUserProperties.workspaceId, workspaceId),
    isNull(cycleUserProperties.deletedAt)
  )
  const [found] = await db.select().from(cycleUserProperties).where(where).limit(1)
  if (found) return found
  await db
    .insert(cycleUserProperties)
    .values({
      cycleId,
      projectId,
      workspaceId,
      userId: actor.userId,
      filters: getDefaultFilters() as JsonValue,
      displayFilters: getDefaultDisplayFilters() as JsonValue,
      displayProperties: getDefaultDisplayProperties() as JsonValue,
      richFilters: {},
      createdById: actor.userId,
      updatedById: actor.userId
    })
    .onConflictDoNothing()
  const [created] = await db.select().from(cycleUserProperties).where(where).limit(1)
  return created
}

/** PD-0507 `CycleUserPropertiesEndpoint.get` (get or create with the defaults). */
export async function getCycleUserProperties(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  cycleId: number
) {
  const { workspace } = await cycleAccess(db, actor, slug, projectId, 5)
  await loadCycle(db, workspace.id, projectId, cycleId)
  return presentCycleUserProperties(await ensureUserProperties(db, actor, workspace.id, projectId, cycleId))
}

/** PD-0506 `CycleUserPropertiesEndpoint.patch`. Omitted keys keep their value. Plane 404s without a row; here it is created first. */
export async function updateCycleUserProperties(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  cycleId: number,
  input: CycleUserPropertiesInput
) {
  const { workspace } = await cycleAccess(db, actor, slug, projectId, 5)
  await loadCycle(db, workspace.id, projectId, cycleId)
  const current = await ensureUserProperties(db, actor, workspace.id, projectId, cycleId)
  const [updated] = await db
    .update(cycleUserProperties)
    .set({
      filters: (input.filters ?? current.filters) as JsonValue,
      richFilters: (input.rich_filters ?? current.richFilters) as JsonValue,
      displayFilters: (input.display_filters ?? current.displayFilters) as JsonValue,
      displayProperties: (input.display_properties ?? current.displayProperties) as JsonValue,
      updatedById: actor.userId
    })
    .where(eq(cycleUserProperties.id, current.id))
    .returning()
  return presentCycleUserProperties(updated)
}

// ------------------------------------------------------------------ cycle issues

export async function listCycleIssues(db: LancityDb, actor: Actor, slug: string, projectId: number, cycleId: number) {
  const cycle = await getCycle(db, actor, slug, projectId, cycleId, 15)
  return db
    .select({ assignment: cycleIssues, issue: issues })
    .from(cycleIssues)
    .innerJoin(issues, eq(cycleIssues.issueId, issues.id))
    .where(
      and(
        eq(cycleIssues.cycleId, cycle.id),
        eq(cycleIssues.projectId, projectId),
        isNull(cycleIssues.deletedAt),
        isNull(issues.deletedAt)
      )
    )
}

/**
 * PD-0519 `CycleIssueViewSet.create` and PD-0102. Issues in another cycle move here, issues already here are left
 * alone and the rest are added, all in one batch. Fails when any issue is outside the project. A
 * `cycle.activity.created` job records the activity and notifies subscribers.
 */
export async function assignCycleIssues(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  cycleId: number,
  input: number[]
) {
  const cycle = await getCycle(db, actor, slug, projectId, cycleId, 15)
  if (cycle.archivedAt || (cycle.endDate && cycle.endDate < new Date()))
    throw new ServiceError(400, 'CYCLE_COMPLETED', 'Cannot add issues to a completed or archived cycle')
  const ids = [...new Set(input)]
  let found = 0
  for (const part of chunks(ids, 50)) {
    const rows = await db
      .select({ id: issues.id })
      .from(issues)
      .where(
        and(
          eq(issues.projectId, projectId),
          eq(issues.workspaceId, cycle.workspaceId),
          inArray(issues.id, part),
          isNull(issues.deletedAt)
        )
      )
    found += rows.length
  }
  if (found !== ids.length) throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Issue not found in project')
  const current: { issueId: number; cycleId: number }[] = []
  for (const part of chunks(ids, 50))
    current.push(
      ...(await db
        .select({ issueId: cycleIssues.issueId, cycleId: cycleIssues.cycleId })
        .from(cycleIssues)
        .where(
          and(eq(cycleIssues.projectId, projectId), inArray(cycleIssues.issueId, part), isNull(cycleIssues.deletedAt))
        ))
    )
  const here = new Set(current.filter(row => row.cycleId === cycleId).map(row => row.issueId))
  const moved = current.filter(row => row.cycleId !== cycleId)
  const known = new Set(current.map(row => row.issueId))
  const created = ids.filter(id => !known.has(id))
  const toInsert = ids.filter(id => !here.has(id))
  if (!toInsert.length) return
  const statements = [
    ...chunks(
      moved.map(row => row.issueId),
      50
    ).map(part =>
      db
        .delete(cycleIssues)
        .where(
          and(
            eq(cycleIssues.projectId, projectId),
            ne(cycleIssues.cycleId, cycleId),
            inArray(cycleIssues.issueId, part),
            isNull(cycleIssues.deletedAt)
          )
        )
    ),
    ...chunks(toInsert, 15).map(part =>
      db
        .insert(cycleIssues)
        .values(
          part.map(issueId => ({
            cycleId,
            issueId,
            projectId,
            workspaceId: cycle.workspaceId,
            createdById: actor.userId,
            updatedById: actor.userId
          }))
        )
        .onConflictDoNothing()
    )
  ]
  const activityKey = crypto.randomUUID()
  const activity = {
    type: 'cycle.activity.created',
    requestedData: { cycles_list: ids },
    currentInstance: {
      updated_cycle_issues: moved.map(row => ({
        old_cycle_id: row.cycleId,
        new_cycle_id: cycleId,
        issue_id: row.issueId
      })),
      created_cycle_issues: created.map(issueId => ({ fields: { cycle: cycleId, issue: issueId } }))
    },
    issueId: null,
    actorId: actor.userId,
    projectId
  } as const
  await db.batch([...statements, cycleIssueActivityStatement(db, activityKey, activity)] as unknown as [(typeof statements)[number], ...(typeof statements)[number][]])
  await publishOutbox(db, activityKey)
}

/** PD-0520 `CycleIssueViewSet.destroy` and PD-0105: soft-delete the assignment and record `cycle.activity.deleted`. */
export async function removeCycleIssue(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  cycleId: number,
  issueId: number
) {
  await getCycle(db, actor, slug, projectId, cycleId, 15)
  const activityKey = crypto.randomUUID()
  const activity = {
    type: 'cycle.activity.deleted',
    requestedData: { cycle_id: cycleId, issues: [issueId] },
    currentInstance: null,
    issueId,
    actorId: actor.userId,
    projectId
  } as const
  const [removed] = await db.batch([db
    .update(cycleIssues)
    .set({ deletedAt: new Date(), updatedById: actor.userId })
    .where(
      and(
        eq(cycleIssues.cycleId, cycleId),
        eq(cycleIssues.projectId, projectId),
        eq(cycleIssues.issueId, issueId),
        isNull(cycleIssues.deletedAt)
      )
    )
    .returning({ id: cycleIssues.id }), cycleIssueActivityStatement(db, activityKey, activity, sql`changes() = 1`)])
  if (!removed.length) throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Cycle issue not found')
  await publishOutbox(db, activityKey)
}
