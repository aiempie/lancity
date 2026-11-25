import { sanitizeCsvRow } from '@/server/export/csv-utils'
import type { ExportSchemaDefinition } from '@/server/export/base'
import { decodeXlsx, encodeXlsx } from '@/server/export/xlsx'

/**
 * Export and import formatters. Two families, both ported from Plane:
 * - schema formatters (`utils/exporters/formatters.py`): records plus a schema give a named file.
 * - porter formatters (`utils/porters/formatters.py`): `encode` and `decode` between records and file content.
 * Every cell goes through `sanitizeCsvRow` (CSV injection guard, PD-1723 and PD-1724).
 */

export type FormatOptions = { fields?: string[]; list_joiner?: string }
export type FormatResult = [filename: string, content: string | Uint8Array]
export type ExportRecord = Record<string, unknown>

const decoder = new TextDecoder()

/** Python `str.title()` for ASCII and Unicode words. */
const title = (value: string) => value.replace(/\p{L}+/gu, word => word[0].toUpperCase() + word.slice(1).toLowerCase())
/** PD-1995 and PD-2003 `_prettify_header`: `created_by_name` becomes `Created By Name`. */
export const prettifyHeader = (header: string) => title(header.replaceAll('_', ' '))
/** PD-1996 and PD-2004 `_normalize_header`: `Display Name` becomes `display_name`. */
export const normalizeHeader = (header: string) => header.trim().toLowerCase().replaceAll(' ', '_')

function formatCell(value: unknown, listJoiner: string): unknown {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(item => (typeof item === 'object' && item ? JSON.stringify(item) : String(item))).join(listJoiner)
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

/** Write CSV like Python `csv.writer` (CRLF line ends, minimal or full quoting). */
export function writeCsv(rows: readonly (readonly unknown[])[], options: { delimiter?: string; quoteAll?: boolean } = {}): string {
  const delimiter = options.delimiter ?? ','
  const quote = (value: unknown, single: boolean) => {
    const text = value === null || value === undefined ? '' : value === true ? 'True' : value === false ? 'False' : String(value)
    const needs = options.quoteAll || (single && text === '') || /["\r\n]/.test(text) || text.includes(delimiter)
    return needs ? `"${text.replaceAll('"', '""')}"` : text
  }
  return rows.map(row => row.map(value => quote(value, row.length === 1)).join(delimiter) + '\r\n').join('')
}

/** Parse CSV text (RFC 4180, optional BOM). Blank lines are skipped like `csv.DictReader`. */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let touched = false
  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    if (touched || row.length > 1 || row[0] !== '') rows.push(row)
    row = []
    touched = false
  }
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"' && field === '') {
      quoted = true
      touched = true
    } else if (ch === delimiter) {
      pushField()
      touched = true
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && input[i + 1] === '\n') i++
      pushRow()
    } else field += ch
  }
  if (field !== '' || row.length || touched) pushRow()
  return rows
}

// ---------------------------------------------------------------- schema formatters (utils/exporters)

/** PD-1737 `BaseFormatter._get_field_info`: field order and display labels of a schema. */
export function getFieldInfo(schema: Pick<ExportSchemaDefinition, 'fields'>) {
  const order = Object.keys(schema.fields)
  const labels = Object.fromEntries(order.map(name => [name, schema.fields[name].label || prettifyHeader(name)]))
  return { order, labels }
}

/** PD-1736 `BaseFormatter.format`. */
export interface SchemaFormatter {
  format(filename: string, records: ExportRecord[], schema: Pick<ExportSchemaDefinition, 'fields'>, options?: FormatOptions): Promise<FormatResult>
}

function selectFields(schema: Pick<ExportSchemaDefinition, 'fields'>, options?: FormatOptions) {
  const info = getFieldInfo(schema)
  const requested = options?.fields
  return { labels: info.labels, order: requested?.length ? info.order.filter(name => requested.includes(name)) : info.order }
}

