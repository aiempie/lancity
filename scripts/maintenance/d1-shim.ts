import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { getDb } from '../../src/db/client'
import type { LancityDb } from '../../src/types/database/schema'

type Param = null | number | bigint | string | Uint8Array
/** Statement API of Node 24's `node:sqlite` beyond what `node-sqlite.d.ts` declares. */
type StatementSync = {
  columns(): unknown[]
  setReturnArrays(enabled: boolean): void
  all(...params: Param[]): unknown[]
  run(...params: Param[]): { changes: number | bigint; lastInsertRowid: number | bigint }
}

/**
 * Minimal D1 binding on top of a local SQLite file (the files Wrangler keeps in `.cloudflare/state/v3/d1/`),
 * enough for Drizzle's D1 driver: `prepare().bind().run/all/raw/first` and `batch` (one transaction).
 * It lets the maintenance services run unchanged from a terminal.
 */
export function createLocalD1(database: DatabaseSync): D1Database {
  const result = (rows: unknown[], changes: number, lastRowId: number) => ({
    success: true,
    results: rows,
    meta: { changes, last_row_id: lastRowId, rows_read: rows.length, rows_written: changes, duration: 0 }
  })

  function execute(sql: string, params: Param[], mode: 'all' | 'raw') {
    const statement = database.prepare(sql) as unknown as StatementSync
    if (statement.columns().length === 0) {
      const info = statement.run(...params)
      return result([], Number(info.changes), Number(info.lastInsertRowid))
    }
    if (mode === 'raw') statement.setReturnArrays(true)
    const rows = statement.all(...params)
    const info = database.prepare('select changes() as changes, last_insert_rowid() as id').get() as unknown as { changes: number; id: number }
    return result(rows, Number(info.changes), Number(info.id))
  }

  function prepare(sql: string, params: Param[] = []) {
    const statement = {
      sql,
      params,
      bind: (...values: Param[]) => prepare(sql, values),
      run: async () => execute(sql, params, 'all'),
      all: async () => execute(sql, params, 'all'),
      raw: async () => execute(sql, params, 'raw').results,
      first: async () => (execute(sql, params, 'all').results[0] ?? null) as unknown
    }
    return statement
  }

  return {
    prepare: (sql: string) => prepare(sql),
    batch: async (statements: ReturnType<typeof prepare>[]) => {
      database.exec('begin')
      try {
        const results = statements.map(statement => execute(statement.sql, statement.params, 'all'))
        database.exec('commit')
        return results
      } catch (error) {
        database.exec('rollback')
        throw error
      }
    },
    exec: async (sql: string) => {
      database.exec(sql)
      return { count: 1, duration: 0 }
    }
  } as unknown as D1Database
}

/** Open a local D1 SQLite file as a Drizzle client (built by `getDb`, so `db.run` joins batches like on D1) with foreign keys on. */
export function openLocalDb(file: string): { db: LancityDb; close: () => void } {
  if (!file || !existsSync(file)) throw new Error('Pass the path of an existing local D1 SQLite file (not metadata.sqlite)')
  const database = new DatabaseSync(file)
  database.exec('pragma foreign_keys = on')
  return { db: getDb(createLocalD1(database)), close: () => database.close() }
}
