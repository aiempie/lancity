import { containsFolded, searchValue } from '@/server/common/unicode'
import { sql, type SQL } from 'drizzle-orm'
import { issues } from '@/db/schema/issue'
import { ServiceError } from '@/server/common/errors'
import type { LancityDb } from '@/types/database/schema'
import type { IssueGroupValuesOptions } from '@/types/issue/schema'

/**
 * Query-string filters, ordering, grouping and search of the issue lists.
 * Ports of `plane/utils/issue_filters.py`, `order_queryset.py`, `grouper.py` and `issue_search.py`.
 * Filters build SQL predicates on the `issues` table instead of Django lookups. Differences from Plane:
 * a "None" token next to ids is an OR (Django ANDs both and always matches nothing), ids are integers
 * instead of UUIDs, and `logged_by` has no column in Lancity so it is ignored (PD-1882).
 */
export type FilterParams = Record<string, string | string[] | undefined>
export type FilterMethod = 'GET' | 'POST'

const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none']
const STATE_GROUPS = ['backlog', 'unstarted', 'started', 'completed', 'cancelled']
const DATE_PATTERN = /^\d+_(weeks|months)$/
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/

/** Port of `filter_valid_uuids` (PD-1855). Lancity ids are positive integers, anything else is dropped. */
export function filterValidUuids(values: string[]): number[] {
  return values.filter(value => /^[1-9]\d{0,15}$/.test(value)).map(Number)
}
export const filterValidIds = filterValidUuids

function listOf(params: FilterParams, key: string, method: FilterMethod): string[] {
  const value = params[key]
  if (value === undefined) return []
  if (method === 'GET' && typeof value === 'string') return value.split(',').filter(item => item !== 'null')
  return (Array.isArray(value) ? value : [value]).filter(item => item !== 'null' && item !== '')
}
function hasValue(list: string[]) {
  return list.length > 0 && !list.includes('')
}

/** `exists` over a child table of `issues` on `issue_id`, optionally constrained to a column in a list. */
function existsIn(table: string, column: string | null, ids: number[], negate = false, extra?: SQL): SQL {
  const idMatch = column ? sql` and ${sql.raw(`x.${column}`)} in (select value from json_each(${JSON.stringify(ids)}))` : sql``
  const body = sql`select 1 from ${sql.raw(table)} x where x.issue_id = ${issues.id} and x.deleted_at is null${idMatch}${extra ?? sql``}`
  return negate ? sql`not exists (${body})` : sql`exists (${body})`
}

/** Combine a "None" token with ids: any of them matches. */
function orNone(none: SQL | null, ids: SQL | null): SQL | null {
  if (none && ids) return sql`(${none} or ${ids})`
  return none ?? ids
}

function nowDate() {
  return new Date().toISOString().slice(0, 10)
}
function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Port of `string_date_filter` (PD-1856): `2_weeks;after;fromnow` style relative dates. A month counts as 30 days. */
export function stringDateFilter(
  conds: SQL[],
  duration: number,
  subsequent: string,
  term: string,
  column: SQL,
  offset: string
) {
  const days = term === 'months' ? duration * 30 : term === 'weeks' ? duration * 7 : null
  if (days === null) return
  const target = addDays(nowDate(), offset === 'fromnow' ? days : -days)
  conds.push(subsequent === 'after' ? sql`${column} >= ${target}` : sql`${column} <= ${target}`)
}

/** Port of `date_filter` (PD-1857). `column` must evaluate to a `YYYY-MM-DD` string. */
export function dateFilter(conds: SQL[], column: SQL, queries: string[]) {
  for (const query of queries) {
    const parts = query.split(';')
    if (parts.length >= 2) {
      if (DATE_PATTERN.test(parts[0])) {
        if (parts.length === 3) {
          const [digits, term] = parts[0].split('_')
          stringDateFilter(conds, Number(digits), parts[1], term, column, parts[2])
        }
      } else if (DATE_VALUE.test(parts[0])) {
        conds.push(parts.includes('after') ? sql`${column} >= ${parts[0]}` : sql`${column} <= ${parts[0]}`)
      }
    } else if (DATE_VALUE.test(parts[0])) conds.push(sql`${column} = ${parts[0]}`)
  }
}

