import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@/db/schema'
import type { LancityDb } from '@/types/database/schema'

/** Create a database client for the current Worker request or an explicit D1 binding. */
// Loaded dynamically so modules that import this file can also load under Node (unit tests).
let workers: typeof import('cloudflare:workers') | null = null
void import('cloudflare:workers').then(
  module => void (workers = module),
  () => undefined
)

export function getDb(binding?: D1Database): LancityDb {
  const db = binding ?? (workers?.env as unknown as { DB: D1Database } | undefined)?.DB
  if (!db) throw new Error('The DB D1 binding is not configured')
  const client = drizzle(db, { schema })
  // drizzle's D1 batch() binds `query.stmt` for statements with parameters, but SQLiteRaw (db.run) has none,
  // which fails with "Cannot read properties of undefined (reading 'bind')". Provide it so db.run(sql`...`) can join a batch.
  const run = client.run.bind(client)
  client.run = ((query: Parameters<typeof run>[0]) => {
    const raw = run(query)
    Object.defineProperty(raw, 'stmt', {
      get: () => ({ bind: (...params: unknown[]) => db.prepare(raw.getQuery().sql).bind(...params) })
    })
    return raw
  }) as typeof client.run
  return client
}
