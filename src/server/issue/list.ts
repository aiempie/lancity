import { sql, type SQL } from 'drizzle-orm'
import { ServiceError } from '@/server/common/errors'
import { requireWorkspaceBySlug, visibleIssueSql } from '@/server/issue/access'
import {
  ISSUE_ANNOTATIONS,
  ISSUE_LIST_SELECT,
  PUBLIC_ISSUE_LIST_SELECT,
  groupKey,
  groupSpec,
  issueFilters,
  issueGroupValues,
  issueOnResults,
  orderIssueQueryset,
  searchIssues
} from '@/server/issue/filter'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { IssueGroupingOptions, IssueListQuery } from '@/types/issue/schema'

/** `issues` rows an `IssueManager` returns: not deleted, archived, draft or triage, in a project that is not archived (PD-1417). */
/** A sub-issue disappears with its deleted parent before the background cascade has soft deleted it (`on_delete=CASCADE`). */
const PARENT_NOT_DELETED = sql`(issues.parent_id is null or not exists (select 1 from issues dp where dp.id = issues.parent_id and dp.deleted_at is not null))`
export const LIVE_ISSUES = sql`issues.deleted_at is null and issues.archived_at is null and issues.is_draft = 0
  and ${PARENT_NOT_DELETED}
  and not exists (select 1 from states ts where ts.id = issues.state_id and ts."group" = 'triage')
  and not exists (select 1 from projects ap where ap.id = issues.project_id and ap.archived_at is not null)`
/** Archived issues that are not epics (`IssueArchiveViewSet.get_queryset`, PD-0561). */
export const ARCHIVED_ISSUES = sql`issues.deleted_at is null and issues.archived_at is not null and ${PARENT_NOT_DELETED}
  and (issues.type_id is null or not exists (select 1 from issue_types it where it.id = issues.type_id and it.is_epic = 1))`

export type IssueListMode = 'live' | 'archived'
export type IssueListContext = {
  actor: Actor
  slug: string
  projectId: number
  workspaceId: number
  /** Restricted guests only see what they created. */
  ownOnly: boolean
}

export async function issueListContext(db: LancityDb, actor: Actor, slug: string, projectId: number, minimumRole: 5 | 15 | 20 = 5) {
  const { workspace, project, membership, workspaceMembership } = await requireProjectAccess(db, actor, slug, projectId, minimumRole)
  const ownOnly = membership.role === 5 && workspaceMembership.role !== 20 && !project.guestViewAllFeatures
  return { actor, slug, projectId, workspaceId: workspace.id, ownOnly } satisfies IssueListContext
}

/** Port of `get_per_page` and cursor parsing from `BasePaginator.paginate` (PD-2021). Cursor format: `perPage:page:isPrev`. */
export function parsePagination(query: IssueListQuery, defaultPerPage = 1000, maxPerPage = 1000) {
  const raw = query.per_page ?? String(defaultPerPage)
  if (!/^-?\d+$/.test(raw)) throw new ServiceError(400, 'INVALID_PER_PAGE', 'Invalid per_page parameter.')
  const limit = Number(raw)
  if (limit <= 0) throw new ServiceError(400, 'INVALID_PER_PAGE', 'Invalid per_page value. Must be greater than zero.')
  if (limit > Math.max(maxPerPage, defaultPerPage))
    throw new ServiceError(400, 'INVALID_PER_PAGE', `Invalid per_page value. Cannot exceed ${maxPerPage}.`)
  const match = /^(\d+(?:\.\d+)?):(\d+):([01])$/.exec(query.cursor ?? `${limit}:0:0`)
  if (!match || Number(match[1]) > Math.max(maxPerPage, defaultPerPage))
    throw new ServiceError(400, 'INVALID_CURSOR', 'Invalid cursor parameter.')
  return { limit, page: Number(match[2]) }
}