const timestampDate = (column: SQL) => sql`date(${column} / 1000, 'unixepoch')`

export function filterState(params: FilterParams, conds: SQL[], method: FilterMethod = 'GET') {
  const ids = filterValidUuids(listOf(params, 'state', method))
  if (ids.length) conds.push(sql`${issues.stateId} in (select value from json_each(${JSON.stringify(ids)}))`)
  return conds
}
export function filterStateGroup(params: FilterParams, conds: SQL[], method: FilterMethod = 'GET') {
  const groups = listOf(params, 'state_group', method).filter(group => STATE_GROUPS.includes(group))
  if (groups.length)
    conds.push(
      sql`exists (select 1 from states s where s.id = ${issues.stateId} and s."group" in (select value from json_each(${JSON.stringify(groups)})))`
    )
  return conds
}
export function filterEstimatePoint(params: FilterParams, conds: SQL[], method: FilterMethod = 'GET') {
  const ids = filterValidUuids(listOf(params, 'estimate_point', method))
  if (ids.length) conds.push(sql`${issues.estimatePointId} in (select value from json_each(${JSON.stringify(ids)}))`)
  return conds
}
export function filterPriority(params: FilterParams, conds: SQL[], method: FilterMethod = 'GET') {
  const priorities = listOf(params, 'priority', method).filter(priority => PRIORITIES.includes(priority))
  if (priorities.length) conds.push(sql`${issues.priority} in (select value from json_each(${JSON.stringify(priorities)}))`)
  return conds
}
export function filterParent(params: FilterParams, conds: SQL[], method: FilterMethod = 'GET') {
  const list = listOf(params, 'parent', method)
  const ids = filterValidUuids(list)
  const clause = orNone(
    list.includes('None') ? sql`${issues.parentId} is null` : null,
    hasValue(list) && ids.length ? sql`${issues.parentId} in (select value from json_each(${JSON.stringify(ids)}))` : null
  )
  if (clause) conds.push(clause)
  return conds
}
export function filterLabels(params: FilterParams, conds: SQL[], method: FilterMethod = 'GET') {
  const list = listOf(params, 'labels', method)
  const ids = filterValidUuids(list)
  const clause = orNone(
    list.includes('None') ? existsIn('issue_labels', null, [], true) : null,
    hasValue(list) && ids.length ? existsIn('issue_labels', 'label_id', ids) : null
  )
  if (clause) conds.push(clause)
  return conds
}
export function filterAssignees(params: FilterParams, conds: SQL[], method: FilterMethod = 'GET') {
  const list = listOf(params, 'assignees', method)
  const ids = filterValidUuids(list)
  const clause = orNone(
    list.includes('None') ? existsIn('issue_assignees', null, [], true) : null,
    hasValue(list) && ids.length ? existsIn('issue_assignees', 'assignee_id', ids) : null
  )
  if (clause) conds.push(clause)
  return conds
}
export function filterMentions(params: FilterParams, conds: SQL[], method: FilterMethod = 'GET') {
  const ids = filterValidUuids(listOf(params, 'mentions', method))
  if (ids.length) conds.push(existsIn('issue_mentions', 'mention_id', ids))
  return conds
}
export function filterCreatedBy(params: FilterParams, conds: SQL[], method: FilterMethod = 'GET') {
  const list = listOf(params, 'created_by', method)
  const ids = filterValidUuids(list)
  const clause = orNone(
    list.includes('None') ? sql`${issues.createdById} is null` : null,
    hasValue(list) && ids.length ? sql`${issues.createdById} in (select value from json_each(${JSON.stringify(ids)}))` : null
  )
  if (clause) conds.push(clause)
  return conds
}
export function filterName(params: FilterParams, conds: SQL[]) {
  const name = params.name
  if (typeof name === 'string' && name !== '') {
    conds.push(containsFolded(sql`${issues.name}`, name, searchValue('issues', 'name', sql`${issues.id}`)))
  }
  return conds
}
function dateKey(key: string, column: SQL) {
  return (params: FilterParams, conds: SQL[], method: FilterMethod = 'GET') => {
    const queries = listOf(params, key, method)
    if (hasValue(queries)) dateFilter(conds, column, queries)
    return conds
  }
}
export const filterCreatedAt = dateKey('created_at', timestampDate(sql`${issues.createdAt}`))
export const filterUpdatedAt = dateKey('updated_at', timestampDate(sql`${issues.updatedAt}`))
export const filterCompletedAt = dateKey('completed_at', timestampDate(sql`${issues.completedAt}`))
export function filterStartDate(params: FilterParams, conds: SQL[], method: FilterMethod = 'GET') {
  if (method === 'GET') {
    const queries = listOf(params, 'start_date', method)
    if (hasValue(queries)) dateFilter(conds, sql`${issues.startDate}`, queries)
  } else if (typeof params.start_date === 'string' && params.start_date) conds.push(sql`${issues.startDate} = ${params.start_date}`)
  return conds
}
export function filterTargetDate(params: FilterParams, conds: SQL[], method: FilterMethod = 'GET') {
  if (method === 'GET') {
    const queries = listOf(params, 'target_date', method)
    if (hasValue(queries)) dateFilter(conds, sql`${issues.targetDate}`, queries)
  } else if (typeof params.target_date === 'string' && params.target_date)
    conds.push(sql`${issues.targetDate} = ${params.target_date}`)
  return conds
}
/** Port of `filter_issue_state_type` (PD-1873): `type=backlog|active|all`. */
export function filterIssueStateType(params: FilterParams, conds: SQL[]) {
  const type = typeof params.type === 'string' ? params.type : 'all'
  const groups = type === 'backlog' ? ['backlog'] : type === 'active' ? ['unstarted', 'started'] : STATE_GROUPS
  conds.push(
    sql`exists (select 1 from states s where s.id = ${issues.stateId} and s."group" in (select value from json_each(${JSON.stringify(groups)})))`
  )
  return conds
}
export function filterProject(params: FilterParams, conds: SQL[], method: FilterMethod = 'GET') {
  const ids = filterValidUuids(listOf(params, 'project', method))
  if (ids.length) conds.push(sql`${issues.projectId} in (select value from json_each(${JSON.stringify(ids)}))`)
  return conds
}
export function filterCycle(params: FilterParams, conds: SQL[], method: FilterMethod = 'GET') {
  const list = listOf(params, 'cycle', method)
  const ids = filterValidUuids(list)
  const clause = orNone(
    list.includes('None') ? existsIn('cycle_issues', null, [], true) : null,
    hasValue(list) && ids.length ? existsIn('cycle_issues', 'cycle_id', ids) : null
  )
  if (clause) conds.push(clause)
  return conds
}
export function filterModule(params: FilterParams, conds: SQL[], method: FilterMethod = 'GET') {
  const list = listOf(params, 'module', method)
  const ids = filterValidUuids(list)
  const clause = orNone(
    list.includes('None') ? existsIn('module_issues', null, [], true) : null,
    hasValue(list) && ids.length ? existsIn('module_issues', 'module_id', ids) : null
  )
  if (clause) conds.push(clause)
  return conds
}
function intakeStatus(key: string) {
  return (params: FilterParams, conds: SQL[], method: FilterMethod = 'GET') => {
    const statuses = listOf(params, key, method)
      .map(Number)
      .filter(value => Number.isInteger(value))
    if (statuses.length)
      conds.push(
        sql`exists (select 1 from intake_issues x where x.issue_id = ${issues.id} and x.deleted_at is null and x.status in (select value from json_each(${JSON.stringify(statuses)})))`
      )
    return conds
  }
}
export const filterIntakeStatus = intakeStatus('intake_status')
export const filterInboxStatus = intakeStatus('inbox_status')
/** Port of `filter_sub_issue_toggle` (PD-1879): `sub_issue=false` hides issues that have a parent. */
export function filterSubIssueToggle(params: FilterParams, conds: SQL[]) {
  if ((typeof params.sub_issue === 'string' ? params.sub_issue : 'false') === 'false') conds.push(sql`${issues.parentId} is null`)
  return conds
}
export function filterSubscribedIssues(params: FilterParams, conds: SQL[], method: FilterMethod = 'GET') {
  const ids = filterValidUuids(listOf(params, 'subscriber', method))
  if (ids.length) conds.push(existsIn('issue_subscribers', 'subscriber_id', ids))
  return conds
}
export function filterStartTargetDateIssues(params: FilterParams, conds: SQL[]) {
  if (params.start_target_date === 'true') conds.push(sql`${issues.targetDate} is not null and ${issues.startDate} is not null`)
  return conds
}
/** Plane filters by `logged_by` (worklogs). Lancity has no such column, so the filter is accepted and ignored (PD-1882). */
export function filterLoggedBy(_params: FilterParams, conds: SQL[]) {
  return conds
}

