import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type ColumnInfo = { name: string; type: string; notNull: boolean; hasDefault: boolean; primaryKey: boolean }
export type TableInfo = { name: string; columns: Map<string, ColumnInfo>; foreignKeys: Map<string, string> }
export type TargetSchema = { tables: Map<string, TableInfo>; order: string[] }

/** Build an in-memory D1 copy from the Drizzle SQL migrations. The caller owns (and closes) the returned database. */
export function openTargetDatabase(drizzleDir: string): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  const files = readdirSync(drizzleDir)
    .filter(name => /^\d+.*\.sql$/.test(name))
    .sort()
  for (const file of files) db.exec(readFileSync(join(drizzleDir, file), 'utf8'))
  return db
}

/** Read table, column and foreign-key metadata from a migrated database. Foreign keys map a column to the table it references. */
export function readTargetSchema(db: DatabaseSync): TargetSchema {
  const tables = new Map<string, TableInfo>()
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'")
    .all()
    .map(row => String(row.name))
  for (const name of names) {
    const columns = new Map<string, ColumnInfo>()
    for (const column of db.prepare(`PRAGMA table_info("${name}")`).all()) {
      columns.set(String(column.name), {
        name: String(column.name),
        type: String(column.type).toUpperCase(),
        notNull: Number(column.notnull) === 1,
        hasDefault: column.dflt_value !== null,
        primaryKey: Number(column.pk) > 0
      })
    }
    const foreignKeys = new Map<string, string>()
    for (const key of db.prepare(`PRAGMA foreign_key_list("${name}")`).all()) {
      // Composite keys list their parts separately; the single-column part is the one a row's own column refers to.
      if (String(key.to) === 'id' && String(key.from) !== 'id') foreignKeys.set(String(key.from), String(key.table))
    }
    tables.set(name, { name, columns, foreignKeys })
  }
  return { tables, order: topologicalOrder(tables) }
}

/** Parents before children. Self references and cycles are ignored; the SQL defers foreign-key checks to the end. */
export function topologicalOrder(tables: Map<string, TableInfo>): string[] {
  const order: string[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (name: string) => {
    if (state.has(name)) return
    state.set(name, 'visiting')
    for (const parent of new Set(tables.get(name)?.foreignKeys.values())) if (parent !== name && tables.has(parent)) visit(parent)
    state.set(name, 'done')
    order.push(name)
  }
  for (const name of [...tables.keys()].sort()) visit(name)
  return order
}
