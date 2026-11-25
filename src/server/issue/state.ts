import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { issues, states } from '@/db/schema/issue'
import { projectMembers, projects } from '@/db/schema/workspace'
import { parseInput } from '@/server/api/v1/validation'
import { ServiceError } from '@/server/common/errors'
import { requireWorkspaceBySlug } from '@/server/issue/access'
import { nextAfterMaxSql } from '@/server/issue/sequence'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import {
  createStateInputSchema,
  updateStateInputSchema,
  type CreateStateInput,
  type UpdateStateInput
} from '@/types/issue/schema'

type StateRow = typeof states.$inferSelect

/** Port of `State.save` slug rule: the slug always follows the name (PD-1489). */
export function slugify(name: string) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[-\s]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
}

/** Live states of one project, triage excluded (`StateManager`, PD-1486, PD-0800). Triage states use `triageStates`. */
function liveStates(projectId: number, triage = false) {
  return and(eq(states.projectId, projectId), eq(states.isTriage, triage), isNull(states.deletedAt))
}

/**
 * Port of `Issue._ensure_default_state` (PD-1420): the given state, else the project's default non-triage state,
 * else its first non-triage state.
 */
export async function resolveInitialIssueState(db: LancityDb, projectId: number, stateId?: number | null) {
  if (stateId) return stateId
  const [state] = await db
    .select({ id: states.id })
    .from(states)
    .where(liveStates(projectId))
    .orderBy(desc(states.default), asc(states.sequence), asc(states.id))
    .limit(1)
  return state?.id ?? null
}

/**
 * Port of `Issue._sync_completed_at` (PD-1421). Returns the new `completed_at` when it must change and `undefined`
 * when the issue keeps its value (no state, or an update that did not change the state).
 */
export function resolveIssueCompletionTime(
  group: StateRow['group'] | null | undefined,
  options: { adding: boolean; stateChanged: boolean },
  now = new Date()
): Date | null | undefined {
  if (!group) return undefined
  if (!options.adding && !options.stateChanged) return undefined
  return group === 'completed' ? now : null
}

/** Plane `list` adds `order = index / count` inside each group. */
export function withStateOrder<T extends { group: string }>(rows: T[]): Array<T & { order: number }> {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.group, (counts.get(row.group) ?? 0) + 1)
  const seen = new Map<string, number>()
  return rows.map(row => {
    const index = (seen.get(row.group) ?? 0) + 1
    seen.set(row.group, index)
    return { ...row, order: index / counts.get(row.group)! }
  })
}

export async function listStates(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  await requireProjectAccess(db, actor, slug, projectId, 5)
  return withStateOrder(await db.select().from(states).where(liveStates(projectId)).orderBy(states.sequence, states.id))
}

/** `GET .../states/?grouped=true` returns the states keyed by group. */
export async function listStatesGrouped(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const rows = await listStates(db, actor, slug, projectId)
  const grouped: Record<string, typeof rows> = {}
  for (const row of [...rows].sort((a, b) => a.group.localeCompare(b.group))) (grouped[row.group] ??= []).push(row)
  return grouped
}

export async function getState(db: LancityDb, actor: Actor, slug: string, projectId: number, stateId: number) {
  await requireProjectAccess(db, actor, slug, projectId, 5)
  const [state] = await db
    .select()
    .from(states)
    .where(and(eq(states.id, stateId), liveStates(projectId)))
  if (!state) throw new ServiceError(404, 'STATE_NOT_FOUND', 'State not found')
  return state
}

/** Port of `IntakeStateEndpoint.get` (PD-0809): the project's triage state. */
export async function getIntakeState(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  await requireProjectAccess(db, actor, slug, projectId, 5)
  const [state] = await db
    .select()
    .from(states)
    .where(liveStates(projectId, true))
    .orderBy(states.sequence)
    .limit(1)
  if (!state) throw new ServiceError(404, 'TRIAGE_STATE_NOT_FOUND', 'Triage state not found')
  return state
}

/** Port of `WorkspaceStatesEndpoint.get` (PD-0931): states of every active project the actor belongs to. */
export async function getWorkspaceStates(db: LancityDb, actor: Actor, slug: string) {
  const { workspace } = await requireWorkspaceBySlug(db, actor, slug)
  const rows = await db
    .select({ state: states })
    .from(states)
    .innerJoin(projects, and(eq(projects.id, states.projectId), eq(projects.workspaceId, states.workspaceId)))
    .innerJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, projects.id),
        eq(projectMembers.memberId, actor.userId),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt)
      )
    )
    .where(
      and(
        eq(states.workspaceId, workspace.id),
        eq(states.isTriage, false),
        isNull(states.deletedAt),
        isNull(projects.deletedAt),
        isNull(projects.archivedAt)
      )
    )
    .orderBy(states.projectId, states.sequence, states.id)
  return withStateOrder(rows.map(row => row.state))
}