const FILTERS: Record<string, (params: FilterParams, conds: SQL[], method: FilterMethod) => SQL[]> = {
  state: filterState,
  state_group: filterStateGroup,
  estimate_point: filterEstimatePoint,
  priority: filterPriority,
  parent: filterParent,
  labels: filterLabels,
  assignees: filterAssignees,
  mentions: filterMentions,
  created_by: filterCreatedBy,
  logged_by: filterLoggedBy,
  name: filterName,
  created_at: filterCreatedAt,
  updated_at: filterUpdatedAt,
  start_date: filterStartDate,
  target_date: filterTargetDate,
  completed_at: filterCompletedAt,
  type: filterIssueStateType,
  project: filterProject,
  cycle: filterCycle,
  module: filterModule,
  intake_status: filterIntakeStatus,
  inbox_status: filterInboxStatus,
  sub_issue: filterSubIssueToggle,
  subscriber: filterSubscribedIssues,
  start_target_date: filterStartTargetDateIssues
}

/** Port of `issue_filters` (PD-1883): only keys present in the query are applied. */
export function issueFilters(params: FilterParams, method: FilterMethod = 'GET'): SQL[] {
  const conds: SQL[] = []
  for (const [key, apply] of Object.entries(FILTERS)) if (key in params) apply(params, conds, method)
  return conds
}

