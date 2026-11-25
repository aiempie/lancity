import { and, eq, isNull, sql } from 'drizzle-orm'
import { cycles } from '@/db/schema/planning'
import { ServiceError } from '@/server/common/errors'
import { outboxStatement, publishOutbox } from '@/server/common/outbox'
import { CYCLE_JOB } from '@/server/cycle/events'
import { cycleDistributions } from '@/server/cycle/progress'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

export async function transferCycleIssues(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  cycleId: number,
  destinationId: number
) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 15)
  if (cycleId === destinationId)
    throw new ServiceError(400, 'INVALID_DESTINATION', 'Choose a different destination cycle')
  const [source] = await db
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
  const [target] = await db
    .select()
    .from(cycles)
    .where(
      and(
        eq(cycles.id, destinationId),
        eq(cycles.projectId, projectId),
        eq(cycles.workspaceId, workspace.id),
        isNull(cycles.deletedAt)
      )
    )
  if (!source || !target) throw new ServiceError(404, 'CYCLE_NOT_FOUND', 'Cycle not found')
  if (source.endDate && source.endDate > new Date())
    throw new ServiceError(400, 'CYCLE_NOT_COMPLETED', 'Source cycle is not completed yet')
  if (source.archivedAt || target.archivedAt || (target.endDate && target.endDate < new Date()))
    throw new ServiceError(
      400,
      'INVALID_DESTINATION',
      'Source and destination must be active and destination must not be completed'
    )
  const now = Date.now()
  const mutationId = crypto.randomUUID()
  const event = outboxStatement(db, mutationId, CYCLE_JOB.transferNotify, {
    projectId,
    workspaceId: workspace.id,
    actorId: actor.userId,
    fromCycleId: cycleId,
    toCycleId: destinationId,
    since: now,
    mutationId
  }, sql`changes() > 0`).toSQL()
  // Plane `transfer_cycle_issues` stores the label and assignee distributions and the burndown chart (issues and,
  // for point estimates, points) next to the counts. The counts are computed in the batch below.
  const { distribution, estimate_distribution } = await cycleDistributions(
    db,
    { cycleId, projectId, workspaceId: workspace.id },
    source
  )
  const eligible = `select ci.issue_id from cycle_issues ci join issues i on i.id = ci.issue_id and i.project_id = ci.project_id
    join states s on s.id = i.state_id and s.project_id = i.project_id
    where ci.cycle_id = ? and ci.project_id = ? and ci.workspace_id = ? and ci.deleted_at is null
      and i.deleted_at is null and i.archived_at is null and i.is_draft = 0 and s.deleted_at is null
      and s."group" in ('backlog','unstarted','started')`
  const client = db.$client
  const [snapshot] = await client.batch([
    client
      .prepare(
        `update cycles set progress_snapshot = json_set((
      select json_object('total_issues', count(*),
        'completed_issues', count(*) filter (where s."group" = 'completed'),
        'cancelled_issues', count(*) filter (where s."group" = 'cancelled'),
        'started_issues', count(*) filter (where s."group" = 'started'),
        'unstarted_issues', count(*) filter (where s."group" = 'unstarted'),
        'backlog_issues', count(*) filter (where s."group" = 'backlog'))
      from cycle_issues ci join issues i on i.id = ci.issue_id and i.project_id = ci.project_id
      left join states s on s.id = i.state_id and s.project_id = i.project_id
      where ci.cycle_id = ? and ci.project_id = ? and ci.workspace_id = ? and ci.deleted_at is null
        and i.deleted_at is null and i.archived_at is null and i.is_draft = 0
    ), '$.distribution', json(?), '$.estimate_distribution', json(?)), updated_by_id = ?, updated_at = ?
    where id = ? and project_id = ? and workspace_id = ? and deleted_at is null and archived_at is null
        and (end_date is null or end_date <= ?)
      and exists (select 1 from cycles dest where dest.id = ? and dest.project_id = ? and dest.workspace_id = ?
        and dest.deleted_at is null and dest.archived_at is null and (dest.end_date is null or dest.end_date >= ?))
      and exists (select 1 from projects p join workspaces w on w.id = p.workspace_id
        join workspace_members wm on wm.workspace_id = w.id and wm.member_id = ?
        join project_members pm on pm.project_id = p.id and pm.workspace_id = w.id and pm.member_id = ?
        where p.id = ? and w.id = ? and w.slug = ? and p.deleted_at is null and p.archived_at is null and w.deleted_at is null
          and wm.is_active = 1 and wm.deleted_at is null and pm.is_active = 1 and pm.deleted_at is null
          and (pm.role >= 15 or wm.role = 20)) returning id`
      )
      .bind(
        cycleId,
        projectId,
        workspace.id,
        JSON.stringify(distribution),
        JSON.stringify(estimate_distribution),
        actor.userId,
        now,
        cycleId,
        projectId,
        workspace.id,
        now,
        destinationId,
        projectId,
        workspace.id,
        now,
        actor.userId,
        actor.userId,
        projectId,
        workspace.id,
        slug
      ),
    client
      .prepare(
        `insert into issue_activities (verb, field, issue_id, project_id, workspace_id, actor_id, old_value, new_value, comment, old_identifier, new_identifier, created_by_id, epoch, mutation_id)
      select 'updated', 'cycles', selected.issue_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? from (${eligible}) selected where changes() > 0`
      )
      .bind(
        projectId,
        workspace.id,
        actor.userId,
        // Same values as Plane `create_cycle_issue_activity` (`updated_cycle_issues`): cycle names, comment and ids.
        source.name,
        target.name,
        `updated cycle from ${source.name}\n                to ${target.name}`,
        cycleId,
        destinationId,
        actor.userId,
        now / 1000,
        mutationId,
        cycleId,
        projectId,
        workspace.id
      ),
    client
      .prepare(
        `update cycle_issues set cycle_id = ?, updated_by_id = ?, updated_at = ?
      where cycle_id = ? and project_id = ? and workspace_id = ? and deleted_at is null
        and issue_id in (${eligible}) and changes() > 0`
      )
      .bind(destinationId, actor.userId, now, cycleId, projectId, workspace.id, cycleId, projectId, workspace.id),
    client.prepare(event.sql).bind(...event.params)
  ])
  if (!snapshot.results.length) throw new ServiceError(409, 'CYCLE_CHANGED', 'Cycle or project access changed')
  await publishOutbox(db, mutationId)
  return { message: 'Success' }
}
