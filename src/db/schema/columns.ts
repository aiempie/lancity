import { sql } from 'drizzle-orm'
import { integer } from 'drizzle-orm/sqlite-core'
import { user } from './auth'

const nowInMilliseconds = sql`(cast(unixepoch('subsec') * 1000 as integer))`

export function timestamp(name: string) {
  return integer(name, { mode: 'timestamp_ms' })
}

export function now(name: string) {
  return timestamp(name).default(nowInMilliseconds)
}

export function auditTimestamps() {
  return {
    createdAt: now('created_at').notNull(),
    updatedAt: now('updated_at')
      .notNull()
      .$onUpdate(() => new Date())
  }
}

export function auditUsers() {
  return {
    createdById: integer('created_by_id').references(() => user.id, { onDelete: 'set null' }),
    updatedById: integer('updated_by_id').references(() => user.id, { onDelete: 'set null' })
  }
}