/* ---------------------------------- ordering --------------------------------- */

export const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low', 'none']
export const STATE_ORDER = STATE_GROUPS
/** Bare field names only. The sanitizer strips one leading '-' before the lookup (PD-1915). */
export const ISSUE_ORDER_BY_ALLOWLIST = new Set([
  'created_at',
  'updated_at',
  'sequence_id',
  'sort_order',
  'target_date',
  'start_date',
  'completed_at',
  'archived_at',
  'priority',
  'state__name',
  'state__group',
  'assignees__first_name',
  'labels__name',
  'issue_module__module__name'
])
export const ISSUE_GROUP_BY_ALLOWLIST = new Set([
  'state_id',
  'state__group',
  'priority',
  'labels__id',
  'assignees__id',
  'issue_module__module_id',
  'cycle_id',
  'project_id',
  'created_by',
  'target_date',
  'start_date'
])

/** Port of `sanitize_order_by` (PD-1915). Anything outside the allow-list, or with a double dash, falls back. */
export function sanitizeOrderBy(value: string | null | undefined, allowed: Set<string>, fallback = '-created_at') {
  if (!value) return fallback
  const desc = value.startsWith('-')
  const bare = desc ? value.slice(1) : value
  if (bare.startsWith('-') || !allowed.has(bare)) return fallback
  return desc ? `-${bare}` : bare
}

const rank = (column: SQL, order: string[], fallback: number) =>
  sql`case ${column} ${sql.join(order.map((value, index) => sql`when ${value} then ${index}`), sql` `)} else ${fallback} end`
const stateGroupSql = sql`(select s."group" from states s where s.id = ${issues.stateId})`
const aggregateName = (table: string, join: string) =>
  sql`(select min(x.name) from ${sql.raw(table)} link join ${sql.raw(join)} x where link.issue_id = ${issues.id} and link.deleted_at is null)`
