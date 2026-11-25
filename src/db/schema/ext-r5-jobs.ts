import { index, integer, sqliteTable, text, uniqueIndex, type SQLiteTableExtraConfigValue } from 'drizzle-orm/sqlite-core'
import { now } from './columns'

/**
 * Idempotency claims of background jobs. Queues deliver at least once, so a handler that writes data inserts a
 * claim with a unique `key` (for example `issue.activity:<jobId>`) in the same D1 batch as its writes. A redelivery
 * finds the claim and skips the writes. `activity:<id>` claims record which job fanned out which activity row,
 * with the job id in `owner`.
 */
export const jobClaims = sqliteTable(
  'job_claims',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    key: text('key', { length: 255 }).notNull(),
    owner: text('owner', { length: 255 }),
    createdAt: now('created_at').notNull()
  },
  (table): SQLiteTableExtraConfigValue[] => [uniqueIndex('job_claims_key_unique').on(table.key)]
)

/** Durable messages written atomically with their originating mutation. */
export const jobOutbox = sqliteTable(
  'job_outbox',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventKey: text('event_key').notNull(),
    type: text('type').notNull(),
    payload: text('payload').notNull(),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    createdAt: now('created_at').notNull()
  },
  (table): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('job_outbox_event_key_unique').on(table.eventKey),
    index('job_outbox_pending_idx').on(table.publishedAt, table.id),
    index('job_outbox_completion_idx').on(table.type, table.completedAt, table.id)
  ]
)