export type PageEnvelopeInput = {
  groupedBy: string | null
  subGroupedBy: string | null
  total: number
  limit: number
  page: number
  hasNext: boolean
  count: number
  totalPages: number
  results: unknown
  extraStats?: unknown
}
/** Response envelope of `BasePaginator.paginate`. */
export function pageEnvelope(input: PageEnvelopeInput) {
  return {
    grouped_by: input.groupedBy,
    sub_grouped_by: input.subGroupedBy,
    total_count: input.total,
    next_cursor: `${input.limit}:${input.page + 1}:0`,
    prev_cursor: `${input.limit}:${input.page - 1}:1`,
    next_page_results: input.hasNext,
    prev_page_results: input.page > 0,
    count: input.count,
    total_pages: input.totalPages,
    total_results: input.total,
    extra_stats: input.extraStats ?? null,
    results: input.results
  }
}

/** Build the WHERE predicate of a list: scope, guest restriction, query filters and `updated_at__gt`. */
export function listWhere(ctx: IssueListContext, query: IssueListQuery, mode: IssueListMode = 'live', extra: SQL[] = []) {
  const conds: SQL[] = [
    sql`issues.project_id = ${ctx.projectId} and issues.workspace_id = ${ctx.workspaceId}`,
    mode === 'live' ? LIVE_ISSUES : ARCHIVED_ISSUES,
    ...extra
  ]
  if (ctx.ownOnly) conds.push(sql`issues.created_by_id = ${ctx.actor.userId}`)
  const after = query.updated_at__gt
  if (after) {
    const time = Date.parse(after)
    if (Number.isNaN(time)) throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid updated_at__gt')
    conds.push(sql`issues.updated_at > ${time}`)
  }
  conds.push(...issueFilters(query, 'GET'))
  return sql.join(
    conds.map(cond => sql`(${cond})`),
    sql` and `
  )
}

async function scalar(db: LancityDb, query: SQL) {
  const [row] = await db.all<{ n: number }>(query)
  return Number(row?.n ?? 0)
}

/**
 * Port of the grouped, sub-grouped and flat branches of `IssueViewSet.list` and `IssueArchiveViewSet.list`
 * (PD-0582, PD-0562, PD-0563 to PD-0565). Groups are paginated independently: each group returns its own page.
 */