/** PD-1738 to PD-1741 `CSVFormatter` (everything quoted, lists joined). */
export class CsvSchemaFormatter implements SchemaFormatter {
  /** PD-1738 */
  formatFieldValue(value: unknown, listJoiner = ', '): string {
    const cell = formatCell(value, listJoiner)
    return typeof cell === 'string' ? cell : String(cell)
  }
  /** PD-1739 */
  generateTableRow(record: ExportRecord, order: string[], options?: FormatOptions): string[] {
    return order.map(name => this.formatFieldValue(record[name] ?? '', options?.list_joiner ?? ', '))
  }
  /** PD-1740 */
  createCsvFile(data: string[][]): string {
    return writeCsv(data.map(sanitizeCsvRow), { quoteAll: true })
  }
  /** PD-1741 */
  async format(filename: string, records: ExportRecord[], schema: Pick<ExportSchemaDefinition, 'fields'>, options?: FormatOptions): Promise<FormatResult> {
    if (!records.length) return [`${filename}.csv`, '']
    const { labels, order } = selectFields(schema, options)
    const rows = [order.map(name => labels[name]), ...records.map(record => this.generateTableRow(record, order, options))]
    return [`${filename}.csv`, this.createCsvFile(rows)]
  }
}

/** PD-1742 and PD-1743 `JSONFormatter`: types are kept, lists stay arrays. */
export class JsonSchemaFormatter implements SchemaFormatter {
  /** PD-1742 */
  generateJsonRow(record: ExportRecord, labels: Record<string, string>, order: string[]): ExportRecord {
    return Object.fromEntries(order.filter(name => name in record).map(name => [labels[name], record[name]]))
  }
  /** PD-1743 */
  async format(filename: string, records: ExportRecord[], schema: Pick<ExportSchemaDefinition, 'fields'>, options?: FormatOptions): Promise<FormatResult> {
    if (!records.length) return [`${filename}.json`, '[]']
    const { labels, order } = selectFields(schema, options)
    return [`${filename}.json`, JSON.stringify(records.map(record => this.generateJsonRow(record, labels, order)))]
  }
}

/** PD-1744 to PD-1747 `XLSXFormatter`. */
export class XlsxSchemaFormatter implements SchemaFormatter {
  /** PD-1744 */
  formatFieldValue(value: unknown, listJoiner = ', '): string {
    const cell = formatCell(value, listJoiner)
    return typeof cell === 'string' ? cell : String(cell)
  }
  /** PD-1745 */
  generateTableRow(record: ExportRecord, order: string[], options?: FormatOptions): string[] {
    return order.map(name => this.formatFieldValue(record[name] ?? '', options?.list_joiner ?? ', '))
  }
  /** PD-1746 */
  createXlsxFile(data: string[][]): Promise<Uint8Array> {
    return encodeXlsx(data.map(sanitizeCsvRow))
  }
  /** PD-1747 */
  async format(filename: string, records: ExportRecord[], schema: Pick<ExportSchemaDefinition, 'fields'>, options?: FormatOptions): Promise<FormatResult> {
    if (!records.length) return [`${filename}.xlsx`, await this.createXlsxFile([])]
    const { labels, order } = selectFields(schema, options)
    const rows = [order.map(name => labels[name]), ...records.map(record => this.generateTableRow(record, order, options))]
    return [`${filename}.xlsx`, await this.createXlsxFile(rows)]
  }
}

// ---------------------------------------------------------------- porter formatters (utils/porters)

/** PD-1987 to PD-1989 `BaseFormatter`. */
export interface PorterFormatter {
  encode(data: ExportRecord[]): Promise<string | Uint8Array>
  decode(content: string | Uint8Array): Promise<ExportRecord[]>
  readonly extension: string
}

/** Parse a string that holds a JSON list or object back into the value (CSV and XLSX cells). */
function parseNested(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' ? parsed : value
  } catch {
    return value
  }
}

const fieldNames = (data: ExportRecord[]) => [...new Set(data.flatMap(row => Object.keys(row)))]
const isPlainObject = (value: unknown): value is ExportRecord => value !== null && typeof value === 'object' && !Array.isArray(value)

/** PD-1990 to PD-1993 `JSONFormatter`. */
export class JsonFormatter implements PorterFormatter {
  constructor(readonly indent = 2) {}
  /** PD-1991 */
  async encode(data: ExportRecord[]): Promise<string> {
    return JSON.stringify(data, null, this.indent)
  }
  /** PD-1992 */
  async decode(content: string | Uint8Array): Promise<ExportRecord[]> {
    const parsed: unknown = JSON.parse(typeof content === 'string' ? content : decoder.decode(content))
    if (!Array.isArray(parsed)) throw new Error('JSON content must be a list of records')
    return parsed as ExportRecord[]
  }
  /** PD-1993 */
  get extension() {
    return 'json'
  }
}

