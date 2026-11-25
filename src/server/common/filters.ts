import { and, between, eq, gte, isNotNull, isNull, lt, not, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { issueAssignees, issueLabels, issueMentions, issueSubscribers, issues, states } from '@/db/schema/issue'
import { cycleIssues, moduleIssues } from '@/db/schema/planning'
import { ServiceError } from '@/server/common/errors'
import { containsFolded } from '@/server/common/unicode'
import { logException } from '@/server/common/exception-logger'
import { orderByNullsLast } from '@/server/common/pagination'
import { projectDayStart } from '@/server/common/timezone-converter'
import { isEntityId, isUuidLike } from '@/server/common/uuid'
import type { LancityDb } from '@/types/database/schema'

/** 400 error whose code is the upper-cased Plane filter error code (`invalid_json` -> `INVALID_JSON`). */
function filterError(code: string, message: string, details?: unknown): ServiceError {
  return new ServiceError(400, code.toUpperCase(), message, details)
}

// =====================================================================================
// Legacy filters -> rich filters (Plane `utils/filters/converters.py`)
// =====================================================================================

/** Raised by `LegacyToRichFiltersConverter.convert` in strict mode (Python `ValueError`). */
export class FilterConversionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FilterConversionError'
  }
}

export type ConverterConfig = {
  fieldMappings?: Record<string, string>
  uuidFields?: Iterable<string>
  validChoices?: Record<string, string[]>
  dateFields?: Iterable<string>
  /** Merge with the defaults (true) or replace them (false). */
  extendDefaults?: boolean
}

function isFlexibleDate(value: unknown): boolean {
  if (value instanceof Date) return true
  if (typeof value !== 'string' || !value.trim()) return false
  return !Number.isNaN(Date.parse(value))
}

/** Convert saved view filters (`{state: [...], priority: [...]}`) to the rich filter format used by `ComplexFilterBackend`. */
export class LegacyToRichFiltersConverter {
  static readonly DEFAULT_FIELD_MAPPINGS: Readonly<Record<string, string>> = {
    state: 'state_id',
    labels: 'label_id',
    cycle: 'cycle_id',
    module: 'module_id',
    assignees: 'assignee_id',
    mentions: 'mention_id',
    created_by: 'created_by_id',
    state_group: 'state_group',
    priority: 'priority',
    project: 'project_id',
    start_date: 'start_date',
    target_date: 'target_date'
  }
  /** Fields holding an entity id. Legacy UUID text from imported data is accepted too. */
  static readonly DEFAULT_UUID_FIELDS: readonly string[] = [
    'state_id',
    'label_id',
    'cycle_id',
    'module_id',
    'assignee_id',
    'mention_id',
    'created_by_id',
    'project_id'
  ]
  static readonly DEFAULT_VALID_CHOICES: Readonly<Record<string, string[]>> = {
    state_group: ['backlog', 'unstarted', 'started', 'completed', 'cancelled'],
    priority: ['urgent', 'high', 'medium', 'low', 'none']
  }
  static readonly DEFAULT_DATE_FIELDS: readonly string[] = ['start_date', 'target_date']
  /** Relative dates such as `2_weeks` or `3_months`. */
  static readonly DATE_PATTERN = /^(\d+)_(weeks|months)$/

  FIELD_MAPPINGS: Record<string, string>
  UUID_FIELDS: Set<string>
  VALID_CHOICES: Record<string, string[]>
  DATE_FIELDS: Set<string>

  constructor(config: ConverterConfig = {}) {
    const extend = config.extendDefaults ?? true
    const C = LegacyToRichFiltersConverter
    this.FIELD_MAPPINGS = { ...(extend ? C.DEFAULT_FIELD_MAPPINGS : {}), ...config.fieldMappings }
    this.UUID_FIELDS = new Set([...(extend ? C.DEFAULT_UUID_FIELDS : []), ...(config.uuidFields ?? [])])
    this.VALID_CHOICES = { ...(extend ? C.DEFAULT_VALID_CHOICES : {}), ...config.validChoices }
    this.DATE_FIELDS = new Set([...(extend ? C.DEFAULT_DATE_FIELDS : []), ...(config.dateFields ?? [])])
  }

  addFieldMapping(legacyKey: string, richFieldName: string): void {
    this.FIELD_MAPPINGS[legacyKey] = richFieldName
  }

  addUuidField(fieldName: string): void {
    this.UUID_FIELDS.add(fieldName)
  }

  addChoiceField(fieldName: string, choices: string[]): void {
    this.VALID_CHOICES[fieldName] = choices
  }

  addDateField(fieldName: string): void {
    this.DATE_FIELDS.add(fieldName)
  }

