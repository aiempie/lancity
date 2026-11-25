import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@/db/schema'
import { cycleAccess, loadCycle } from '@/server/cycle/access'
import { annotatedCyclesSql } from '@/server/cycle/queries'
import type { InfraEnv } from '@/server/common/env'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

/**
 * Cron `cycle.snapshot`: upsert today's counts and estimate points of every active cycle (started, not ended, not
 * archived or deleted, in a live project). Running it again on the same UTC day overwrites that day's row, so the
 * job is safe to retry. Plane has no equivalent, the burndown there is recomputed from `completed_at`; the table
 * keeps the history of issues that later left the cycle.
 */
export async function snapshotActiveCycles(env: InfraEnv, now = Date.now()): Promise<void> {
  const db = drizzle(env.DB, { schema }) as unknown as LancityDb
  const day = new Date(now).toISOString().slice(0, 10)
  const active = annotatedCyclesSql({
    userId: 0,
    now,
    estimates: true,
    order: sql`c.id`,
    where: sql`c.deleted_at is null and c.archived_at is null and c.start_date <= ${now} and c.end_date >= ${now}
      and exists (select 1 from projects p where p.id = c.project_id and p.deleted_at is null and p.archived_at is null)`
  })
  await db.run(sql`insert into cycle_progress_snapshots
      (cycle_id, project_id, workspace_id, snapshot_date, total_issues, completed_issues, cancelled_issues,
       started_issues, unstarted_issues, backlog_issues, total_estimate_points, completed_estimate_points, created_at)
    select id, project_id, workspace_id, ${day}, total_issues, completed_issues, cancelled_issues, started_issues,
      unstarted_issues, backlog_issues, total_estimate_points, completed_estimate_points, ${now}
    from (${active}) where 1 = 1
    on conflict (cycle_id, snapshot_date) do update set
      total_issues = excluded.total_issues, completed_issues = excluded.completed_issues,
      cancelled_issues = excluded.cancelled_issues, started_issues = excluded.started_issues,
      unstarted_issues = excluded.unstarted_issues, backlog_issues = excluded.backlog_issues,
      total_estimate_points = excluded.total_estimate_points,
      completed_estimate_points = excluded.completed_estimate_points`)
}

/** `GET .../cycles/:id/snapshots`: the daily history, oldest first, with the remaining issues and points. */
export async function listCycleSnapshots(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  cycleId: number
) {
  const { workspace } = await cycleAccess(db, actor, slug, projectId, 5)
  await loadCycle(db, workspace.id, projectId, cycleId)
  const rows = await db.all<Record<string, unknown>>(
    sql`select snapshot_date, total_issues, completed_issues, cancelled_issues, started_issues, unstarted_issues,
        backlog_issues, total_estimate_points, completed_estimate_points
      from cycle_progress_snapshots where cycle_id = ${cycleId} and project_id = ${projectId} and workspace_id = ${workspace.id}
      order by snapshot_date asc`
  )
  return rows.map(row => ({
    date: row.snapshot_date,
    totalIssues: Number(row.total_issues),
    completedIssues: Number(row.completed_issues),
    cancelledIssues: Number(row.cancelled_issues),
    startedIssues: Number(row.started_issues),
    unstartedIssues: Number(row.unstarted_issues),
    backlogIssues: Number(row.backlog_issues),
    remainingIssues: Number(row.total_issues) - Number(row.completed_issues),
    totalEstimatePoints: Number(row.total_estimate_points),
    completedEstimatePoints: Number(row.completed_estimate_points),
    remainingEstimatePoints: Number(row.total_estimate_points) - Number(row.completed_estimate_points)
  }))
}
