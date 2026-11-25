import { and, eq, isNull, sql } from 'drizzle-orm'
import { cycles } from '@/db/schema/planning'
import { ServiceError } from '@/server/common/errors'
import { cycleAccess, loadCycle } from '@/server/cycle/access'
import { presentCycle } from '@/server/cycle/presenters'
import { cycleDistributions } from '@/server/cycle/progress'
import { annotatedCyclesSql, countCycleSubIssues, cycleScope, joinAnd, runCycleQuery } from '@/server/cycle/queries'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

export function planningWriteAccess(actor: Actor, slug: string, projectId: number, workspaceId: number) {
  return sql`exists (select 1 from projects p join workspaces w on w.id = p.workspace_id
    join workspace_members wm on wm.workspace_id = w.id and wm.member_id = ${actor.userId}
    join project_members pm on pm.project_id = p.id and pm.workspace_id = w.id and pm.member_id = ${actor.userId}
    where p.id = ${projectId} and w.id = ${workspaceId} and w.slug = ${slug}
      and p.deleted_at is null and p.archived_at is null and w.deleted_at is null
      and wm.is_active = 1 and wm.deleted_at is null and pm.is_active = 1 and pm.deleted_at is null
      and (pm.role >= 15 or wm.role = 20))`
}
/**
 * PD-0490 `CycleArchiveUnarchiveEndpoint.get` and PD-0095. Without `cycleId`: the archived cycles with the issue
 * counts, estimate points and `status`, favorites first. With it: that cycle plus its sub-issue count, the label
 * and assignee distributions and the burndown chart (`distribution`, `estimateDistribution` for point estimates).
 */
export async function listArchivedCycles(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  cycleId?: number
) {
  const { workspace, project } = await cycleAccess(db, actor, slug, projectId, 15, true)
  const rows = await runCycleQuery(
    db,
    annotatedCyclesSql({
      userId: actor.userId,
      workspaceId: workspace.id,
      now: Date.now(),
      estimates: true,
      where: joinAnd([
        cycleScope(workspace.id, projectId),
        sql`c.archived_at is not null`,
        cycleId === undefined ? sql`1 = 1` : sql`c.id = ${cycleId}`
      ]),
      order: sql`is_favorite desc, c.created_at desc, c.id desc`
    })
  )
  if (cycleId === undefined) return rows.map(row => presentCycle(row, project.timezone))
  if (!rows.length) throw new ServiceError(404, 'CYCLE_NOT_FOUND', 'Archived cycle not found')
  const cycle = await loadCycle(db, workspace.id, projectId, cycleId, 'only')
  const { distribution, estimate_distribution } = await cycleDistributions(
    db,
    { cycleId, projectId, workspaceId: workspace.id },
    cycle,
    'issue'
  )
  return {
    ...presentCycle(rows[0], project.timezone),
    subIssues: await countCycleSubIssues(db, projectId, cycleId),
    distribution,
    estimateDistribution: estimate_distribution
  }
}
export async function setCycleArchived(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  cycleId: number,
  archived: boolean
) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 15)
  const [cycle] = await db
    .select()
    .from(cycles)
    .where(
      and(
        eq(cycles.id, cycleId),
        eq(cycles.projectId, projectId),
        eq(cycles.workspaceId, workspace.id),
        isNull(cycles.deletedAt)
      )
    )
  if (!cycle) throw new ServiceError(404, 'CYCLE_NOT_FOUND', 'Cycle not found')
  const now = new Date()
  if (archived && (!cycle.endDate || cycle.endDate >= now))
    throw new ServiceError(400, 'CYCLE_NOT_COMPLETED', 'Only completed cycles can be archived')
  const update = db
    .update(cycles)
    .set({ archivedAt: archived ? now : null, updatedById: actor.userId })
    .where(
      and(
        eq(cycles.id, cycleId),
        eq(cycles.projectId, projectId),
        eq(cycles.workspaceId, workspace.id),
        isNull(cycles.deletedAt),
        planningWriteAccess(actor, slug, projectId, workspace.id),
        archived ? sql`${cycles.endDate} < ${now.getTime()}` : undefined
      )
    )
    .returning({ id: cycles.id })
  if (archived) {
    const statement = update.toSQL()
    const [updated] = await db.$client.batch([
      db.$client.prepare(statement.sql).bind(...statement.params),
      db.$client
        .prepare(
          `delete from user_favorites where entity_type = 'cycle' and entity_identifier = ? and project_id = ? and workspace_id = ? and changes() > 0`
        )
        .bind(cycleId, projectId, workspace.id)
    ])
    if (!updated.results.length) throw new ServiceError(409, 'CYCLE_CHANGED', 'Cycle or project access changed')
  } else if (!(await update).length) throw new ServiceError(409, 'CYCLE_CHANGED', 'Cycle or project access changed')
  return { archivedAt: archived ? now : null }
}
