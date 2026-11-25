/**
 * Response shaping shared by every endpoint (Plane `app/serializers/base.py`, `api/serializers/base.py`
 * and `utils/serializers.py`). Rows are plain objects, so a "serializer" is a function from a row to a
 * response object; `fields` and `expand` query parameters drive which keys appear.
 */

export type Serialized = Record<string, unknown>
export type Serializer<T = unknown> = (instance: T) => Serialized | Promise<Serialized>

/** Names whose expansion is a list of related rows (Plane `MANY_EXPANSION_FIELDS`). */
export const MANY_EXPANSION_FIELDS: ReadonlySet<string> = new Set([
  'members',
  'assignees',
  'labels',
  'issue_cycle',
  'issue_relation',
  'issue_intake',
  'issue_reactions',
  'issue_link',
  'sub_issues',
  'issue_related'
])

const expansionMapper = new Map<string, Serializer>()

/**
 * Register the lite serializer used when a client asks for `expand=<name>` (user, workspace, project, state,
 * created_by, assignees, ...). Domain modules call this once at load time. Registering a name again replaces it.
 */
export function registerExpansion(name: string, serializer: Serializer): void {
  expansionMapper.set(name, serializer)
}

/** Plane `get_expansion_mapper`: the `expand` name to serializer mapping shared by every serializer. */
export function getExpansionMapper(): ReadonlyMap<string, Serializer> {
  return expansionMapper
}

/** `?fields=a,b` / `?expand=x,y` as a list, or null when absent (Plane `BaseAPIView.fields` and `.expand`). */
export function listParam(query: URLSearchParams | URL, name: string): string[] | null {
  const params = query instanceof URL ? query.searchParams : query
  const items = (params.get(name) ?? '').split(',').filter(Boolean)
  return items.length ? items : null
}

export const fieldsFromQuery = (query: URLSearchParams | URL) => listParam(query, 'fields')
export const expandFromQuery = (query: URLSearchParams | URL) => listParam(query, 'expand')

/** A requested field is a plain name or a `{name: nested}` entry whose key counts as the name. */
export type FieldSpec = string | Record<string, unknown>

function fieldNames(fields: readonly FieldSpec[] | null | undefined): Set<string> {
  const names = new Set<string>()
  for (const item of fields ?? []) {
    if (typeof item === 'string') names.add(item)
    else if (item && typeof item === 'object') for (const key of Object.keys(item)) names.add(key)
  }
  return names
}

/**
 * Plane `BaseSerializer._filter_fields` (public API): keep only the requested keys.
 * No fields means every key. Nested `{name: [...]}` entries keep their key (nested filtering is not applied).
 */
export function pickFields<T extends Serialized>(row: T, fields?: readonly FieldSpec[] | null): Partial<T> {
  if (!fields?.length) return row
  const allowed = fieldNames(fields)
  return Object.fromEntries(Object.entries(row).filter(([key]) => allowed.has(key))) as Partial<T>
}

/**
 * Resolve `expand` names against the source instance and put the related data into `response`
 * (Plane `to_representation` expansion step). `instance` uses the row's own key names.
 *
 * - a list relation is serialized item by item, a single relation once, a null relation stays null;
 * - a name without a registered serializer falls back to the foreign key (`created_by` reads `createdById`);
 * - a name the instance has no relation for keeps whatever the response already holds.
 */
export async function expandRelations<T extends Serialized>(
  response: T,
  instance: Record<string, unknown>,
  expand: readonly string[] | null | undefined,
  mapper: ReadonlyMap<string, Serializer> = expansionMapper
): Promise<T> {
  const result: Serialized = { ...response }
  for (const name of expand ?? []) {
    const serializer = mapper.get(name)
    if (!serializer) {
      const camel = name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
      result[name] = instance[`${camel}Id`] ?? instance[`${name}_id`] ?? null
      continue
    }
    if (!(name in instance)) continue
    const related = instance[name]
    if (Array.isArray(related)) result[name] = await Promise.all(related.map(item => serializer(item)))
    else if (related === null) result[name] = null
    else if (typeof related === 'object' && related !== undefined) result[name] = await serializer(related)
  }
  return result as T
}

export type DynamicSerializerOptions<T> = {
  /** Base serializer of the model. */
  serialize: (instance: T) => Serialized | Promise<Serialized>
  /** `fields` limits the output keys. `undefined` outputs everything. */
  fields?: readonly FieldSpec[] | null
  /** `expand` adds related data and always stays in the output. */
  expand?: readonly string[] | null
  mapper?: ReadonlyMap<string, Serializer>
}

/**
 * Plane `DynamicBaseSerializer`: `fields` restricts the output only, `expand` adds relations and keeps them
 * even when `fields` is given. A bare `fields` name never pulls in a nested object.
 */
export class DynamicSerializer<T extends Record<string, unknown>> {
  readonly outputFields: Set<string> | null
  readonly expand: readonly string[]

  constructor(private readonly options: DynamicSerializerOptions<T>) {
    this.expand = options.expand ?? []
    this.outputFields = options.fields ? new Set([...fieldNames(options.fields), ...this.expand]) : null
  }

  /** Plane `_filter_fields`: the set of keys that will be output, or null for all. */
  filterFields(): Set<string> | null {
    return this.outputFields
  }

  /** Plane `_readable_fields`: the model's field names that survive `fields`. */
  readableFields(allFields: Iterable<string>): string[] {
    return [...allFields].filter(name => this.outputFields === null || this.outputFields.has(name))
  }

  /** Plane `to_representation`. */
  async toRepresentation(instance: T): Promise<Serialized> {
    const base = await this.options.serialize(instance)
    const shaped = this.outputFields ? Object.fromEntries(Object.entries(base).filter(([key]) => this.outputFields!.has(key))) : base
    return expandRelations(shaped, instance, this.expand, this.options.mapper)
  }

  async toList(instances: readonly T[]): Promise<Serialized[]> {
    return Promise.all(instances.map(instance => this.toRepresentation(instance)))
  }
}

/**
 * Plane `writable_data`: drop the keys that are read-only on the serializer, so they stay out of activity
 * and webhook payloads as well as out of the saved row.
 */
export function writableData<T extends Record<string, unknown>>(data: T, readOnlyFields: Iterable<string>): Partial<T> {
  const readOnly = new Set(readOnlyFields)
  return Object.fromEntries(Object.entries(data).filter(([key]) => !readOnly.has(key))) as Partial<T>
}
