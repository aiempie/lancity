import { desc, eq } from 'drizzle-orm'
import { maintenanceRuns } from '@/db/schema/ext-p4-maintenance'
import { logException } from '@/server/common/exception-logger'
import type { LancityDb } from '@/types/database/schema'

/**
 * Run `task` and keep a `maintenance_runs` row about it. Recording is best effort: when the table is missing
 * (migration not applied yet) or a write fails, the task still runs and its result is returned.
 */
export async function recordRun<T extends Record<string, unknown>>(
  db: LancityDb,
  name: string,
  task: () => Promise<T>,
  actorId?: number
): Promise<T> {
  let runId: number | undefined
  try {
    const [row] = await db.insert(maintenanceRuns).values({ task: name, actorId: actorId ?? null }).returning({ id: maintenanceRuns.id })
    runId = row?.id
  } catch (error) {
    logException(error, { warning: true, context: { label: 'maintenance_runs' } })
  }
  const finish = async (values: Partial<typeof maintenanceRuns.$inferInsert>) => {
    if (runId === undefined) return
    try {
      await db.update(maintenanceRuns).set({ ...values, finishedAt: new Date() }).where(eq(maintenanceRuns.id, runId))
    } catch (error) {
      logException(error, { warning: true, context: { label: 'maintenance_runs' } })
    }
  }
  try {
    const result = await task()
    await finish({ status: 'completed', result })
    return result
  } catch (error) {
    await finish({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

/** Latest runs, newest first. */
export function listRuns(db: LancityDb, options: { task?: string; limit?: number } = {}) {
  const query = db.select().from(maintenanceRuns).$dynamic()
  if (options.task) query.where(eq(maintenanceRuns.task, options.task))
  return query.orderBy(desc(maintenanceRuns.id)).limit(options.limit ?? 20)
}
