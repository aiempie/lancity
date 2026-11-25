import { and, eq, gt, isNull, lte, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@/db/schema'
import { intakeIssues } from '@/db/schema/planning'
import { issues, states } from '@/db/schema/issue'
import { projects } from '@/db/schema/workspace'
import type { InfraEnv } from '@/server/common/env'
import { outboxStatement, publishOutbox } from '@/server/common/outbox'
import { ISSUE_JOB, logIssueJob } from '@/server/issue/activity/index'
import type { LancityDb } from '@/types/database/schema'

const DAY_MS = 24 * 60 * 60 * 1000
const CHUNK = 25

const dbOf = (env: InfraEnv) => drizzle(env.DB, { schema }) as unknown as LancityDb

/**
 * Issues of a project that automation may touch: live, not archived, not draft, not triage, in one of `groups`,
 * idle for `months * 30` days, and not held by an open cycle, an open module or an unresolved intake request.
 * Mirrors the `Issue.issue_objects` filters of Plane's issue_automation_task.py.
 */
async function candidateIssueIds(db: LancityDb, projectId: number, groups: string[], months: number, now: Date) {
  const cutoff = now.getTime() - months * 30 * DAY_MS
  const today = now.toISOString().slice(0, 10)
  const rows = await db.all<{ id: number }>(sql`select i.id from issues i
    join states s on s.id = i.state_id
    where i.project_id = ${projectId} and i.deleted_at is null and i.archived_at is null and i.is_draft = 0
      and s."group" in (${sql.join(
        groups.map(g => sql`${g}`),
        sql`, `
      )}) and s."group" != 'triage'
      and i.updated_at <= ${cutoff}
      and (not exists (select 1 from cycle_issues ci where ci.issue_id = i.id and ci.deleted_at is null)
        or exists (select 1 from cycle_issues ci join cycles c on c.id = ci.cycle_id
          where ci.issue_id = i.id and ci.deleted_at is null and c.end_date < ${now.getTime()}))
      and (not exists (select 1 from module_issues mi where mi.issue_id = i.id and mi.deleted_at is null)
        or exists (select 1 from module_issues mi join modules m on m.id = mi.module_id
          where mi.issue_id = i.id and mi.deleted_at is null and m.target_date < ${today}))
      and (not exists (select 1 from intake_issues ii where ii.issue_id = i.id and ii.deleted_at is null)
        or exists (select 1 from intake_issues ii where ii.issue_id = i.id and ii.deleted_at is null and ii.status in (1, -1, 2)))
    order by i.id`)
  return rows.map(row => row.id)
}

async function applyIssueAutomation(
  db: LancityDb,
  env: InfraEnv,
  project: { id: number; createdById: number | null },
  ids: number[],
  now: Date,
  update: { archivedAt: string } | { stateId: number },
  requestedData: Record<string, unknown>,
  currentInstance: Record<string, unknown> | null
) {
  let count = 0
  for (let start = 0; start < ids.length; start += CHUNK) {
    const mutations = ids.slice(start, start + CHUNK).map(issueId => ({ issueId, key: crypto.randomUUID() }))
    const statements = mutations.flatMap(({ issueId, key }) => [
      db.update(issues)
        // Plane's bulk update preserves updated_at.
        .set({ ...update, updatedAt: sql`updated_at` })
        .where(and(eq(issues.id, issueId), isNull(issues.deletedAt), isNull(issues.archivedAt)))
        .returning({ id: issues.id }),
      outboxStatement(db, key, ISSUE_JOB.activity, {
        type: 'issue.activity.updated',
        requestedData: JSON.stringify(requestedData),
        actorId: project.createdById,
        issueId,
        projectId: project.id,
        currentInstance: currentInstance ? JSON.stringify(currentInstance) : null,
        subscriber: false,
        epoch: Math.floor(now.getTime() / 1000),
        notification: true
      }, sql`changes() = 1`)
    ])
    const [first, ...rest] = statements
    const results = await db.batch([first, ...rest])
    const committed = mutations.filter((_, index) => {
      const updated = results[index * 2]
      return Array.isArray(updated) && updated.length > 0
    })
    count += committed.length
    await Promise.all(committed.map(({ key }) => publishOutbox(db, key, env)))
  }
  return count
}

/** PD-1179. Safe to repeat: archived issues no longer match the filter. */
export async function archiveOldIssues(env: InfraEnv, now = new Date()): Promise<number> {
  const db = dbOf(env)
  const rows = await db
    .select({ id: projects.id, archiveIn: projects.archiveIn, createdById: projects.createdById })
    .from(projects)
    .where(and(gt(projects.archiveIn, 0), isNull(projects.deletedAt), isNull(projects.archivedAt)))
  let total = 0
  for (const project of rows) {
    try {
      const ids = await candidateIssueIds(db, project.id, ['completed', 'cancelled'], project.archiveIn, now)
      if (!ids.length) continue
      const archivedAt = now.toISOString().slice(0, 10)
      total += await applyIssueAutomation(
        db, env, project, ids, now, { archivedAt }, { archived_at: archivedAt, automation: true }, { archived_at: null }
      )
    } catch (error) {
      logIssueJob('error', 'issue.automation.archive', { projectId: project.id, message: String(error) })
    }
  }
  return total
}

/**
 * PD-1180. Plane picks `State.objects.filter(group="cancelled").first()` across every project when the project has
 * no default state. That state belongs to another project and breaks the issue/state foreign key, so the first
 * cancelled state of the same project is used instead. A project without any close state is skipped.
 */
export async function closeOldIssues(env: InfraEnv, now = new Date()): Promise<number> {
  const db = dbOf(env)
  const rows = await db
    .select({
      id: projects.id,
      closeIn: projects.closeIn,
      defaultStateId: projects.defaultStateId,
      createdById: projects.createdById
    })
    .from(projects)
    .where(and(gt(projects.closeIn, 0), isNull(projects.deletedAt), isNull(projects.archivedAt)))
  let total = 0
  for (const project of rows) {
    try {
      const ids = await candidateIssueIds(db, project.id, ['backlog', 'unstarted', 'started'], project.closeIn, now)
      if (!ids.length) continue
      let closeStateId = project.defaultStateId
      if (closeStateId === null) {
        const [cancelled] = await db
          .select({ id: states.id })
          .from(states)
          .where(and(eq(states.projectId, project.id), eq(states.group, 'cancelled'), isNull(states.deletedAt)))
          .orderBy(states.sequence, states.id)
          .limit(1)
        closeStateId = cancelled?.id ?? null
      }
      if (closeStateId === null) {
        logIssueJob('warn', 'issue.automation.close', { projectId: project.id, message: 'No close state' })
        continue
      }
      total += await applyIssueAutomation(
        db, env, project, ids, now, { stateId: closeStateId }, { closed_to: closeStateId }, null
      )
    } catch (error) {
      logIssueJob('error', 'issue.automation.close', { projectId: project.id, message: String(error) })
    }
  }
  return total
}

/** PD-1178: archive first, then close (daily at 01:00 UTC). */
export async function archiveAndCloseOldIssues(env: InfraEnv): Promise<void> {
  await archiveOldIssues(env)
  await closeOldIssues(env)
}

/** PD-1181: return snoozed intake items whose snooze has lapsed to pending (every 5 minutes). */
export async function unsnoozeExpiredIntakeIssues(env: InfraEnv, now = new Date()): Promise<number> {
  const rows = await dbOf(env)
    .update(intakeIssues)
    .set({ status: -2, snoozedTill: null, updatedAt: now })
    .where(and(eq(intakeIssues.status, 0), lte(intakeIssues.snoozedTill, now), isNull(intakeIssues.deletedAt)))
    .returning({ id: intakeIssues.id })
  if (rows.length) logIssueJob('info', 'issue.automation.unsnooze', { count: rows.length })
  return rows.length
}