export async function paginateIssues(
  db: LancityDb,
  ctx: IssueListContext,
  query: IssueListQuery,
  mode: IssueListMode = 'live',
  options: IssueGroupingOptions = {}
) {
  const { publicBoard = false } = options
  const { limit, page } = parsePagination(query)
  const offset = page * limit
  const groupBy = query.group_by || null
  const subGroupBy = groupBy ? query.sub_group_by || null : null
  if (groupBy && groupBy === subGroupBy)
    throw new ServiceError(400, 'INVALID_GROUP_BY', 'Group by and sub group by cannot have same parameters')
  const extra: SQL[] = []
  if (mode === 'archived' && query.show_sub_issues === 'false') extra.push(sql`issues.parent_id is null`)
  const where = listWhere(ctx, query, mode, extra)
  const order = orderIssueQueryset(query.order_by)
  const select = publicBoard ? PUBLIC_ISSUE_LIST_SELECT : ISSUE_LIST_SELECT

  if (!groupBy) {
    const total = await scalar(db, sql`select count(*) as n from issues where ${where}`)
    const rows = await db.all<Record<string, unknown>>(
      sql`select ${select} from issues where ${where} order by ${order.orderBy} limit ${limit + 1} offset ${offset}`
    )
    return pageEnvelope({
      groupedBy: null,
      subGroupedBy: null,
      total,
      limit,
      page,
      hasNext: rows.length > limit,
      count: Math.min(rows.length, limit),
      totalPages: Math.ceil(total / limit),
      results: issueOnResults(rows.slice(0, limit))
    })
  }

  const group = groupSpec(groupBy, 'gg', publicBoard)
  const sub = subGroupBy ? groupSpec(subGroupBy, 'sg', publicBoard) : null
  const joins = sql.raw([group.join, sub?.join].filter(Boolean).join(' '))
  const partition = sub ? sql`${group.expr}, ${sub.expr}` : group.expr
  const subSelect = sub ? sql`, ${sub.expr} as __sg` : sql``
  const inner = sql`select ${select}, ${group.expr} as __g${subSelect},
    row_number() over (partition by ${partition} order by ${order.orderBy}) as __rn
    from issues ${joins} where ${where}`
  const [rows, hasNext, total, groupTotals, subTotals] = await Promise.all([
    db.all<Record<string, unknown>>(sql`select * from (${inner}) where __rn > ${offset} and __rn <= ${offset + limit} order by __rn`),
    scalar(db, sql`select 1 as n from (${inner}) where __rn > ${offset + limit} limit 1`),
    scalar(db, sql`select count(*) as n from (select issues.id from issues ${joins} where ${where})`),
    db.all<{ g: unknown; n: number }>(
      sql`select ${group.expr} as g, count(distinct issues.id) as n from issues ${joins} where ${where} group by ${group.expr}`
    ),
    sub
      ? db.all<{ g: unknown; s: unknown; n: number }>(
          sql`select ${group.expr} as g, ${sub.expr} as s, count(distinct issues.id) as n from issues ${joins} where ${where} group by ${group.expr}, ${sub.expr}`
        )
      : Promise.resolve([])
  ])
  const groupValues = await issueGroupValues(db, groupBy, ctx.slug, ctx.projectId, where, { publicBoard })
  const groupTotal = new Map(groupTotals.map(row => [groupKey(row.g), Number(row.n)]))
  const maxGroup = Math.max(0, ...groupTotal.values())
  const items = issueOnResults(rows)
  const keyed = rows.map((row, index) => ({ g: groupKey(row.__g), s: groupKey(row.__sg), item: items[index] }))

  const results: Record<string, { results: unknown; total_results: number }> = {}
  if (!sub) {
    for (const value of groupValues) results[value] = { results: [], total_results: groupTotal.get(value) ?? 0 }
    for (const { g, item } of keyed) {
      if (!results[g] && !group.multi) continue
      results[g] ??= { results: [], total_results: groupTotal.get(g) ?? 0 }
      ;(results[g].results as unknown[]).push(item)
    }
  } else {
    for (const row of subTotals) {
      const g = groupKey(row.g)
      results[g] ??= { results: {}, total_results: groupTotal.get(g) ?? 0 }
      ;(results[g].results as Record<string, unknown>)[groupKey(row.s)] = { results: [], total_results: Number(row.n) }
    }
    for (const { g, s, item } of keyed) {
      const bucket = (results[g]?.results as Record<string, { results: unknown[] }> | undefined)?.[s]
      bucket?.results.push(item)
    }
  }
  return pageEnvelope({
    groupedBy: groupBy,
    subGroupedBy: subGroupBy,
    total,
    limit,
    page,
    hasNext: hasNext > 0,
    count: rows.length,
    totalPages: rows.length ? Math.ceil(maxGroup / limit) : 0,
    results
  })
}

/**
 * Port of `IssuePaginatedViewSet.list` (PD-0594 to PD-0597): oldest update first, optional `updated_at__gt`,
 * `description=true` adds the HTML body. The cursor makes it suitable for incremental sync.
 */
export async function listIssuesPaginated(db: LancityDb, actor: Actor, slug: string, projectId: number, query: IssueListQuery) {
  const ctx = await issueListContext(db, actor, slug, projectId)
  const { limit, page } = parsePagination(query)
  const where = listWhere(ctx, { updated_at__gt: query.updated_at__gt ?? '' })
  const description = String(query.description ?? 'false').toLowerCase() === 'true' ? sql`, issues.description_html` : sql``
  const total = await scalar(db, sql`select count(*) as n from issues where ${where}`)
  const rows = await db.all<Record<string, unknown>>(
    sql`select ${ISSUE_LIST_SELECT}${description} from issues where ${where} order by issues.updated_at asc, issues.id asc limit ${limit + 1} offset ${page * limit}`
  )
  return pageEnvelope({
    groupedBy: null,
    subGroupedBy: null,
    total,
    limit,
    page,
    hasNext: rows.length > limit,
    count: Math.min(rows.length, limit),
    totalPages: Math.ceil(total / limit),
    results: issueOnResults(rows.slice(0, limit))
  })
}

