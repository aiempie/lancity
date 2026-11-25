import { getTableColumns } from 'drizzle-orm'
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core'

/**
 * Output shape of Plane's API serializers used by `get_model_data` (`plane/api/serializers`): a ModelSerializer with
 * `fields = "__all__"` names a foreign key after the model field (`project`, `state`), not the column
 * (`project_id`). Binary columns are not part of the payload.
 */
const foreignKeyColumns = new Map<SQLiteTable, Set<string>>()

function foreignKeysOf(table: SQLiteTable): Set<string> {
  let names = foreignKeyColumns.get(table)
  if (!names) {
    names = new Set()
    for (const fk of getTableConfig(table).foreignKeys) {
      const columns = fk.reference().columns
      if (columns.length === 1) names.add(columns[0].name)
    }
    foreignKeyColumns.set(table, names)
  }
  return names
}

/** Plane `fields = "__all__"` (minus `exclude`) of one row, keyed by Plane model field names. */
export function serializeModelRow(table: SQLiteTable, row: Record<string, unknown>, exclude: readonly string[] = []): Record<string, unknown> {
  const foreignKeys = foreignKeysOf(table)
  const result: Record<string, unknown> = {}
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    if (column.columnType.includes('Blob') || column.columnType.includes('Buffer')) continue
    const field = foreignKeys.has(column.name) && column.name.endsWith('_id') ? column.name.slice(0, -3) : column.name
    if (exclude.includes(field)) continue
    result[field] = row[key] ?? null
  }
  return result
}

/** Plane `UserLiteSerializer`. */
export function serializeUserLite(row: { id: number; name: string; email?: string | null; username: string | null; displayUsername: string | null; image: string | null }) {
  return {
    id: row.id,
    first_name: row.name,
    last_name: '',
    email: row.email ?? null,
    avatar: row.image,
    avatar_url: row.image,
    display_name: row.displayUsername ?? row.username ?? row.name
  }
}

/** Plane `StateLiteSerializer`. */
export const serializeStateLite = (row: { id: number; name: string; color: string; group: string } | null | undefined) =>
  row ? { id: row.id, name: row.name, color: row.color, group: row.group } : null

/** Plane `IssueComment` serializer: `comment_stripped` and `comment_json` are excluded. */
export const ISSUE_COMMENT_EXCLUDE = ['comment_stripped', 'comment_json'] as const