  updateMappings(config: Omit<ConverterConfig, 'extendDefaults'> = {}): void {
    Object.assign(this.FIELD_MAPPINGS, config.fieldMappings)
    for (const field of config.uuidFields ?? []) this.UUID_FIELDS.add(field)
    Object.assign(this.VALID_CHOICES, config.validChoices)
    for (const field of config.dateFields ?? []) this.DATE_FIELDS.add(field)
  }

  private validateUuid(value: unknown): boolean {
    return isEntityId(value) || isUuidLike(value)
  }

  private validateChoice(fieldName: string, value: unknown): boolean {
    if (!(fieldName in this.VALID_CHOICES)) return true
    return this.VALID_CHOICES[fieldName].includes(value as string)
  }

  private validateDate(value: unknown): boolean {
    return isFlexibleDate(value)
  }

  private validateValue(richFieldName: string, value: unknown): boolean {
    if (this.UUID_FIELDS.has(richFieldName)) return this.validateUuid(value)
    if (richFieldName in this.VALID_CHOICES) return this.validateChoice(richFieldName, value)
    if (this.DATE_FIELDS.has(richFieldName)) return this.validateDate(value)
    return true
  }

  private filterValidValues(richFieldName: string, values: unknown[]): unknown[] {
    return values.filter(value => this.validateValue(richFieldName, value))
  }

  private addValidationError(strict: boolean, errors: string[], message: string): void {
    if (strict) errors.push(message)
  }

  private addRichFilter(richFilters: Record<string, unknown>, fieldName: string, operator: string, value: unknown): void {
    // Lists become comma separated strings for `in` and `range`.
    const flat = (operator === 'in' || operator === 'range') && Array.isArray(value) ? value.map(String).join(',') : value
    richFilters[`${fieldName}__${operator}`] = flat
  }

  private handleValueError(error: Error, strict: boolean, errors: string[]): void {
    if (strict) errors.push(error.message)
  }

  private processDateField(
    richFieldName: string,
    values: unknown[],
    strict: boolean,
    errors: string[],
    richFilters: Record<string, unknown>
  ): boolean {
    if (!this.DATE_FIELDS.has(richFieldName)) return false
    try {
      Object.assign(richFilters, this.convertDateValue(richFieldName, values.map(String), strict))
    } catch (error) {
      if (!(error instanceof FilterConversionError)) throw error
      this.handleValueError(error, strict, errors)
    }
    return true
  }

  /**
   * Basic date conversion: a single date becomes `__exact`, one `;after` plus one `;before` becomes `__range`.
   * Relative dates, more than two values and other combinations are skipped.
   */
  convertDateValue(fieldName: string, values: string[], strict = false): Record<string, unknown> {
    for (const value of values) {
      if (value.includes(';') && LegacyToRichFiltersConverter.DATE_PATTERN.test(value.split(';')[0])) return {}
    }
    if (values.length > 2) return {}
    const exact: string[] = []
    const after: string[] = []
    const before: string[] = []
    for (const value of values) {
      if (!value.includes(';')) {
        if (!this.validateDate(value)) {
          if (strict) throw new FilterConversionError(`Invalid date format: ${value}`)
          continue
        }
        exact.push(value)
        continue
      }
      const [datePart, direction] = value.split(';')
      if (direction === undefined) {
        if (strict) throw new FilterConversionError(`Invalid date format: ${value}`)
        continue
      }
      if (!this.validateDate(datePart)) {
        if (strict) throw new FilterConversionError(`Invalid date format: ${datePart}`)
        continue
      }
      if (direction === 'after') after.push(datePart)
      else if (direction === 'before') before.push(datePart)
    }
    const result: Record<string, unknown> = {}
    if (after.length === 1 && before.length === 1 && exact.length === 0) {
      this.addRichFilter(result, fieldName, 'range', [after[0] < before[0] ? after[0] : before[0], after[0] < before[0] ? before[0] : after[0]])
    } else if (exact.length === 1 && after.length === 0 && before.length === 0) {
      this.addRichFilter(result, fieldName, 'exact', exact[0])
    }
    return result
  }

