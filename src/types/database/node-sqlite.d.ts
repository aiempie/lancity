// The offline tools use Node's SQLite API. The application still targets @types/node 20.
declare module 'node:sqlite' {
  type SQLiteValue = string | number | bigint | Uint8Array | null
  type SQLiteRow = Record<string, SQLiteValue>

  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean; timeout?: number })
    exec(sql: string): void
    close(): void
    prepare(sql: string): {
      get(...parameters: SQLiteValue[]): SQLiteRow | undefined
      all(...parameters: SQLiteValue[]): SQLiteRow[]
      run(...parameters: SQLiteValue[]): { changes: number | bigint; lastInsertRowid: number | bigint }
    }
  }
}