/** Port of `IssueListEndpoint.get` (PD-0577): the issues named in `?issues=1,2,3` with the standard filters. */
export async function getIssueList(db: LancityDb, actor: Actor, slug: string, projectId: number, query: IssueListQuery) {
  const ids = (query.issues ?? '')
    .split(',')
    .filter(Boolean)
    .map(Number)
    .filter(id => Number.isInteger(id) && id > 0)
  if (!ids.length) throw new ServiceError(400, 'ISSUES_REQUIRED', 'Issues are required')
  const ctx = await issueListContext(db, actor, slug, projectId)
  const where = listWhere(ctx, query, 'live', [sql`issues.id in (select value from json_each(${JSON.stringify(ids)}))`])
  const order = orderIssueQueryset(query.order_by)
  const rows = await db.all<Record<string, unknown>>(
    sql`select ${ISSUE_LIST_SELECT} from issues where ${where} order by ${order.orderBy}`
  )
  return issueOnResults(rows)
}

/** `IssueDetailEndpoint.get` for `?issues=` batches shares the filters of the list (PD-0599, PD-0600). */
export const getIssueDetail = getIssueList

/**
 * Port of `IssueViewSet.retrieve` (PD-0587): the issue plus its related ids, counters and the actor's subscription.
 * Includes archived issues, like `Issue.objects`. Restricted guests get 404 for issues they did not create.
 */
export async function retrieveIssueDetail(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  where: SQL
): Promise<Record<string, unknown>> {
  const ctx = await issueListContext(db, actor, slug, projectId)
  const own = ctx.ownOnly ? sql`and issues.created_by_id = ${actor.userId}` : sql``
  const [row] = await db.all<Record<string, unknown>>(sql`select issues.*, ${ISSUE_ANNOTATIONS},
    exists (select 1 from issue_subscribers sub where sub.issue_id = issues.id and sub.subscriber_id = ${actor.userId} and sub.deleted_at is null) as is_subscribed,
    exists (select 1 from intake_issues ii where ii.issue_id = issues.id and ii.deleted_at is null and ii.status in (-2, 0)) as is_intake
    from issues where issues.project_id = ${projectId} and issues.workspace_id = ${ctx.workspaceId} and issues.deleted_at is null
      and (${where}) ${own} limit 1`)
  if (!row) throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'The required object does not exist.')
  const [detail] = issueOnResults([{ ...row, created_by: row.created_by_id, updated_by: row.updated_by_id }])
  for (const key of ['description_binary', 'descriptionBinary']) delete detail[key]
  if (typeof detail.descriptionJson === 'string') detail.descriptionJson = JSON.parse(detail.descriptionJson)
  detail.isSubscribed = Boolean(row.is_subscribed)
  detail.isIntake = Boolean(row.is_intake)
  return detail
}

export function getIssueById(db: LancityDb, actor: Actor, slug: string, projectId: number, issueId: number) {
  return retrieveIssueDetail(db, actor, slug, projectId, sql`issues.id = ${issueId}`)
}

/** Port of `strict_str_to_int` (PD-0604): optional minus sign followed by digits only. */
export function strictStrToInt(value: string): number {
  if (!/^-?\d+$/.test(value)) throw new ServiceError(400, 'INVALID_IDENTIFIER', 'Invalid issue identifier')
  return Number(value)
}

/**
 * Port of `IssueDetailIdentifierEndpoint.get` (PD-0605) and `WorkspaceIssueAPIEndpoint.get` (PD-0142):
 * `<PROJECT>-<sequence>` inside a workspace. Non-members receive 403. `strict` makes a non-numeric sequence a 400
 * (app API); the public API answers 404 instead.
 */