  /**
   * Convert legacy filters to the rich format. Unknown keys and invalid values are skipped, or collected
   * into one `FilterConversionError` when `strict` is true.
   */
  convert(legacyFilters: Record<string, unknown>, strict = false): Record<string, unknown> {
    const richFilters: Record<string, unknown> = {}
    const errors: string[] = []
    for (const [legacyKey, value] of Object.entries(legacyFilters)) {
      if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) continue
      if (!(legacyKey in this.FIELD_MAPPINGS)) {
        this.addValidationError(strict, errors, `Unsupported filter key: ${legacyKey}`)
        continue
      }
      const richFieldName = this.FIELD_MAPPINGS[legacyKey]
      if (Array.isArray(value)) {
        if (this.processDateField(richFieldName, value, strict, errors, richFilters)) continue
        const valid = this.filterValidValues(richFieldName, value)
        if (!valid.length) {
          this.addValidationError(strict, errors, `No valid values found for ${legacyKey}: ${JSON.stringify(value)}`)
          continue
        }
        if (strict && valid.length !== value.length) {
          const invalid = value.filter(item => !valid.includes(item))
          this.addValidationError(strict, errors, `Invalid values for ${legacyKey}: ${JSON.stringify(invalid)}`)
        }
        this.addRichFilter(richFilters, richFieldName, 'in', valid)
      } else {
        if (this.processDateField(richFieldName, [value], strict, errors, richFilters)) continue
        if (this.validateValue(richFieldName, value)) this.addRichFilter(richFilters, richFieldName, 'exact', value)
        else this.addValidationError(strict, errors, `Invalid value for ${legacyKey}: ${String(value)}`)
      }
    }
    if (strict && errors.length) throw new FilterConversionError(`Filter validation errors: ${errors.join('; ')}`)
    return this.formatAsRichFilter(richFilters)
  }

  /** One condition stays a leaf, several are wrapped in `and`. */
  formatAsRichFilter(flat: Record<string, unknown>): Record<string, unknown> {
    const entries = Object.entries(flat)
    if (!entries.length) return {}
    if (entries.length === 1) return { [entries[0][0]]: entries[0][1] }
    return { and: entries.map(([key, value]) => ({ [key]: value })) }
  }
}

// =====================================================================================
// FilterSet (Plane `utils/filters/filterset.py`)
// =====================================================================================

/** A single filter value problem (Django form validation error). */
export class FilterValueError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FilterValueError'
  }
}

export type FilterContext = {
  /** IANA zone used for calendar-date filters (Plane evaluates `__date` in the user's timezone). Default UTC. */
  timezone?: string
}

/** Query parameters as lists, like Django's `QueryDict.getlist`. */
export type FilterData = Record<string, string[]>

export type FilterDefinition = {
  name: string
  /** `exact` filters also get a `<name>__exact` alias. */
  lookup: string
  /** Custom method filters ignore an empty value instead of matching NULL. */
  method?: boolean
  exclude?: boolean
  parse: (values: string[]) => unknown
  build: (value: unknown, context: FilterContext) => SQL | undefined
}

/** D1 allows 100 bound parameters per statement, so list filters are capped well below that. */
export const MAX_FILTER_LIST_ITEMS = 80

const lastValue = (values: string[]): string => (values.length ? values[values.length - 1].trim() : '')

function listValues(values: string[]): string[] {
  const items = values.flatMap(value => value.split(',')).map(item => item.trim()).filter(Boolean)
  if (items.length > MAX_FILTER_LIST_ITEMS) throw new FilterValueError(`Too many values (max ${MAX_FILTER_LIST_ITEMS}).`)
  return items
}

const parseId = (values: string[]): number | null => {
  const value = lastValue(values)
  if (!value) return null
  if (!isEntityId(value)) throw new FilterValueError('Enter a valid ID.')
  return Number(value)
}

const parseIdList = (values: string[]): number[] =>
  listValues(values).map(item => {
    if (!isEntityId(item)) throw new FilterValueError('Enter a valid ID.')
    return Number(item)
  })

const parseText = (values: string[]): string | null => lastValue(values) || null
const parseTextList = (values: string[]): string[] => listValues(values)

function parseChoice(choices: readonly string[]) {
  return (values: string[]): string | null => {
    const value = lastValue(values)
    if (!value) return null
    if (!choices.includes(value)) throw new FilterValueError('Select a valid choice.')
    return value
  }
}

function parseChoiceList(choices: readonly string[]) {
  return (values: string[]): string[] => {
    const items = listValues(values)
    if (items.some(item => !choices.includes(item))) throw new FilterValueError('Select a valid choice.')
    return items
  }
}

const parseBoolean = (values: string[]): boolean | null => {
  const value = lastValue(values).toLowerCase()
  if (!value) return null
  if (['true', '1'].includes(value)) return true
  if (['false', '0'].includes(value)) return false
  throw new FilterValueError('Select a valid choice.')
}

function validDay(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3])
}

const parseDate = (values: string[]): string | null => {
  const value = lastValue(values)
  if (!value) return null
  if (!validDay(value)) throw new FilterValueError('Enter a valid date.')
  return value
}

