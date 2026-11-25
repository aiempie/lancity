export type SqlValue = string | number | bigint | boolean | null | Uint8Array

export const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`

export function sqlLiteral(value: SqlValue): string {
  if (value === null) return 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Cannot write non-finite number ${value}`)
    return String(value)
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`
  return `'${value.replaceAll("'", "''")}'`
}

export function insertStatement(table: string, row: Record<string, SqlValue>): string {
  const columns = Object.keys(row)
  return `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')}) VALUES (${columns.map(column => sqlLiteral(row[column])).join(', ')});`
}
