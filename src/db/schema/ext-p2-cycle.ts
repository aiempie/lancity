import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
  type SQLiteTableExtraConfigValue
} from 'drizzle-orm/sqlite-core'
import { now } from './columns'
import { cycles } from './planning'
import { projects, workspaces } from './workspace'

/**
 * One row per cycle and UTC day, written by the `cycle.snapshot` cron. It keeps the issue counts and estimate
 * points of an active cycle so the burndown history survives issues that later leave the cycle.
 */
export const cycleProgressSnapshots = sqliteTable(
  'cycle_progress_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    cycleId: integer('cycle_id')
      .notNull()
      .references((): AnySQLiteColumn => cycles.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    /** UTC day, `YYYY-MM-DD`. */
    snapshotDate: text('snapshot_date', { length: 10 }).notNull(),
    totalIssues: integer('total_issues').notNull().default(0),
    completedIssues: integer('completed_issues').notNull().default(0),
    cancelledIssues: integer('cancelled_issues').notNull().default(0),
    startedIssues: integer('started_issues').notNull().default(0),
    unstartedIssues: integer('unstarted_issues').notNull().default(0),
    backlogIssues: integer('backlog_issues').notNull().default(0),
    totalEstimatePoints: real('total_estimate_points').notNull().default(0),
    completedEstimatePoints: real('completed_estimate_points').notNull().default(0),
    createdAt: now('created_at').notNull()
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('cycle_progress_snapshots_cycle_id_snapshot_date_unique').on(table.cycleId, table.snapshotDate),
    index('cycle_progress_snapshots_project_id_idx').on(table.projectId),
    index('cycle_progress_snapshots_workspace_id_idx').on(table.workspaceId)
  ]
)