/** `YYYY-MM-DD,YYYY-MM-DD`: both bounds inclusive whole days. */
const parseDateRange = (values: string[]): [string, string] | null => {
  const items = listValues(values)
  if (!items.length) return null
  if (items.length !== 2) throw new FilterValueError('Invalid range: expected two comma-separated dates.')
  if (!items.every(validDay)) throw new FilterValueError('Enter a valid date.')
  return [items[0], items[1]]
}

const NEVER = sql`0`

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10)
}

type RelationTable = SQLiteTable & { deletedAt: AnySQLiteColumn }

/** `issues.id in (select issue_id from <relation> where <value> ... and deleted_at is null)`: ignores removed relations. */
function relationCondition(table: RelationTable, issueId: AnySQLiteColumn, condition: SQL | undefined): SQL | undefined {
  return sql`${issues.id} in (select ${issueId} from ${table} where ${and(condition, isNull(table.deletedAt))})`
}

function relationFilters(name: string, table: RelationTable, issueId: AnySQLiteColumn, value: AnySQLiteColumn): FilterDefinition[] {
  return [
    {
      name,
      lookup: 'exact',
      method: true,
      parse: parseId,
      build: id => (id === null ? undefined : relationCondition(table, issueId, eq(value, id as number)))
    },
    {
      name: `${name}__in`,
      lookup: 'in',
      method: true,
      parse: parseIdList,
      build: ids => ((ids as number[]).length ? relationCondition(table, issueId, sql`${value} in (select value from json_each(${JSON.stringify(ids)}))`) : undefined)
    }
  ]
}

function columnFilters(name: string, column: AnySQLiteColumn, kind: 'id' | 'choice', choices: readonly string[] = []): FilterDefinition[] {
  return [
    {
      name,
      lookup: 'exact',
      parse: kind === 'id' ? parseId : parseChoice(choices),
      build: value => (value === null ? isNull(column) : eq(column, value as string | number))
    },
    {
      name: `${name}__in`,
      lookup: 'in',
      parse: kind === 'id' ? parseIdList : parseChoiceList(choices),
      build: values => ((values as unknown[]).length ? sql`${column} in (select value from json_each(${JSON.stringify(values)}))` : NEVER)
    }
  ]
}

function dateColumnFilters(name: string, column: AnySQLiteColumn): FilterDefinition[] {
  return [
    {
      name,
      lookup: 'exact',
      parse: parseDate,
      build: value => (value === null ? isNull(column) : eq(column, value as string))
    },
    {
      name: `${name}__range`,
      lookup: 'range',
      parse: parseDateRange,
      build: value => (value === null ? undefined : between(column, (value as string[])[0], (value as string[])[1]))
    }
  ]
}

/** Timestamp columns filtered by calendar date in the context timezone (inclusive whole days). */
function timestampDateFilters(name: string, column: AnySQLiteColumn): FilterDefinition[] {
  const day = (value: unknown, context: FilterContext) =>
    and(
      gte(column, projectDayStart(value as string, context.timezone ?? 'UTC')),
      lt(column, projectDayStart(addDays(value as string, 1), context.timezone ?? 'UTC'))
    )
  return [
    { name, lookup: 'date', parse: parseDate, build: (value, context) => (value === null ? undefined : day(value, context)) },
    { name: `${name}__exact`, lookup: 'date', parse: parseDate, build: (value, context) => (value === null ? undefined : day(value, context)) },
    {
      name: `${name}__range`,
      lookup: 'date__range',
      parse: parseDateRange,
      build: (value, context) => {
        if (value === null) return undefined
        const [from, to] = value as string[]
        const zone = context.timezone ?? 'UTC'
        return and(gte(column, projectDayStart(from, zone)), lt(column, projectDayStart(addDays(to, 1), zone)))
      }
    }
  ]
}

/**
 * Plane `BaseFilterSet`: a named set of filters that turns request parameters into one SQL condition.
 * Every `exact` filter also answers to `<name>__exact`. Relation filters use subqueries, so no DISTINCT is needed.
 */
export class BaseFilterSet {
  readonly filters: Map<string, FilterDefinition>

  constructor(definitions: FilterDefinition[]) {
    this.filters = new Map(definitions.map(definition => [definition.name, definition]))
    // Plane `get_filters`: add `<name>__exact` for every filter with an exact lookup.
    for (const definition of definitions) {
      const alias = `${definition.name}__exact`
      if (definition.lookup === 'exact' && !this.filters.has(alias)) this.filters.set(alias, { ...definition, name: alias })
    }
  }

  /** Names a client may filter on (Plane `base_filters.keys()`). */
  get baseFilters(): ReadonlySet<string> {
    return new Set(this.filters.keys())
  }

