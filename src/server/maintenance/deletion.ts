import { sql } from 'drizzle-orm'
import type { LancityDb } from '@/types/database/schema'
import { cascadeGraph, changes, q } from '@/server/maintenance/cascade'

export { restoreRelatedObjects, softDeleteRelatedObjects } from '@/server/maintenance/cascade'

/** Plane `HARD_DELETE_AFTER_DAYS` default. */
export const HARD_DELETE_AFTER_DAYS = 60
const DAY_MS = 86_400_000
const BATCH_SIZE = 500

/** Order of `hard_delete`: the explicit models first, then every other soft-deletable table. */
const PRIORITY_TABLES = [
  'workspaces',
  'projects',
  'cycles',
  'modules',
  'issues',
  'pages',
  'issue_views',
  'labels',
  'states',
  'issue_activities',
  'issue_comments',
  'issue_links',
  'issue_reactions',
  'user_favorites',
  'module_issues',
  'cycle_issues',
  'estimates',
  'estimate_points'
]

/** Tables `hardDelete` visits, in order. `user` rows are never removed here (Better Auth owns them). */
export function hardDeleteTables(): string[] {
  const { tables } = cascadeGraph()
  const rest = [...tables.values()]
    .filter(t => t.softDelete && t.name !== 'user' && !PRIORITY_TABLES.includes(t.name))
    .map(t => t.name)
    .sort()
  return [...PRIORITY_TABLES.filter(name => tables.get(name)?.softDelete), ...rest]
}

export type HardDeleteResult = { deleted: Record<string, number>; failed: string[]; statements: number; next: number | null }

/**
 * PD-1106 `hard_delete`: remove rows soft deleted more than `days` ago. SQLite foreign keys do what Django's
 * collector did (cascade and set null). Relations that restrict (Django `DO_NOTHING` without a database
 * constraint) are detached first by nulling the child column, so the delete is not blocked.
 * `statements` is capped per invocation (D1 subrequest budget); `next` is the table index to continue from.
 */
export async function hardDelete(
  db: LancityDb,
  options: { days?: number; now?: number; from?: number; budget?: number } = {}
): Promise<HardDeleteResult> {
  const days = options.days ?? HARD_DELETE_AFTER_DAYS
  const cutoff = (options.now ?? Date.now()) - days * DAY_MS
  const budget = options.budget ?? 400
  const { edges } = cascadeGraph()
  const names = hardDeleteTables()
  const result: HardDeleteResult = { deleted: {}, failed: [], statements: 0, next: null }
  for (let index = options.from ?? 0; index < names.length; index++) {
    const table = names[index]
    const expired = `select id from ${q(table)} where deleted_at is not null and deleted_at < ${cutoff}`
    const detach = edges.filter(e => e.parent === table && e.onDelete === 'other' && e.nullable)
    try {
      for (;;) {
        if (result.statements >= budget) return { ...result, next: index }
        const found = await db.all<{ id: number }>(sql.raw(`${expired} limit 1`))
        result.statements++
        if (!found.length) break
        const batch = `${expired} order by id limit ${BATCH_SIZE}`
        for (const edge of detach) {
          await db.run(sql.raw(`update ${q(edge.child)} set ${q(edge.column)} = null where ${q(edge.column)} in (${batch})`))
          result.statements++
        }
        const deleted = changes(await db.run(sql.raw(`delete from ${q(table)} where id in (${batch})`)))
        result.statements++
        result.deleted[table] = (result.deleted[table] ?? 0) + deleted
        if (deleted < BATCH_SIZE) break
      }
    } catch (error) {
      // A blocked table must not stop the rest of the run (Plane ignores per-model results too).
      result.failed.push(table)
      console.error(JSON.stringify({ level: 'error', label: 'maintenance.hard_delete', table, message: String(error) }))
    }
  }
  return result
}