const ORDER_EXPRESSIONS: Record<string, SQL> = {
  created_at: sql`${issues.createdAt}`,
  updated_at: sql`${issues.updatedAt}`,
  sequence_id: sql`${issues.sequenceId}`,
  sort_order: sql`${issues.sortOrder}`,
  target_date: sql`${issues.targetDate}`,
  start_date: sql`${issues.startDate}`,
  completed_at: sql`${issues.completedAt}`,
  archived_at: sql`${issues.archivedAt}`,
  state__name: sql`(select s.name from states s where s.id = ${issues.stateId})`,
  assignees__first_name: aggregateName('issue_assignees', 'user on x.id = link.assignee_id'),
  labels__name: aggregateName('issue_labels', 'labels on x.id = link.label_id'),
  issue_module__module__name: aggregateName('module_issues', 'modules on x.id = link.module_id')
}

/**
 * Port of `order_issue_queryset` (PD-1916). Returns the ORDER BY terms and the sanitized order parameter.
 * `priority` sorts none first and `-priority` urgent first (the direction the Plane paginator ends up using).
 * Ties fall back to the newest issue first, then the id, so pages are stable.
 */
export function orderIssueQueryset(orderByParam: string | null | undefined = '-created_at') {
  const param = sanitizeOrderBy(orderByParam, ISSUE_ORDER_BY_ALLOWLIST)
  const desc = param.startsWith('-')
  const bare = desc ? param.slice(1) : param
  let key: SQL
  let direction: 'asc' | 'desc' = desc ? 'desc' : 'asc'
  if (bare === 'priority') {
    key = rank(sql`${issues.priority}`, PRIORITY_ORDER, PRIORITY_ORDER.length)
    direction = desc ? 'asc' : 'desc'
  } else if (bare === 'state__group') key = rank(stateGroupSql, STATE_ORDER, STATE_ORDER.length)
  else key = ORDER_EXPRESSIONS[bare]
  const terms: SQL[] = [sql`(${key}) is null`, sql`${key} ${sql.raw(direction)}`]
  if (bare !== 'created_at') terms.push(sql`${issues.createdAt} desc`)
  terms.push(sql`${issues.id} desc`)
  return { orderBy: sql.join(terms, sql`, `), orderByParam: param, key, direction }
}

/* ---------------------------------- grouping --------------------------------- */

type GroupSpec = { join: string | null; expr: SQL; multi: boolean; field?: 'label_ids' | 'assignee_ids' | 'module_ids' }
/** Group expressions of `issue_queryset_grouper` (PD-1839). Multi-valued groups join their link table as `alias`. */
export function groupSpec(field: string, alias: string, publicBoard = false): GroupSpec {
  if (!ISSUE_GROUP_BY_ALLOWLIST.has(field)) throw new ServiceError(400, 'INVALID_GROUP_BY', `Invalid group_by field: ${field}`)
  const col = (name: string) => sql.raw(`${alias}.${name}`)
  switch (field) {
    case 'labels__id': {
      const scope = publicBoard
        ? ` and exists (select 1 from labels ${alias}l where ${alias}l.id = ${alias}.label_id and ${alias}l.project_id = issues.project_id and ${alias}l.workspace_id = issues.workspace_id and ${alias}l.deleted_at is null)`
        : ''
      return { join: `left join issue_labels ${alias} on ${alias}.issue_id = issues.id and ${alias}.deleted_at is null${scope}`, expr: sql`${col('label_id')}`, multi: true, field: 'label_ids' }
    }
    case 'assignees__id':
      return { join: `left join issue_assignees ${alias} on ${alias}.issue_id = issues.id and ${alias}.deleted_at is null and exists (select 1 from project_members ${alias}pm where ${alias}pm.member_id = ${alias}.assignee_id and ${alias}pm.project_id = issues.project_id and ${alias}pm.is_active = 1 and ${alias}pm.deleted_at is null)`, expr: sql`${col('assignee_id')}`, multi: true, field: 'assignee_ids' }
    case 'issue_module__module_id': {
      const scope = publicBoard
        ? ` and exists (select 1 from modules ${alias}m where ${alias}m.id = ${alias}.module_id and ${alias}m.project_id = issues.project_id and ${alias}m.workspace_id = issues.workspace_id and ${alias}m.deleted_at is null and ${alias}m.archived_at is null)`
        : ''
      return { join: `left join module_issues ${alias} on ${alias}.issue_id = issues.id and ${alias}.deleted_at is null${scope}`, expr: sql`${col('module_id')}`, multi: true, field: 'module_ids' }
    }
    case 'state_id':
      return { join: null, expr: sql`${issues.stateId}`, multi: false }
    case 'state__group':
      return { join: null, expr: stateGroupSql, multi: false }
    case 'priority':
      return { join: null, expr: sql`${issues.priority}`, multi: false }
    case 'cycle_id':
      return { join: null, expr: sql`(select ci.cycle_id from cycle_issues ci where ci.issue_id = ${issues.id} and ci.deleted_at is null limit 1)`, multi: false }
    case 'project_id':
      return { join: null, expr: sql`${issues.projectId}`, multi: false }
    case 'created_by':
      return { join: null, expr: sql`${issues.createdById}`, multi: false }
    case 'target_date':
      return { join: null, expr: sql`${issues.targetDate}`, multi: false }
    default:
      return { join: null, expr: sql`${issues.startDate}`, multi: false }
  }
}