  /** Parse the provided parameters. Returns the parsed values and a map of field to error message. */
  parse(data: FilterData): { values: Map<string, unknown>; errors: Record<string, string> } {
    const values = new Map<string, unknown>()
    const errors: Record<string, string> = {}
    for (const [name, definition] of this.filters) {
      if (!Object.hasOwn(data, name)) continue
      try {
        values.set(name, definition.parse(data[name]))
      } catch (error) {
        if (!(error instanceof FilterValueError)) throw error
        errors[name] = error.message
      }
    }
    return { values, errors }
  }

  /**
   * Plane `build_combined_q`: AND of the conditions of every provided filter. Returns undefined when
   * there is nothing to restrict. Invalid values throw a 400 `INVALID_FILTERSET`.
   */
  buildCombinedQ(data: FilterData, context: FilterContext = {}): SQL | undefined {
    const { values, errors } = this.parse(data)
    if (Object.keys(errors).length) throw filterError('invalid_filterset', 'Invalid filter parameters', errors)
    const pieces: (SQL | undefined)[] = []
    for (const [name, value] of values) {
      const definition = this.filters.get(name)!
      let piece: SQL | undefined
      if (definition.method && (value === null || (Array.isArray(value) && value.length === 0))) piece = undefined
      else piece = definition.build(value, context)
      pieces.push(piece && definition.exclude ? not(piece) : piece)
    }
    return and(...pieces)
  }

  /** Plane `filter_queryset`: same condition, for use in a `where` clause. */
  filterQueryset(data: FilterData, context: FilterContext = {}): SQL | undefined {
    return this.buildCombinedQ(data, context)
  }
}

/** Plane `IssueFilterSet`, expressed against the Lancity issue tables. */
export function createIssueFilterSet(): BaseFilterSet {
  const priorities = ['urgent', 'high', 'medium', 'low', 'none']
  return new BaseFilterSet([
    ...relationFilters('assignee_id', issueAssignees, issueAssignees.issueId, issueAssignees.assigneeId),
    ...relationFilters('cycle_id', cycleIssues, cycleIssues.issueId, cycleIssues.cycleId),
    ...relationFilters('module_id', moduleIssues, moduleIssues.issueId, moduleIssues.moduleId),
    ...relationFilters('mention_id', issueMentions, issueMentions.issueId, issueMentions.mentionId),
    ...relationFilters('label_id', issueLabels, issueLabels.issueId, issueLabels.labelId),
    ...relationFilters('subscriber_id', issueSubscribers, issueSubscribers.issueId, issueSubscribers.subscriberId),
    ...columnFilters('created_by_id', issues.createdById, 'id'),
    ...columnFilters('state_id', issues.stateId, 'id'),
    ...columnFilters('project_id', issues.projectId, 'id'),
    {
      name: 'is_archived',
      lookup: 'exact',
      method: true,
      parse: parseBoolean,
      build: value => (value === null ? undefined : value ? isNotNull(issues.archivedAt) : isNull(issues.archivedAt))
    },
    {
      name: 'state_group',
      lookup: 'exact',
      parse: parseText,
      build: value =>
        value === null
          ? isNull(issues.stateId)
          : sql`${issues.stateId} in (select ${states.id} from ${states} where ${states.group} = ${value})`
    },
    {
      name: 'state_group__in',
      lookup: 'in',
      parse: parseTextList,
      build: values =>
        (values as string[]).length
          ? sql`${issues.stateId} in (select ${states.id} from ${states} where ${states.group} in (select value from json_each(${JSON.stringify(values)})))`
          : NEVER
    },
    ...timestampDateFilters('created_at', issues.createdAt),
    ...timestampDateFilters('updated_at', issues.updatedAt),
    ...dateColumnFilters('start_date', issues.startDate),
    ...dateColumnFilters('target_date', issues.targetDate),
    {
      name: 'is_draft',
      lookup: 'exact',
      parse: parseBoolean,
      build: value => (value === null ? undefined : eq(issues.isDraft, value as boolean))
    },
    ...columnFilters('priority', issues.priority, 'choice', priorities)
  ])
}

export const issueFilterSet = createIssueFilterSet()

/** Group a URL query string into `FilterData` (repeated keys become lists). */
export function queryToFilterData(query: URLSearchParams): FilterData {
  const data: FilterData = {}
  for (const [key, value] of query) (data[key] ??= []).push(value)
  return data
}

// =====================================================================================
// ComplexFilterBackend (Plane `utils/filters/filter_backend.py`)
// =====================================================================================

export type ComplexFilterOptions = {
  /** Maximum nesting depth. Default 5. */
  maxDepth?: number
  filterParam?: string
}