async function externalConflict(
  db: LancityDb,
  projectId: number,
  externalId: string | null | undefined,
  externalSource: string | null | undefined,
  exceptId?: number
) {
  if (!externalId || !externalSource) return
  const [other] = await db
    .select({ id: states.id })
    .from(states)
    .where(
      and(
        eq(states.projectId, projectId),
        eq(states.externalId, externalId),
        eq(states.externalSource, externalSource),
        isNull(states.deletedAt),
        exceptId ? sql`${states.id} <> ${exceptId}` : undefined
      )
    )
    .limit(1)
  if (other)
    throw new ServiceError(409, 'EXTERNAL_ID_EXISTS', 'State with the same external id and external source already exists', {
      id: other.id
    })
}

async function nameConflict(db: LancityDb, projectId: number, name: string, exceptId?: number) {
  const [existing] = await db
    .select({ id: states.id })
    .from(states)
    .where(
      and(
        eq(states.projectId, projectId),
        eq(states.name, name),
        isNull(states.deletedAt),
        exceptId ? sql`${states.id} <> ${exceptId}` : undefined
      )
    )
  if (existing)
    throw new ServiceError(409, 'STATE_NAME_EXISTS', 'State name already exists', { id: existing.id })
}

/** `StateSerializer.save` + `StateViewSet.create` (PD-0046, PD-0802, PD-0251): a new default clears the old one atomically. */
export async function createState(db: LancityDb, actor: Actor, slug: string, projectId: number, raw: CreateStateInput) {
  const input = parseInput(createStateInputSchema, raw)
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 20)
  await nameConflict(db, projectId, input.name)
  await externalConflict(db, projectId, input.externalId, input.externalSource)
  const insert = db
    .insert(states)
    .values({
      name: input.name,
      color: input.color,
      description: input.description ?? '',
      group: input.group ?? 'backlog',
      default: input.default ?? false,
      slug: slugify(input.name) || input.slug || 'state',
      sequence: input.sequence ?? nextAfterMaxSql('states', projectId),
      externalId: input.externalId ?? null,
      externalSource: input.externalSource ?? null,
      projectId,
      workspaceId: workspace.id,
      createdById: actor.userId,
      updatedById: actor.userId
    })
    .returning()
  const clearOthers = db
    .update(states)
    .set({ default: false })
    .where(and(eq(states.projectId, projectId), sql`${states.id} <> last_insert_rowid()`, eq(states.default, true)))
  try {
    const [created] = input.default ? await db.batch([insert, clearOthers]) : await db.batch([insert])
    return created[0]
  } catch (error) {
    await nameConflict(db, projectId, input.name)
    throw error
  }
}

export async function updateState(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  stateId: number,
  raw: UpdateStateInput
) {
  const input = parseInput(updateStateInputSchema, raw)
  await requireProjectAccess(db, actor, slug, projectId, 20)
  const current = await getState(db, actor, slug, projectId, stateId)
  if (input.name !== undefined) await nameConflict(db, projectId, input.name, stateId)
  await externalConflict(db, projectId, input.externalId, input.externalSource ?? current.externalSource, stateId)
  const update = db
    .update(states)
    .set({
      ...input,
      ...(input.name !== undefined ? { slug: slugify(input.name) || current.slug } : {}),
      updatedById: actor.userId,
      updatedAt: sql`max(${states.updatedAt} + 1, cast(unixepoch('subsec') * 1000 as integer))`
    })
    .where(and(eq(states.id, stateId), liveStates(projectId)))
    .returning()
  const clearOthers = db
    .update(states)
    .set({ default: false })
    .where(and(eq(states.projectId, projectId), sql`${states.id} <> ${stateId}`, eq(states.default, true)))
  const [updated] = input.default ? await db.batch([update, clearOthers]) : await db.batch([update])
  if (!updated.length) throw new ServiceError(404, 'STATE_NOT_FOUND', 'State not found')
  return updated[0]
}

/** Port of `StateViewSet.mark_as_default` (PD-0807): one UPDATE, so a project never has zero or two defaults. */
export async function markAsDefaultState(db: LancityDb, actor: Actor, slug: string, projectId: number, stateId: number) {
  await requireProjectAccess(db, actor, slug, projectId, 20)
  await getState(db, actor, slug, projectId, stateId)
  await db
    .update(states)
    .set({ default: sql`case when ${states.id} = ${stateId} then 1 else 0 end` })
    .where(and(eq(states.projectId, projectId), isNull(states.deletedAt)))
}

/** Port of `StateViewSet.destroy` (PD-0808, PD-0257): default and non-empty states cannot be deleted. */
export async function deleteState(db: LancityDb, actor: Actor, slug: string, projectId: number, stateId: number) {
  await requireProjectAccess(db, actor, slug, projectId, 20)
  const current = await getState(db, actor, slug, projectId, stateId)
  if (current.default) throw new ServiceError(400, 'DEFAULT_STATE', 'Default state cannot be deleted')
  const removed = await db
    .update(states)
    .set({ deletedAt: new Date(), updatedById: actor.userId })
    .where(
      and(
        eq(states.id, stateId),
        liveStates(projectId),
        eq(states.default, false),
        sql`not exists (select 1 from ${issues} where ${issues.stateId} = ${stateId} and ${issues.deletedAt} is null)`
      )
    )
    .returning({ id: states.id })
  if (!removed.length)
    throw new ServiceError(400, 'STATE_NOT_EMPTY', 'The state is not empty, only empty states can be deleted')
}
