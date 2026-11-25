import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { now, timestamp } from './columns'

/**
 * One row per maintenance run (cleanup, hard delete, seed, admin command). Replaces the Celery result backend and
 * the stdout of Django management commands, so an operator can see what a run did.
 */
export const maintenanceRuns = sqliteTable(
  'maintenance_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    task: text('task', { length: 100 }).notNull(),
    status: text('status', { length: 20, enum: ['running', 'completed', 'failed'] })
      .notNull()
      .default('running'),
    actorId: integer('actor_id'),
    result: text('result', { mode: 'json' }).$type<Record<string, unknown>>(),
    error: text('error'),
    startedAt: now('started_at').notNull(),
    finishedAt: timestamp('finished_at')
  },
  table => [index('maintenance_runs_task_started_at_idx').on(table.task, table.startedAt)]
)

export const cascadeJobs = sqliteTable(
  'cascade_jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobKey: text('job_key').notNull(),
    rootTable: text('root_table').notNull(),
    rootId: integer('root_id').notNull(),
    deletionStamp: integer('deletion_stamp').notNull()
  },
  table => [uniqueIndex('cascade_jobs_job_key_unique').on(table.jobKey)]
)

export const cascadeNodes = sqliteTable(
  'cascade_nodes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: integer('job_id').notNull().references(() => cascadeJobs.id, { onDelete: 'cascade' }),
    tableName: text('table_name').notNull(),
    rowId: integer('row_id').notNull(),
    processed: integer('processed', { mode: 'boolean' }).notNull().default(false)
  },
  table => [
    uniqueIndex('cascade_nodes_job_table_row_unique').on(table.jobId, table.tableName, table.rowId),
    index('cascade_nodes_pending_idx').on(table.jobId, table.processed, table.id)
  ]
)