const LOGICAL_OPERATORS = ['or', 'and', 'not']
const isLogicalKey = (key: string): boolean => LOGICAL_OPERATORS.includes(key.toLowerCase())
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Plane `ComplexFilterBackend`: JSON filters such as `{"and":[{"priority__in":"high,urgent"},{"not":{"state_id":3}}]}`
 * validated against a `BaseFilterSet` and compiled to one SQL condition.
 * Subclass and override `transformFieldNameForValidation` or `preprocessLeafConditions` for custom field names.
 * Logical operator keys are matched case-insensitively both when validating and when evaluating.
 */
export class ComplexFilterBackend {
  readonly filterParam: string
  readonly defaultMaxDepth = 5

  constructor(
    protected readonly filterSet: BaseFilterSet,
    protected readonly options: ComplexFilterOptions = {}
  ) {
    this.filterParam = options.filterParam ?? 'filters'
  }

  /**
   * Plane `filter_queryset`: read filters from `filterData` (object or JSON text) or from the `filters`
   * query parameter and return the SQL condition, or undefined when there is no filter.
   */
  filterQueryset(query: URLSearchParams | null | undefined, context: FilterContext = {}, filterData?: unknown): SQL | undefined {
    try {
      if (filterData !== undefined) return this.applyJsonFilter(this.normalizeFilterData(filterData, 'filter_data'), context)
      const text = query?.get(this.filterParam)
      if (!text) return undefined
      return this.applyJsonFilter(this.normalizeFilterData(text, 'filter'), context)
    } catch (error) {
      if (!(error instanceof ServiceError)) logException(error)
      throw error
    }
  }

  /** Return an object from a JSON string or object, or throw a 400. */
  normalizeFilterData(rawFilter: unknown, sourceLabel: string): unknown {
    if (typeof rawFilter === 'string') {
      try {
        return JSON.parse(rawFilter) as unknown
      } catch {
        throw filterError('invalid_json', `Invalid JSON for '${sourceLabel}'. Expected a valid JSON object.`)
      }
    }
    if (isPlainObject(rawFilter)) return rawFilter
    throw filterError('invalid_filter_type', `'${sourceLabel}' must be a dict or a JSON string.`)
  }

  applyJsonFilter(filterData: unknown, context: FilterContext = {}): SQL | undefined {
    if (!filterData || (isPlainObject(filterData) && !Object.keys(filterData).length)) return undefined
    this.validateStructure(filterData, this.getMaxDepth(), 1)
    this.validateFields(filterData)
    return this.evaluateNode(filterData, context)
  }

  /** Only fields declared by the filter set may be used. */
  validateFields(filterData: unknown): void {
    const allowed = this.filterSet.baseFilters
    if (!allowed.size) {
      throw filterError('filtering_not_enabled', 'Filtering is not enabled for this endpoint (missing filterset_class)')
    }
    for (const field of this.extractFieldNames(filterData)) {
      if (!allowed.has(field)) throw filterError('invalid_filter_field', `Filtering on field '${field}' is not allowed`)
    }
  }

  /** Hook: transform a field name before it is checked against the filter set. */
  transformFieldNameForValidation(fieldName: string): string {
    return fieldName
  }

  extractFieldNames(filterData: unknown): string[] {
    if (!isPlainObject(filterData)) return []
    const fields: string[] = []
    for (const [key, value] of Object.entries(filterData)) {
      const op = key.toLowerCase()
      if (!isLogicalKey(key)) fields.push(this.transformFieldNameForValidation(key))
      else if (op === 'not') {
        if (isPlainObject(value)) fields.push(...this.extractFieldNames(value))
      } else for (const item of value as unknown[]) fields.push(...this.extractFieldNames(item))
    }
    return fields
  }

  /** `or`/`and` combine child conditions, `not` negates its child, a leaf goes through the filter set. */
  evaluateNode(node: unknown, context: FilterContext): SQL | undefined {
    if (!isPlainObject(node)) return undefined
    const operatorKey = Object.keys(node).find(isLogicalKey)
    if (operatorKey === undefined) return this.buildLeafQ(node, context)
    const operator = operatorKey.toLowerCase()
    const value = node[operatorKey]
    if (operator === 'not') {
      if (!isPlainObject(value)) return undefined
      const child = this.evaluateNode(value, context)
      return child ? not(child) : undefined
    }
    if (!Array.isArray(value) || !value.length) return undefined
    const children = value.map(child => this.evaluateNode(child, context)).filter((child): child is SQL => child !== undefined)
    return operator === 'or' ? or(...children) : and(...children)
  }

  /** Hook: rewrite leaf keys or values before the filter set sees them. */
  preprocessLeafConditions(leafConditions: Record<string, unknown>): Record<string, unknown> {
    return leafConditions
  }