export async function getIssueByIdentifier(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectIdentifier: string,
  issueIdentifier: string,
  strict = true
) {
  if (!strict && !/^\d+$/.test(issueIdentifier)) throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Work item not found')
  const sequence = strictStrToInt(issueIdentifier)
  const [project] = await db.all<{ id: number }>(sql`select p.id from projects p join workspaces w on w.id = p.workspace_id
    where w.slug = ${slug} and lower(p.identifier) = lower(${projectIdentifier}) and p.deleted_at is null and w.deleted_at is null limit 1`)
  if (!project) throw new ServiceError(404, 'PROJECT_NOT_FOUND', 'Project not found')
  const [member] = await db.all<{ one: number }>(sql`select 1 as one from project_members where project_id = ${project.id}
    and member_id = ${actor.userId} and is_active = 1 and deleted_at is null limit 1`)
  if (!member) throw new ServiceError(403, 'FORBIDDEN', 'You are not allowed to view this issue')
  const detail = await retrieveIssueDetail(db, actor, slug, project.id, sql`issues.sequence_id = ${sequence}`)
  return detail
}

/** Port of `IssueMetaEndpoint.get` (PD-0603). */
export async function getIssueMeta(db: LancityDb, actor: Actor, slug: string, projectId: number, issueId: number) {
  const ctx = await issueListContext(db, actor, slug, projectId)
  const own = ctx.ownOnly ? sql`and issues.created_by_id = ${actor.userId}` : sql``
  const [row] = await db.all<{ sequence_id: number; identifier: string }>(sql`select issues.sequence_id, p.identifier
    from issues join projects p on p.id = issues.project_id
    where issues.id = ${issueId} and issues.project_id = ${projectId} and issues.workspace_id = ${ctx.workspaceId}
      and ${LIVE_ISSUES} ${own}`)
  if (!row) throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Issue not found')
  return { sequenceId: row.sequence_id, projectIdentifier: row.identifier }
}

/**
 * Port of `DeletedIssuesListViewSet.get` (PD-0593): ids of archived or deleted issues, so clients can drop them
 * from an offline cache. `updated_at__gt` limits it to recent changes.
 */
export async function deletedIssuesList(db: LancityDb, actor: Actor, slug: string, projectId: number, query: IssueListQuery) {
  const ctx = await issueListContext(db, actor, slug, projectId)
  const after = query.updated_at__gt ? Date.parse(query.updated_at__gt) : null
  if (after !== null && Number.isNaN(after)) throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid updated_at__gt')
  const rows = await db.all<{ id: number }>(sql`select issues.id from issues
    where issues.project_id = ${projectId} and issues.workspace_id = ${ctx.workspaceId}
      and (issues.archived_at is not null or issues.deleted_at is not null)
      ${after === null ? sql`` : sql`and issues.updated_at > ${after}`} order by issues.id`)
  return rows.map(row => row.id)
}

/**
 * Port of `IssueSearchEndpoint.get` (PD-0185): search work items of the workspace by name, project identifier or
 * sequence number. Only issues the actor may see are returned. `project_id` narrows the search unless
 * `workspace_search=true`.
 */
export async function searchWorkspaceIssues(db: LancityDb, actor: Actor, slug: string, query: IssueListQuery) {
  const { workspace } = await requireWorkspaceBySlug(db, actor, slug)
  const term = query.search
  if (!term) return { issues: [] }
  const limit = Math.min(Math.max(Number.parseInt(query.limit ?? '10', 10) || 10, 1), 100)
  const projectId = query.workspace_search !== 'true' && /^[1-9]\d*$/.test(query.project_id ?? '') ? Number(query.project_id) : null
  const rows = await db.all<{
    name: string
    id: number
    sequence_id: number
    identifier: string
    project_id: number
  }>(sql`select issues.name, issues.id, issues.sequence_id, p.identifier, issues.project_id
    from issues join projects p on p.id = issues.project_id
    where issues.workspace_id = ${workspace.id} and ${LIVE_ISSUES} and ${searchIssues(term)} and ${visibleIssueSql(actor.userId)}
      ${projectId === null ? sql`` : sql`and issues.project_id = ${projectId}`}
    order by issues.id desc limit ${limit}`)
  return {
    issues: rows.map(row => ({
      name: row.name,
      id: row.id,
      sequenceId: row.sequence_id,
      projectIdentifier: row.identifier,
      projectId: row.project_id,
      workspaceSlug: slug
    }))
  }
}
