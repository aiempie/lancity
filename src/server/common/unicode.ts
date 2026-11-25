import { sql, type SQL } from 'drizzle-orm'

/** Search columns are folded per Unicode code point by the database triggers. */
/** Maximum term length accepted for pattern building (each letter becomes a class of up to 4 variants). */
export const MAX_FOLD_TERM_LENGTH = 1000

/** Case variants of one code point that are themselves a single code point. */
export function caseVariants(char: string): string[] {
  const variants = new Set([char, char.toLowerCase(), char.toUpperCase(), char.toUpperCase().toLowerCase()])
  return [...variants].filter(variant => [...variant].length === 1)
}

/** Unicode-aware lowercase for JS-side comparison (NFC, then `toLowerCase`). */
export const foldCase = (value: string) => [...value].map(char => char.toLowerCase()).join('')

const GLOB_SPECIAL: Record<string, string> = { '*': '[*]', '?': '[?]', '[': '[[]' }

/** GLOB pattern matching `term` exactly, ignoring Unicode case. */
export function foldGlob(term: string): string {
  let out = ''
  for (const char of term.normalize('NFC').slice(0, MAX_FOLD_TERM_LENGTH)) {
    if (GLOB_SPECIAL[char]) out += GLOB_SPECIAL[char]
    else {
      const variants = caseVariants(char)
      out += variants.length > 1 ? `[${variants.join('')}]` : char
    }
  }
  return out
}

/** GLOB pattern matching any text that contains `term`, ignoring Unicode case. */
export const foldContainsGlob = (term: string) => `*${foldGlob(term)}*`

/**
 * D1 rejects a LIKE/GLOB pattern longer than 50 bytes ("pattern too complex"), and every cased letter costs up to 4
 * bytes in the folded pattern, so terms longer than about a dozen letters need another strategy.
 */
export const MAX_GLOB_PATTERN_BYTES = 50

const byteLength = (value: string) => new TextEncoder().encode(value).length

/** Splits the (NFC) term into runs of code points whose folded glob (without the outer `*`) fits the D1 limit. */
function globChunks(term: string, limit: number): string[] {
  const chunks: string[] = []
  let current = ''
  for (const char of term.normalize('NFC').slice(0, MAX_FOLD_TERM_LENGTH)) {
    if (current && byteLength(foldGlob(current + char)) > limit) {
      chunks.push(current)
      current = ''
    }
    current += char
  }
  if (current) chunks.push(current)
  return chunks
}

/** Look up the maintained search representation for a row and field. */
export const searchValue = (table: string, field: string, rowId: SQL): SQL =>
  sql`(select value from search_values where source_table = ${table} and row_id = ${rowId} and field = ${field})`

/**
 * A persisted folded column makes long Unicode substring matches exact and keeps
 * filtering inside SQLite before ORDER BY and LIMIT. Callers without a stored
 * column use bounded GLOB chunks at each candidate offset, preserving adjacency.
 */
export const containsFolded = (column: SQL | ReturnType<typeof sql.raw>, term: string, normalizedColumn?: SQL): SQL => {
  const pattern = foldContainsGlob(term)
  if (byteLength(pattern) <= MAX_GLOB_PATTERN_BYTES) return sql`${column} glob ${pattern}`
  const normalized = term.slice(0, MAX_FOLD_TERM_LENGTH)
  if (normalizedColumn) return sql`instr(${normalizedColumn}, ${foldCase(normalized)}) > 0`
  if (/^[\x00-\x7f]*$/.test(normalized)) return sql`instr(lower(${column}), ${normalized.toLowerCase()}) > 0`
  let offset = 0
  const chunks = globChunks(normalized, MAX_GLOB_PATTERN_BYTES).map(chunk => {
    const result = { offset, length: [...chunk].length, pattern: foldGlob(chunk) }
    offset += result.length
    return result
  })
  return sql`exists (with recursive starts(pos) as (
    select 1 union all select pos + 1 from starts where pos < length(${column}) - ${offset} + 1
  ) select 1 from starts where pos <= length(${column}) - ${offset} + 1 and not exists (
    select 1 from json_each(${JSON.stringify(chunks)}) part
    where substr(${column}, pos + json_extract(part.value, '$.offset'), json_extract(part.value, '$.length'))
      not glob json_extract(part.value, '$.pattern')
  ))`
}

/** `column` equals `term` ignoring Unicode case. A pattern over the D1 limit compares the text chunk by chunk. */
export const equalsFolded = (column: SQL | ReturnType<typeof sql.raw>, term: string): SQL => {
  const pattern = foldGlob(term)
  if (byteLength(pattern) <= MAX_GLOB_PATTERN_BYTES) return sql`${column} glob ${pattern}`
  const normalized = term.normalize('NFC').slice(0, MAX_FOLD_TERM_LENGTH)
  let offset = 1
  const conditions: SQL[] = [sql`length(${column}) = ${[...normalized].length}`]
  for (const chunk of globChunks(normalized, MAX_GLOB_PATTERN_BYTES)) {
    const size = [...chunk].length
    conditions.push(sql`substr(${column}, ${offset}, ${size}) glob ${foldGlob(chunk)}`)
    offset += size
  }
  return sql`(${sql.join(conditions, sql` and `)})`
}