  buildLeafQ(leafConditions: Record<string, unknown>, context: FilterContext): SQL | undefined {
    if (!Object.keys(leafConditions).length) return undefined
    const data: FilterData = {}
    for (const [key, value] of Object.entries(this.preprocessLeafConditions(leafConditions))) {
      data[key] = Array.isArray(value) ? value.map(String) : [value === null || value === undefined ? '' : String(value)]
    }
    return this.filterSet.buildCombinedQ(data, context)
  }

  getMaxDepth(): number {
    const value = Number(this.options.maxDepth ?? this.defaultMaxDepth)
    return Number.isInteger(value) && value > 0 ? value : this.defaultMaxDepth
  }

  /** Validate operator usage, node shapes and nesting depth. */
  validateStructure(node: unknown, maxDepth: number, currentDepth: number): void {
    if (currentDepth > maxDepth) {
      throw filterError('max_depth_exceeded', `Filter nesting is too deep (max ${maxDepth}); found depth ${currentDepth}`)
    }
    if (!isPlainObject(node)) throw filterError('invalid_filter_node', 'Each filter node must be a JSON object')
    if (!Object.keys(node).length) throw filterError('empty_filter_object', 'Filter objects must not be empty')
    const logicalKeys = Object.keys(node).filter(isLogicalKey)
    if (logicalKeys.length > 1) {
      throw filterError('multiple_logical_operators', 'A filter object cannot contain multiple logical operators at the same level')
    }
    if (logicalKeys.length === 1) {
      const opKey = logicalKeys[0]
      if (Object.keys(node).length !== 1) {
        throw filterError('mixed_operator_and_fields', `Cannot mix logical operator '${opKey}' with field keys at the same level`)
      }
      const op = opKey.toLowerCase()
      const value = node[opKey]
      if (op === 'not') {
        if (!isPlainObject(value)) throw filterError('invalid_not_child', "'not' must be a single JSON object")
        this.validateStructure(value, maxDepth, currentDepth + 1)
        return
      }
      if (!Array.isArray(value) || !value.length) {
        throw filterError('invalid_operator_children', `'${op}' must be a non-empty list of filter objects`)
      }
      for (const child of value) {
        if (!isPlainObject(child)) throw filterError('invalid_operator_child_type', `All children of '${op}' must be JSON objects`)
        this.validateStructure(child, maxDepth, currentDepth + 1)
      }
      return
    }
    this.validateLeaf(node)
  }

  validateLeaf(leaf: unknown): void {
    if (!isPlainObject(leaf) || !Object.keys(leaf).length) throw filterError('invalid_leaf', 'Leaf filter must be a non-empty JSON object')
    for (const [key, value] of Object.entries(leaf)) {
      if (isLogicalKey(key)) throw filterError('operator_in_leaf', 'Logical operators cannot appear in a leaf filter object')
      if (Array.isArray(value)) {
        if (!value.length) throw filterError('empty_list_value', `List value for '${key}' must not be empty`)
        if (!value.every(item => this.isScalar(item))) {
          throw filterError('non_scalar_list_item', `List value for '${key}' must contain only scalar items`)
        }
      } else if (!this.isScalar(value)) {
        throw filterError('invalid_value_type', `Value for '${key}' must be a scalar, null, or list/tuple of scalars`)
      }
    }
  }

  isScalar(value: unknown): boolean {
    return value === null || ['string', 'number', 'boolean'].includes(typeof value)
  }
}

// =====================================================================================
// Filter migrations (Plane `utils/filters/filter_migrations.py`)
// =====================================================================================

/** A table with legacy `filters` and `rich_filters` JSON columns (issue views, cycle/module user properties, exporters). */
export type FilterMigratableTable = SQLiteTable & { id: AnySQLiteColumn; filters: AnySQLiteColumn; richFilters: AnySQLiteColumn }

/** Statements per `db.batch` call; each statement binds two values and D1 caps bindings per query. */
const MIGRATION_BATCH_SIZE = 40

/**
 * Plane `migrate_single_model_filters`: fill `rich_filters` for rows that have `filters` but empty `rich_filters`.
 * Returns `[updated, errors]`. Rows that cannot be converted are logged and skipped.
 */
