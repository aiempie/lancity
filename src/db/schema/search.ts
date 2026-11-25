import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/** Unicode lowercase mapping used by search-value maintenance triggers. */
export const searchCaseMapping = sqliteTable('search_case_mapping', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  character: text('character').notNull(),
  folded: text('folded').notNull()
}, table => [uniqueIndex('search_case_mapping_character_unique').on(table.character)])

/** Persisted folded text; source row lifecycle is maintained by database triggers. */
export const searchValues = sqliteTable('search_values', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceTable: text('source_table').notNull(),
  rowId: integer('row_id').notNull(),
  field: text('field').notNull(),
  value: text('value').notNull()
}, table => [uniqueIndex('search_values_source_unique').on(table.sourceTable, table.rowId, table.field)])
