import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { planeDumpRowSchema, type PlaneDump, type PlaneDumpRow } from '../../src/types/database/p4-migrations-schema'

/**
 * Parse Postgres `COPY ... CSV HEADER` output. An unquoted empty field is NULL, a quoted empty field is an empty string.
 * Postgres writes `\x...` for bytea and `t`/`f` for booleans; both are converted later against the target column type.
 */
export function parseCsv(text: string): PlaneDumpRow[] {
  const rows: (string | null)[][] = []
  let row: (string | null)[] = []
  let field = ''
  let quoted = false
  let wasQuoted = false
  let any = false
  const endField = () => {
    row.push(!wasQuoted && field === '' ? null : field)
    field = ''
    wasQuoted = false
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
    any = false
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') {
      quoted = true
      wasQuoted = true
      any = true
    } else if (char === ',') {
      endField()
      any = true
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      if (any || field) endRow()
    } else {
      field += char
      any = true
    }
  }
  if (any || field) endRow()
  const [header, ...body] = rows
  if (!header) return []
  return body.map(values => Object.fromEntries(header.map((name, index) => [String(name), values[index] ?? null])))
}

function parseRows(path: string): PlaneDumpRow[] {
  const text = readFileSync(path, 'utf8')
  const raw: unknown[] = path.endsWith('.csv')
    ? parseCsv(text)
    : path.endsWith('.jsonl')
      ? text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line))
      : JSON.parse(text)
  if (!Array.isArray(raw)) throw new Error(`${path} must contain an array of rows`)
  return raw.map((row, index) => {
    const parsed = planeDumpRowSchema.safeParse(row)
    if (!parsed.success) throw new Error(`${path}: row ${index + 1} is not an object`)
    return parsed.data
  })
}

/** Read `<table>.json`, `.jsonl` or `.csv` files from a directory. The table name is the file name without its extension. */
export function readDumpDirectory(dir: string): PlaneDump {
  if (!existsSync(dir)) throw new Error(`Dump directory not found: ${dir}`)
  const dump: PlaneDump = {}
  for (const file of readdirSync(dir).sort()) {
    const match = /^(.+)\.(json|jsonl|csv)$/.exec(file)
    if (match) dump[match[1]] = parseRows(join(dir, file))
  }
  return dump
}
