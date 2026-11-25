import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
  type SQLiteTableExtraConfigValue
} from 'drizzle-orm/sqlite-core'
import type { JsonValue } from '@/types/database/schema'
import { user } from './auth'
import { auditTimestamps, auditUsers, timestamp } from './columns'
import { projects, workspaces } from './workspace'

/**
 * One file import into a project (CSV, JSON, XLSX or a Plane export). Plane's `importers` table only covers the
 * retired GitHub and Jira importers, so file imports get their own table. `file_key` is the R2 object of the upload.
 */
export const importJobs = sqliteTable(
  'import_jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    initiatedById: integer('initiated_by_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    source: text('source', { length: 20, enum: ['file', 'plane'] })
      .notNull()
      .default('file'),
    format: text('format', { length: 10, enum: ['csv', 'json', 'xlsx'] }).notNull(),
    status: text('status', { length: 50, enum: ['queued', 'processing', 'completed', 'failed'] })
      .notNull()
      .default('queued'),
    fileName: text('file_name', { length: 255 }).notNull(),
    fileKey: text('file_key').notNull().default(''),
    totalRows: integer('total_rows').notNull().default(0),
    processedRows: integer('processed_rows').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    errors: text('errors', { mode: 'json' }).$type<JsonValue>().notNull().default([]),
    reason: text('reason').notNull().default(''),
    completedAt: timestamp('completed_at'),
    deletedAt: timestamp('deleted_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('import_jobs_source_values', sql`${table.source} in ('file', 'plane')`),
    check('import_jobs_format_values', sql`${table.format} in ('csv', 'json', 'xlsx')`),
    check('import_jobs_status_values', sql`${table.status} in ('queued', 'processing', 'completed', 'failed')`),
    check('import_jobs_errors_json', sql`json_valid(${table.errors}) and json_type(${table.errors}) = 'array'`),
    foreignKey({
      name: 'import_jobs_project_id_workspace_id_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    index('import_jobs_workspace_id_idx').on(table.workspaceId),
    index('import_jobs_project_id_idx').on(table.projectId),
    index('import_jobs_initiated_by_id_idx').on(table.initiatedById),
    index('import_jobs_created_by_id_idx').on(table.createdById),
    index('import_jobs_updated_by_id_idx').on(table.updatedById)
  ]
)