/** Row annotations of every list view: related ids and counters (`apply_annotations`, PD-0581, PD-0598). */
export function issueAnnotations(publicBoard = false) {
  return sql`
  (select ci.cycle_id from cycle_issues ci where ci.issue_id = issues.id and ci.deleted_at is null limit 1) as cycle_id,
  (select count(*) from issue_links x where x.issue_id = issues.id and x.deleted_at is null) as link_count,
  (select count(*) from issue_attachments x where x.issue_id = issues.id and x.deleted_at is null) as attachment_count,
  (select count(*) from issues si where si.parent_id = issues.id and si.deleted_at is null and si.archived_at is null and si.is_draft = 0
     and not exists (select 1 from states ss where ss.id = si.state_id and ss."group" = 'triage')) as sub_issues_count,
  coalesce((select json_group_array(v) from (select distinct x.label_id as v from issue_labels x where x.issue_id = issues.id and x.deleted_at is null ${publicBoard ? sql`and exists (select 1 from labels l where l.id = x.label_id and l.project_id = issues.project_id and l.workspace_id = issues.workspace_id and l.deleted_at is null)` : sql``})), '[]') as label_ids,
  coalesce((select json_group_array(v) from (select distinct x.assignee_id as v from issue_assignees x
     join project_members apm on apm.member_id = x.assignee_id and apm.project_id = issues.project_id and apm.is_active = 1 and apm.deleted_at is null
     where x.issue_id = issues.id and x.deleted_at is null)), '[]') as assignee_ids,
  coalesce((select json_group_array(v) from (select distinct x.module_id as v from module_issues x join modules m on m.id = x.module_id and m.archived_at is null
     where x.issue_id = issues.id and x.deleted_at is null ${publicBoard ? sql`and m.project_id = issues.project_id and m.workspace_id = issues.workspace_id and m.deleted_at is null` : sql``})), '[]') as module_ids,
  (select s."group" from states s where s.id = issues.state_id) as state__group`
}
export const ISSUE_ANNOTATIONS = issueAnnotations()

const LIST_COLUMNS = sql`issues.id, issues.name, issues.state_id, issues.sort_order, issues.completed_at, issues.estimate_point_id as estimate_point,
  issues.priority, issues.start_date, issues.target_date, issues.sequence_id, issues.project_id, issues.parent_id,
  issues.created_at, issues.updated_at, issues.created_by_id as created_by, issues.updated_by_id as updated_by, issues.is_draft, issues.archived_at`
export const ISSUE_LIST_SELECT = sql`${LIST_COLUMNS}, ${ISSUE_ANNOTATIONS}`
export const PUBLIC_ISSUE_LIST_SELECT = sql`${LIST_COLUMNS}, ${issueAnnotations(true)}`

const JSON_FIELDS = new Set(['label_ids', 'assignee_ids', 'module_ids'])
const TIMESTAMP_FIELDS = new Set(['completed_at', 'created_at', 'updated_at'])
const toCamel = (key: string) => key.replace(/_+([a-z])/g, (_, letter: string) => letter.toUpperCase())

/**
 * Port of `issue_on_results` (PD-1840): decode the JSON id arrays, convert millisecond timestamps to ISO strings and
 * rename columns to the camelCase fields of the Lancity API. Group helper columns stay available as `__g`, `__sg`.
 */
