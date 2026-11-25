import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { auditTimestamps } from './columns'

/** Small key/value state for instance background jobs (e.g. the last telemetry push time as epoch milliseconds). */
export const instanceJobState = sqliteTable(
  'instance_job_state',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    key: text('key', { length: 100 }).notNull(),
    value: text('value').notNull().default('')
  },
  table => [uniqueIndex('instance_job_state_key_key').on(table.key)]
)