export async function migrateSingleModelFilters(
  db: LancityDb,
  table: FilterMigratableTable,
  modelName: string,
  converter: LegacyToRichFiltersConverter
): Promise<[number, number]> {
  const records = await db
    .select({ id: table.id, filters: table.filters })
    .from(table)
    .where(sql`${table.filters} != '{}' and ${table.richFilters} = '{}'`)
  if (!records.length) return [0, 0]
  const richColumn = sql.identifier(table.richFilters.name)
  const updates: SQL[] = []
  let errors = 0
  for (const record of records as { id: number; filters: unknown }[]) {
    try {
      if (!record.filters || typeof record.filters !== 'object' || !Object.keys(record.filters).length) continue
      const rich = converter.convert(record.filters as Record<string, unknown>, false)
      updates.push(sql`update ${table} set ${richColumn} = ${JSON.stringify(rich)} where ${sql.identifier(table.id.name)} = ${record.id}`)
    } catch (error) {
      console.warn(JSON.stringify({ level: 'warn', label: 'filter-migration', model: modelName, id: record.id, message: String(error) }))
      errors++
    }
  }
  for (let i = 0; i < updates.length; i += MIGRATION_BATCH_SIZE) {
    const chunk = updates.slice(i, i + MIGRATION_BATCH_SIZE).map(statement => db.run(statement))
    await db.batch(chunk as unknown as [(typeof chunk)[0], ...typeof chunk])
  }
  return [updates.length, errors]
}

/** Plane `migrate_models_filters_to_rich_filters`: run the migration for several tables, isolating failures. */
export async function migrateModelsFiltersToRichFilters(
  db: LancityDb,
  models: Record<string, FilterMigratableTable>,
  converter: LegacyToRichFiltersConverter
): Promise<Record<string, [number, number]>> {
  const results: Record<string, [number, number]> = {}
  for (const [name, table] of Object.entries(models)) {
    try {
      results[name] = await migrateSingleModelFilters(db, table, name, converter)
    } catch (error) {
      logException(error, { context: { model: name } })
      results[name] = [0, 1]
    }
  }
  return results
}

/** Plane `clear_models_rich_filters`: reset `rich_filters` to `{}`. Returns the cleared row count per table. */
export async function clearModelsRichFilters(db: LancityDb, models: Record<string, FilterMigratableTable>): Promise<Record<string, number>> {
  const results: Record<string, number> = {}
  for (const [name, table] of Object.entries(models)) {
    try {
      const result = await db.run(
        sql`update ${table} set ${sql.identifier(table.richFilters.name)} = '{}' where ${sql.identifier(table.richFilters.name)} != '{}'`
      )
      results[name] = (result as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0
    } catch (error) {
      logException(error, { context: { model: name } })
      results[name] = 0
    }
  }
  return results
}

// =====================================================================================
// Search, field filters and ordering (DRF `SearchFilter`, `DjangoFilterBackend`, Plane `order_by`)
// =====================================================================================

/** Escape `%`, `_` and `\` for a LIKE pattern used with `ESCAPE '\'`. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&')
}

/**
 * DRF `SearchFilter`: terms are split on whitespace and commas; every term must match at least one column
 * (Unicode case-insensitive substring). Returns undefined when there is no term or column.
 */
export function buildSearchCondition(columns: SQLWrapper[], search: string | null | undefined, normalizedColumns?: SQL[]): SQL | undefined {
  const terms = (search ?? '').replaceAll('\0', '').replaceAll(',', ' ').split(/\s+/).filter(Boolean)
  if (!terms.length || !columns.length) return undefined
  return and(
    ...terms.map(term => {
      return or(...columns.map((column, index) => containsFolded(sql`${column}`, term, normalizedColumns?.[index])))
    })
  )
}

/**
 * DRF `filterset_fields` with `DjangoFilterBackend`: exact match on declared query parameters.
 * `columns` maps a parameter name to its column.
 */
export function buildFieldFilters(query: URLSearchParams, columns: Record<string, AnySQLiteColumn>): SQL | undefined {
  const conditions: SQL[] = []
  for (const [name, column] of Object.entries(columns)) {
    const value = query.get(name)
    if (value !== null && value !== '') conditions.push(eq(column, value))
  }
  return and(...conditions)
}

/** Rows that are not soft-deleted (Plane `SoftDeletionManager`). */
export function notDeleted(table: { deletedAt: AnySQLiteColumn }): SQL {
  return isNull(table.deletedAt)
}

/**
 * Plane `order_by` query parameter (`-priority`): only names in `allowed` are honoured, anything else falls
 * back to `fallback`. NULLs sort last and ties break on newest first.
 */
export function buildOrderBy(
  orderBy: string | null | undefined,
  allowed: Record<string, SQLWrapper>,
  fallback: string,
  createdAt: SQLWrapper
): SQL {
  const pick = (value: string | null | undefined) => {
    const desc = Boolean(value?.startsWith('-'))
    const name = desc ? value!.slice(1) : value
    return name && Object.hasOwn(allowed, name) ? { column: allowed[name], desc } : null
  }
  const choice = pick(orderBy) ?? pick(fallback)
  if (!choice) throw new Error(`Unknown fallback order "${fallback}"`)
  return orderByNullsLast(choice.column, choice.desc, createdAt)
}