/** PD-1994 to PD-2001 `CSVFormatter`. */
export class CsvFormatter implements PorterFormatter {
  constructor(
    readonly flatten = true,
    readonly delimiter = ',',
    readonly prettifyHeaders = true
  ) {}
  /** PD-1997 `_flatten`: nested objects become `a__b` keys, lists become JSON text. */
  flattenRow(row: ExportRecord, parent = ''): ExportRecord {
    const items: ExportRecord = {}
    for (const [key, value] of Object.entries(row)) {
      const name = parent ? `${parent}__${key}` : key
      if (isPlainObject(value)) Object.assign(items, this.flattenRow(value, name))
      else items[name] = Array.isArray(value) ? JSON.stringify(value) : value
    }
    return items
  }
  /** PD-1998 `_unflatten`. */
  unflattenRow(row: ExportRecord): ExportRecord {
    const result: ExportRecord = {}
    for (const [key, raw] of Object.entries(row)) {
      const parts = key.split('__')
      let current = result
      for (const part of parts.slice(0, -1)) {
        if (!isPlainObject(current[part])) current[part] = {}
        current = current[part] as ExportRecord
      }
      current[parts[parts.length - 1]] = parseNested(raw)
    }
    return result
  }
  /** PD-1999 */
  async encode(data: ExportRecord[]): Promise<string> {
    if (!data.length) return ''
    const rows = this.flatten ? data.map(row => this.flattenRow(row)) : data
    const names = fieldNames(rows)
    const header = this.prettifyHeaders ? names.map(prettifyHeader) : names
    return writeCsv([sanitizeCsvRow(header), ...rows.map(row => sanitizeCsvRow(names.map(name => row[name] ?? '')))], {
      delimiter: this.delimiter
    })
  }
  /** PD-2000 */
  async decode(content: string | Uint8Array, normalizeHeaders = true): Promise<ExportRecord[]> {
    const [header, ...body] = parseCsv(typeof content === 'string' ? content : decoder.decode(content), this.delimiter)
    if (!header) return []
    const names = normalizeHeaders ? header.map(normalizeHeader) : header
    return body.map(cells => {
      const row: ExportRecord = {}
      names.forEach((name, i) => (row[name] = cells[i] ?? null))
      return this.flatten ? this.unflattenRow(row) : row
    })
  }
  /** PD-2001 */
  get extension() {
    return 'csv'
  }
}

/** PD-2002 to PD-2008 `XLSXFormatter`. */
export class XlsxFormatter implements PorterFormatter {
  constructor(
    readonly prettifyHeaders = true,
    readonly listJoiner = ', '
  ) {}
  /** PD-2005 `_format_value` */
  formatValue(value: unknown): unknown {
    if (value === null || value === undefined) return ''
    if (Array.isArray(value)) return value.map(item => (typeof item === 'object' && item ? JSON.stringify(item) : String(item))).join(this.listJoiner)
    if (typeof value === 'object') return JSON.stringify(value)
    return value
  }
  /** PD-2006 */
  async encode(data: ExportRecord[]): Promise<Uint8Array> {
    if (!data.length) return encodeXlsx([])
    const names = fieldNames(data)
    const header = this.prettifyHeaders ? names.map(prettifyHeader) : names
    return encodeXlsx([sanitizeCsvRow(header), ...data.map(row => sanitizeCsvRow(names.map(name => this.formatValue(row[name] ?? ''))))])
  }
  /** PD-2007 */
  async decode(content: string | Uint8Array, normalizeHeaders = true): Promise<ExportRecord[]> {
    if (typeof content === 'string') throw new Error('XLSX content must be binary')
    const [first, ...rows] = await decodeXlsx(content)
    if (!first) return []
    const headers = first.map(cell => (cell ? (normalizeHeaders ? normalizeHeader(String(cell)) : String(cell)) : ''))
    return rows
      .filter(cells => cells.some(cell => cell !== null && cell !== ''))
      .map(cells => {
        const row: ExportRecord = {}
        cells.forEach((cell, i) => {
          if (i < headers.length && headers[i]) row[headers[i]] = parseNested(cell)
        })
        return row
      })
  }
  /** PD-2008 */
  get extension() {
    return 'xlsx'
  }
}

