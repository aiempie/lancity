/**
 * Export field and schema primitives, ported from `plane/utils/exporters/schemas/base.py`. A schema is a plain
 * object of declared fields plus optional `prepare` functions, instead of a Python class with a metaclass.
 */

export type ExportContext = Record<string, unknown>
export type FieldKind = 'string' | 'date' | 'datetime' | 'number' | 'boolean' | 'list' | 'json'

export type ExportField = {
  kind: FieldKind
  /** Dotted path into the object, for example `project.identifier`. */
  source?: string
  default?: unknown
  /** Display name used as the export header. */
  label?: string
}

type FieldOptions = Omit<ExportField, 'kind' | 'default'> & { default?: unknown }

/** PD-1751 `StringField`. */
export const stringField = (options: FieldOptions = {}): ExportField => ({ kind: 'string', default: '', ...options })
/** PD-1752 `DateField`. */
export const dateField = (options: FieldOptions = {}): ExportField => ({ kind: 'date', default: '', ...options })
/** PD-1753 `DateTimeField`. */
export const dateTimeField = (options: FieldOptions = {}): ExportField => ({ kind: 'datetime', default: '', ...options })
/** PD-1754 `NumberField`. */
export const numberField = (options: FieldOptions = {}): ExportField => ({ kind: 'number', default: '', ...options })
/** PD-1755 `BooleanField`. */
export const booleanField = (options: FieldOptions = {}): ExportField => ({ kind: 'boolean', default: false, ...options })
/** PD-1756 `ListField`. */
export const listField = (options: FieldOptions = {}): ExportField => ({ kind: 'list', default: [], ...options })
/** PD-1757 `JSONField`. */
export const jsonField = (options: FieldOptions = {}): ExportField => ({ kind: 'json', default: {}, ...options })

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (value: number) => String(value).padStart(2, '0')

/** Accept a Date, a `YYYY-MM-DD` string, an ISO timestamp or epoch milliseconds. */
export function toDate(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw
  if (typeof raw === 'number') return Number.isFinite(raw) ? new Date(raw) : null
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(raw)) return null
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Python `strftime("%a, %d %b %Y")` in UTC (PD-1752, PD-1766). */
export function formatDate(raw: unknown): string {
  const date = toDate(raw)
  return date ? `${WEEKDAYS[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}` : ''
}

/** Python `strftime("%a, %d %b %Y %I:%M:%S %Z%z")` in UTC (PD-1753). */
export function formatDateTime(raw: unknown): string {
  const date = toDate(raw)
  if (!date) return ''
  const hour = date.getUTCHours() % 12 || 12
  return `${formatDate(date)} ${pad(hour)}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC+0000`
}

/** PD-1750 `_resolve_dotted_path`: walk object keys, null once a part is missing. */
export function resolveDottedPath(obj: unknown, path: string): unknown {
  let current: unknown = obj
  for (const part of path.split('.')) {
    if (current === null || current === undefined) return null
    if (typeof current === 'object' && part in (current as object)) current = (current as Record<string, unknown>)[part]
    else return null
  }
  return current
}

/** PD-1749 `_format_value` and the type specific overrides of PD-1751 to PD-1757. */
export function formatFieldValue(field: ExportField, raw: unknown): unknown {
  const fallback = field.default
  if (raw === null || raw === undefined) return field.kind === 'list' || field.kind === 'json' ? structuredCloneOf(fallback) : fallback
  switch (field.kind) {
    case 'string':
      return String(raw)
    case 'date': {
      const text = formatDate(raw)
      return text || String(raw)
    }
    case 'datetime': {
      const text = formatDateTime(raw)
      return text || String(raw)
    }
    case 'boolean':
      return Boolean(raw)
    case 'list':
      return Array.isArray(raw) ? [...raw] : [raw]
    default:
      return raw
  }
}

function structuredCloneOf<T>(value: T): T {
  return value !== null && typeof value === 'object' ? (JSON.parse(JSON.stringify(value)) as T) : value
}

/** PD-1748 `ExportField.get_value`: the source defaults to the field's own name. */
export function getFieldValue(field: ExportField, obj: unknown, name?: string): unknown {
  const source = field.source || name
  return formatFieldValue(field, source ? resolveDottedPath(obj, source) : obj)
}

export type ExportSchemaDefinition<T = unknown, D = unknown> = {
  fields: Record<string, ExportField>
  /** `prepare_<field>` methods. They win over the declared source. */
  prepare?: Record<string, (obj: T, context: ExportContext) => unknown>
  /** PD-1761 `get_context_data`: pre-fetch related data for the rows to serialize. */
  getContext?: (rows: T[], deps?: D) => ExportContext | Promise<ExportContext>
}

/** PD-1758 `ExportSchemaMeta.__new__`: fields and preparers of the bases first, then the declared ones. */
export function defineExportSchema<T, D = unknown>(
  definition: ExportSchemaDefinition<T, D>,
  ...bases: ExportSchemaDefinition<T, D>[]
): ExportSchemaDefinition<T, D> {
  return {
    fields: Object.assign({}, ...bases.map(base => base.fields), definition.fields),
    prepare: Object.assign({}, ...bases.map(base => base.prepare), definition.prepare),
    getContext: definition.getContext ?? [...bases].reverse().find(base => base.getContext)?.getContext
  }
}

/** PD-1759 `ExportSchema.__init__` and PD-1760 `serialize`. */
export class ExportSchema<T = unknown> {
  constructor(
    readonly definition: ExportSchemaDefinition<T, never>,
    readonly context: ExportContext = {}
  ) {}

  serialize(obj: T, fields?: string[]): Record<string, unknown> {
    const output: Record<string, unknown> = {}
    for (const name of fields?.length ? fields : Object.keys(this.definition.fields)) {
      const field = this.definition.fields[name]
      if (!field) continue
      const prepare = this.definition.prepare?.[name]
      output[name] = prepare ? prepare(obj, this.context) : getFieldValue(field, obj, name)
    }
    return output
  }
}

/** PD-1762 `ExportSchema.serialize_queryset`. */
export async function serializeRows<T, D = unknown>(
  definition: ExportSchemaDefinition<T, D>,
  rows: T[],
  fields?: string[],
  deps?: D
): Promise<Record<string, unknown>[]> {
  const context = (await definition.getContext?.(rows, deps)) ?? {}
  const schema = new ExportSchema<T>(definition as ExportSchemaDefinition<T, never>, context)
  return rows.map(row => schema.serialize(row, fields))
}
