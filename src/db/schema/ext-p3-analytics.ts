import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
  type SQLiteTableExtraConfigValue
} from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { user } from './auth'
import { auditTimestamps, timestamp } from './columns'
import { workspaces } from './workspace'

/**
 * One row per analytics CSV export (Plane `analytic_export_task` has no record). The job is queued with the row id,
 * so a redelivered message can tell that the file already exists or the email was already sent. The CSV itself
 * lives in R2 under `objectKey`; only the requesting user can download it.
 */
export const analyticExports = sqliteTable(
  'analytic_exports',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    workspaceId: integer('workspace_id')
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references((): AnySQLiteColumn => user.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    /** Request body of the export: `x_axis`, `y_axis`, `segment` and the issue filters. */
    params: text('params', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    status: text('status', { length: 20, enum: ['queued', 'processing', 'completed', 'failed'] })
      .notNull()
      .default('queued'),
    objectKey: text('object_key'),
    error: text('error'),
    completedAt: timestamp('completed_at'),
    emailedAt: timestamp('emailed_at')
  },
  (table): SQLiteTableExtraConfigValue[] => [
    check('analytic_exports_status_values', sql`${table.status} in ('queued', 'processing', 'completed', 'failed')`),
    check('analytic_exports_params_json', sql`json_valid(${table.params})`),
    index('analytic_exports_workspace_id_idx').on(table.workspaceId),
    index('analytic_exports_user_id_idx').on(table.userId)
  ]
)