export function issueOnResults(rows: Record<string, unknown>[]) {
  return rows.map(row => {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith('__')) continue
      if (JSON_FIELDS.has(key)) out[toCamel(key)] = typeof value === 'string' ? JSON.parse(value) : (value ?? [])
      else if (TIMESTAMP_FIELDS.has(key)) out[toCamel(key)] = typeof value === 'number' ? new Date(value).toISOString() : value
      else if (key === 'is_draft') out.isDraft = Boolean(value)
      else out[toCamel(key)] = value
    }
    return out
  })
}

const NONE = 'None'
/** Normalise a group value the way Plane keys its result dictionary: `str(value)`, null becomes "None". */
export const groupKey = (value: unknown) => (value === null || value === undefined ? NONE : String(value))

/**
 * Port of `issue_group_values` (PD-1841): every value a group can take, so empty groups still appear.
 * Scoped to one project, or to the projects the actor belongs to when `projectId` is absent.
 */
export async function issueGroupValues(
  db: LancityDb,
  field: string,
  slug: string,
  projectId: number | null,
  baseWhere: SQL,
  options: IssueGroupValuesOptions = {}
): Promise<string[]> {
  const { userId, publicBoard = false } = options
  if (projectId === null && userId === undefined) throw new Error('issueGroupValues needs a project or a user')
  const projectFilter =
    projectId !== null
      ? sql`= ${projectId}`
      : sql`in (select pm.project_id from project_members pm join workspaces w on w.id = pm.workspace_id
          where w.slug = ${slug} and pm.member_id = ${userId} and pm.is_active = 1 and pm.deleted_at is null)`
  const column = async (query: SQL) => (await db.all<{ v: unknown }>(query)).map(row => String(row.v))
  switch (field) {
    case 'state_id':
      return column(sql`select id as v from states where is_triage = 0 and deleted_at is null and project_id ${projectFilter} order by sequence, id`)
    case 'labels__id':
      return [...(await column(sql`select id as v from labels where deleted_at is null and project_id ${projectFilter} order by sort_order, id`)), NONE]
    case 'assignees__id':
      return projectId !== null
        ? column(sql`select member_id as v from project_members where project_id = ${projectId} and is_active = 1 and deleted_at is null`)
        : column(sql`select wm.member_id as v from workspace_members wm join workspaces w on w.id = wm.workspace_id where w.slug = ${slug} and wm.is_active = 1 and wm.deleted_at is null`)
    case 'issue_module__module_id':
      return [...(await column(sql`select id as v from modules where deleted_at is null and project_id ${projectFilter} ${publicBoard ? sql`and archived_at is null` : sql``}`)), NONE]
    case 'cycle_id':
      return [...(await column(sql`select id as v from cycles where deleted_at is null and project_id ${projectFilter}`)), NONE]
    case 'project_id':
      return column(sql`select id as v from projects where deleted_at is null and id ${projectFilter}`)
    case 'priority':
      return ['low', 'medium', 'high', 'urgent', 'none']
    case 'state__group':
      return STATE_GROUPS
    case 'target_date':
    case 'start_date':
    case 'created_by': {
      const expression = field === 'created_by' ? sql.raw('issues.created_by_id') : sql.raw(`issues.${field}`)
      return column(sql`select distinct ${expression} as v from issues where ${baseWhere} and ${expression} is not null`)
    }
    default:
      return []
  }
}

/* ----------------------------------- search ---------------------------------- */

/**
 * Port of `search_issues` (PD-1886): the term matches the name, the project identifier, or any whole number in the
 * term (up to 20 characters) as a sequence id. Use as a predicate on a query that joins `projects`.
 */
export function searchIssues(query: string): SQL {
  const terms: SQL[] = [
    containsFolded(sql`${issues.name}`, query, searchValue('issues', 'name', sql`${issues.id}`)),
    containsFolded(sql`(select p.identifier from projects p where p.id = ${issues.projectId})`, query, searchValue('projects', 'identifier', sql`${issues.projectId}`))
  ]
  if (query.length <= 20) for (const match of query.match(/\b\d+\b/g) ?? []) terms.push(sql`${issues.sequenceId} = ${Number(match)}`)
  return sql`(${sql.join(terms, sql` or `)})`
}
