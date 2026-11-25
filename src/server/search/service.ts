import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm'
import { issues } from '@/db/schema/issue'
import { projectMembers, projects } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import { containsFolded, searchValue } from '@/server/common/unicode'
import { visibleIssueSql } from '@/server/issue/access'
import { searchIssues } from '@/server/issue/filter'
import { LIVE_ISSUES } from '@/server/issue/list'
import { requireReportingWorkspace } from '@/server/notification/service'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import {
  ENTITY_SEARCH_TYPES,
  GLOBAL_SEARCH_ENTITIES,
  type EntitySearchQuery,
  type GlobalSearchEntity,
  type GlobalSearchQuery
} from '@/types/reporting/p3-view-schema'

function issueNameMatches(query: string) {
  return containsFolded(sql`${issues.name}`, query, searchValue('issues', 'name', sql`${issues.id}`))
}
export async function searchProjectIssues(db: LancityDb, actor: Actor, slug: string, projectId: number, query: string) {
  const { workspace, project, membership, workspaceMembership } = await requireProjectAccess(db, actor, slug, projectId)
  const restricted = membership.role === 5 && workspaceMembership.role !== 20 && !project.guestViewAllFeatures
  return db
    .select({
      id: issues.id,
      name: issues.name,
      sequenceId: issues.sequenceId,
      projectId: issues.projectId,
      priority: issues.priority,
      stateId: issues.stateId
    })
    .from(issues)
    .where(
      and(
        eq(issues.workspaceId, workspace.id),
        eq(issues.projectId, projectId),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt),
        eq(issues.isDraft, false),
        restricted ? eq(issues.createdById, actor.userId) : undefined,
        issueNameMatches(query)
      )
    )
    .limit(50)
}
export async function searchWorkspaceIssues(db: LancityDb, actor: Actor, slug: string, query: string) {
  const { workspace } = await requireReportingWorkspace(db, actor, slug)
  return db
    .select({
      id: issues.id,
      name: issues.name,
      sequenceId: issues.sequenceId,
      projectId: issues.projectId,
      priority: issues.priority,
      stateId: issues.stateId
    })
    .from(issues)
    .innerJoin(projects, and(eq(projects.id, issues.projectId), eq(projects.workspaceId, workspace.id)))
    .innerJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, projects.id),
        eq(projectMembers.workspaceId, workspace.id),
        eq(projectMembers.memberId, actor.userId)
      )
    )
    .where(
      and(
        eq(issues.workspaceId, workspace.id),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt),
        eq(issues.isDraft, false),
        isNull(projects.deletedAt),
        isNull(projects.archivedAt),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt),
        or(
          eq(projectMembers.role, 15),
          eq(projectMembers.role, 20),
          eq(projects.guestViewAllFeatures, true),
          eq(issues.createdById, actor.userId)
        ),
        issueNameMatches(query)
      )
    )
    .limit(50)
}

/* ------------------------------ global search ------------------------------ */

type SearchContext = {
  db: LancityDb
  userId: number
  workspaceId: number
  slug: string
  query: string | null
  projectId: number | null
}
const RESULT_LIMIT = 100

/** Case-insensitive `icontains` of a searched entity field. */
const searchFields: Record<string, [string, string, string]> = {
  'w.name': ['workspaces', 'name', 'w.id'],
  'p.name': ['projects', 'name', 'p.id'],
  'p.identifier': ['projects', 'identifier', 'p.id'],
  'pg.name': ['pages', 'name', 'pg.id'],
  'pf.first_name': ['profiles', 'first_name', 'pf.id'],
  'pf.last_name': ['profiles', 'last_name', 'pf.id'],
  'u.username': ['user', 'username', 'u.id'],
  'u.name': ['user', 'name', 'u.id']
}
const contains = (column: string, query: string, entityTable?: string): SQL => {
  if (column === 'coalesce(u.username, u.name)') {
    return sql`(case when u.username is null then ${contains('u.name', query)} else ${contains('u.username', query)} end)`
  }
  const [table, field, id] = column === 'e.name' ? [entityTable!, 'name', 'e.id'] : searchFields[column]
  return containsFolded(sql.raw(column), query, searchValue(table, field, sql.raw(id)))
}
const anyContains = (columns: string[], query: string | null, entityTable?: string): SQL | undefined =>
  query
    ? sql`(${sql.join(columns.map(column => contains(column, query, entityTable)), sql` or `)})`
    : undefined
const allOf = (conds: (SQL | undefined)[]): SQL =>
  sql.join(
    conds.filter((cond): cond is SQL => Boolean(cond)).map(cond => sql`(${cond})`),
    sql` and `
  )
const inProject = (projectColumn: string, userId: number): SQL =>
  sql`exists (select 1 from project_members pm where pm.project_id = ${sql.raw(projectColumn)} and pm.member_id = ${userId}
    and pm.is_active = 1 and pm.deleted_at is null)`
const parseJson = (value: unknown) => (typeof value === 'string' ? (JSON.parse(value) as unknown) : value)
/** Optional `project_id` narrowing of a column, used unless `workspace_search=true`. */
const inScope = (ctx: SearchContext, column: string): SQL | undefined =>
  ctx.projectId === null ? undefined : sql`${sql.raw(column)} = ${ctx.projectId}`

/** PD-0781 `filter_workspaces`: workspaces the actor belongs to. */
export async function filterWorkspacesGlobalSearch(ctx: SearchContext) {
  const rows = await ctx.db.all<{
    name: string
    id: number
    slug: string
  }>(sql`select w.name, w.id, w.slug from workspaces w
    where ${allOf([
      sql`w.deleted_at is null`,
      sql`exists (select 1 from workspace_members wm where wm.workspace_id = w.id and wm.member_id = ${ctx.userId} and wm.is_active = 1 and wm.deleted_at is null)`,
      anyContains(['w.name'], ctx.query)
    ])} order by w.created_at desc, w.id desc limit ${RESULT_LIMIT}`)
  return rows
}

/** PD-0782 `filter_projects`: active, non-archived projects the actor is a member of. */
export async function filterProjectsGlobalSearch(ctx: SearchContext) {
  const rows = await ctx.db.all<{
    name: string
    id: number
    identifier: string
  }>(sql`select p.name, p.id, p.identifier from projects p
    where ${allOf([
      sql`p.workspace_id = ${ctx.workspaceId} and p.deleted_at is null and p.archived_at is null`,
      inProject('p.id', ctx.userId),
      anyContains(['p.name', 'p.identifier'], ctx.query)
    ])} order by p.created_at desc, p.id desc limit ${RESULT_LIMIT}`)
  return rows.map(row => ({ ...row, workspaceSlug: ctx.slug }))
}

const issueRow = (ctx: SearchContext, row: Record<string, unknown>) => ({
  name: row.name,
  id: row.id,
  sequenceId: row.sequence_id,
  projectIdentifier: row.identifier,
  projectId: row.project_id,
  workspaceSlug: ctx.slug
})

/** PD-0783 `filter_issues`: issues by name, project identifier or sequence number, guests limited to their own. */
export async function filterIssuesGlobalSearch(ctx: SearchContext) {
  const rows = await ctx.db.all<
    Record<string, unknown>
  >(sql`select issues.name, issues.id, issues.sequence_id, p.identifier, issues.project_id
    from issues join projects p on p.id = issues.project_id
    where ${allOf([
      sql`issues.workspace_id = ${ctx.workspaceId}`,
      LIVE_ISSUES,
      visibleIssueSql(ctx.userId),
      ctx.query ? searchIssues(ctx.query) : undefined,
      inScope(ctx, 'issues.project_id')
    ])} order by issues.created_at desc, issues.id desc limit ${RESULT_LIMIT}`)
  return rows.map(row => issueRow(ctx, row))
}

async function filterProjectEntities(ctx: SearchContext, table: 'cycles' | 'modules' | 'issue_views', extra?: SQL) {
  const rows = await ctx.db.all<Record<string, unknown>>(sql`select e.name, e.id, e.project_id, p.identifier
    from ${sql.raw(table)} e join projects p on p.id = e.project_id
    where ${allOf([
      sql`e.workspace_id = ${ctx.workspaceId} and e.deleted_at is null and p.deleted_at is null and p.archived_at is null`,
      inProject('e.project_id', ctx.userId),
      anyContains(['e.name'], ctx.query, table),
      inScope(ctx, 'e.project_id'),
      extra
    ])} order by e.created_at desc, e.id desc limit ${RESULT_LIMIT}`)
  return rows.map(row => ({
    name: row.name,
    id: row.id,
    projectId: row.project_id,
    projectIdentifier: row.identifier,
    workspaceSlug: ctx.slug
  }))
}

/** PD-0784 `filter_cycles`. */
export const filterCyclesGlobalSearch = (ctx: SearchContext) => filterProjectEntities(ctx, 'cycles')
/** PD-0785 `filter_modules`. */
export const filterModulesGlobalSearch = (ctx: SearchContext) => filterProjectEntities(ctx, 'modules')

/**
 * PD-0787 `filter_views`: guests only see views they own unless the project shares all features, and private
 * views are owner-only.
 */
export const filterViewsGlobalSearch = (ctx: SearchContext) =>
  filterProjectEntities(
    ctx,
    'issue_views',
    sql`(e.owned_by_id = ${ctx.userId} or e.access = 1) and (p.guest_view_all_features = 1 or e.owned_by_id = ${ctx.userId}
      or exists (select 1 from project_members gm where gm.project_id = p.id and gm.member_id = ${ctx.userId} and gm.is_active = 1
        and gm.deleted_at is null and gm.role > 5))`
  )

/** PD-0786 `filter_pages`: public pages and the actor's own, with the projects each page belongs to. */
export async function filterPagesGlobalSearch(ctx: SearchContext) {
  const rows = await ctx.db.all<
    Record<string, unknown>
  >(sql`select pg.name, pg.id, json_group_array(pr.id) as project_ids,
      json_group_array(pr.identifier) as project_identifiers
    from pages pg
    join project_pages pp on pp.page_id = pg.id and pp.deleted_at is null
    join projects pr on pr.id = pp.project_id and pr.deleted_at is null and pr.archived_at is null
    join project_members pm on pm.project_id = pr.id and pm.member_id = ${ctx.userId} and pm.is_active = 1 and pm.deleted_at is null
    where ${allOf([
      sql`pg.workspace_id = ${ctx.workspaceId} and pg.deleted_at is null`,
      sql`pm.role > 5 or pr.guest_view_all_features = 1 or pg.owned_by_id = ${ctx.userId}`,
      sql`pg.owned_by_id = ${ctx.userId} or pg.access = 0`,
      anyContains(['pg.name'], ctx.query),
      ctx.projectId === null
        ? undefined
        : sql`exists (select 1 from project_pages sp where sp.page_id = pg.id and sp.project_id = ${ctx.projectId} and sp.deleted_at is null)`
    ])}
    group by pg.id order by pg.created_at desc, pg.id desc limit ${RESULT_LIMIT}`)
  return rows.map(row => ({
    name: row.name,
    id: row.id,
    projectIds: parseJson(row.project_ids),
    projectIdentifiers: parseJson(row.project_identifiers),
    workspaceSlug: ctx.slug
  }))
}

/** PD-0788 `filter_intakes`: issues waiting in intake (pending or snoozed). */
export async function filterIntakesGlobalSearch(ctx: SearchContext) {
  const rows = await ctx.db.all<
    Record<string, unknown>
  >(sql`select issues.name, issues.id, issues.sequence_id, p.identifier, issues.project_id
    from issues join projects p on p.id = issues.project_id
    where ${allOf([
      sql`issues.workspace_id = ${ctx.workspaceId} and issues.deleted_at is null and p.deleted_at is null and p.archived_at is null`,
      visibleIssueSql(ctx.userId),
      sql`exists (select 1 from intake_issues ii where ii.issue_id = issues.id and ii.deleted_at is null and ii.status in (0, -2))`,
      ctx.query ? searchIssues(ctx.query) : undefined,
      inScope(ctx, 'issues.project_id')
    ])} order by issues.created_at desc, issues.id desc limit ${RESULT_LIMIT}`)
  return rows.map(row => issueRow(ctx, row))
}

const GLOBAL_SEARCH: Record<GlobalSearchEntity, (ctx: SearchContext) => Promise<unknown[]>> = {
  workspace: filterWorkspacesGlobalSearch,
  project: filterProjectsGlobalSearch,
  issue: filterIssuesGlobalSearch,
  cycle: filterCyclesGlobalSearch,
  module: filterModulesGlobalSearch,
  issue_view: filterViewsGlobalSearch,
  page: filterPagesGlobalSearch,
  intake: filterIntakesGlobalSearch
}

/** PD-0789 `GlobalSearchEndpoint.get`: `entities=a,b` narrows the entity types, unknown names are ignored. */
export async function getGlobalSearch(db: LancityDb, actor: Actor, slug: string, input: GlobalSearchQuery) {
  const { workspace } = await requireReportingWorkspace(db, actor, slug)
  const projectParam = input.project_id
  if (projectParam && !/^[1-9]\d{0,15}$/.test(projectParam))
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid project_id')
  const ctx: SearchContext = {
    db,
    userId: actor.userId,
    workspaceId: workspace.id,
    slug,
    query: input.search?.trim() || null,
    projectId: (input.workspace_search ?? 'false') === 'false' && projectParam ? Number(projectParam) : null
  }
  const requested = input.entities
    ? input.entities
        .split(',')
        .map(item => item.trim())
        .filter((item): item is GlobalSearchEntity => (GLOBAL_SEARCH_ENTITIES as readonly string[]).includes(item))
    : [...GLOBAL_SEARCH_ENTITIES]
  const entries = await Promise.all(requested.map(async entity => [entity, await GLOBAL_SEARCH[entity](ctx)] as const))
  return { results: Object.fromEntries(entries) }
}

/* ------------------------------- entity search ------------------------------ */

const NAME_FIELDS = ['pf.first_name', 'pf.last_name', 'coalesce(u.username, u.name)']

/** `user_mention` of `SearchEndpoint`: active, non-bot members of the project or workspace. */
async function searchUserMentions(ctx: SearchContext, count: number) {
  const scope =
    ctx.projectId === null
      ? sql`from workspace_members m where m.workspace_id = ${ctx.workspaceId}`
      : sql`from project_members m where m.workspace_id = ${ctx.workspaceId} and m.project_id = ${ctx.projectId}`
  const rows = await ctx.db.all<
    Record<string, unknown>
  >(sql`select u.id as id, coalesce(u.username, u.name) as display_name, u.image as avatar_url
    from (select m.member_id, m.created_at ${scope} and m.is_active = 1 and m.deleted_at is null) m
    join user u on u.id = m.member_id
    left join profiles pf on pf.user_id = u.id
    left join user_security us on us.user_id = u.id
    where ${allOf([sql`coalesce(us.is_bot, 0) = 0`, anyContains(NAME_FIELDS, ctx.query)])}
    order by m.created_at desc, u.id desc limit ${count}`)
  return rows.map(row => ({ avatarUrl: row.avatar_url ?? null, displayName: row.display_name, id: row.id }))
}

/** Projects the caller may find: their own, plus public ones unless they are a workspace guest. */
const accessibleProjects = (ctx: SearchContext): SQL =>
  sql`(${inProject('p.id', ctx.userId)} or (p.network = 2 and exists (select 1 from workspace_members wm
    where wm.workspace_id = ${ctx.workspaceId} and wm.member_id = ${ctx.userId} and wm.is_active = 1 and wm.deleted_at is null and wm.role > 5)))`

async function searchEntityProjects(ctx: SearchContext, count: number) {
  const rows = await ctx.db.all<
    Record<string, unknown>
  >(sql`select p.name, p.id, p.identifier, p.logo_props from projects p
    where ${allOf([
      sql`p.workspace_id = ${ctx.workspaceId} and p.deleted_at is null`,
      accessibleProjects(ctx),
      anyContains(['p.name', 'p.identifier'], ctx.query)
    ])} order by p.created_at desc, p.id desc limit ${count}`)
  return rows.map(row => ({
    name: row.name,
    id: row.id,
    identifier: row.identifier,
    logoProps: parseJson(row.logo_props),
    workspaceSlug: ctx.slug
  }))
}

async function searchEntityIssues(ctx: SearchContext, count: number) {
  const rows = await ctx.db.all<
    Record<string, unknown>
  >(sql`select issues.name, issues.id, issues.sequence_id, p.identifier,
      issues.project_id, issues.priority, issues.state_id, issues.type_id
    from issues join projects p on p.id = issues.project_id
    where ${allOf([
      sql`issues.workspace_id = ${ctx.workspaceId}`,
      LIVE_ISSUES,
      visibleIssueSql(ctx.userId),
      ctx.query ? searchIssues(ctx.query) : undefined,
      inScope(ctx, 'issues.project_id')
    ])} order by issues.created_at desc, issues.id desc limit ${count}`)
  return rows.map(row => ({
    name: row.name,
    id: row.id,
    sequenceId: row.sequence_id,
    projectIdentifier: row.identifier,
    projectId: row.project_id,
    priority: row.priority,
    stateId: row.state_id,
    typeId: row.type_id
  }))
}

async function searchEntityPlanning(ctx: SearchContext, table: 'cycles' | 'modules', count: number) {
  const now = Date.now()
  const status =
    table === 'modules'
      ? sql`e.status`
      : sql`case when e.start_date <= ${now} and e.end_date >= ${now} then 'CURRENT'
          when e.start_date > ${now} then 'UPCOMING' when e.end_date < ${now} then 'COMPLETED' else 'DRAFT' end`
  const rows = await ctx.db.all<
    Record<string, unknown>
  >(sql`select e.name, e.id, e.project_id, p.identifier, ${status} as status
    from ${sql.raw(table)} e join projects p on p.id = e.project_id
    where ${allOf([
      sql`e.workspace_id = ${ctx.workspaceId} and e.deleted_at is null and p.deleted_at is null`,
      inProject('e.project_id', ctx.userId),
      anyContains(['e.name'], ctx.query, table),
      inScope(ctx, 'e.project_id')
    ])} order by e.created_at desc, e.id desc limit ${count}`)
  return rows.map(row => ({
    name: row.name,
    id: row.id,
    projectId: row.project_id,
    projectIdentifier: row.identifier,
    status: row.status,
    workspaceSlug: ctx.slug
  }))
}

async function searchEntityPages(ctx: SearchContext, count: number) {
  const rows = await ctx.db.all<
    Record<string, unknown>
  >(sql`select pg.name, pg.id, pg.logo_props, min(pr.id) as project_id
    from pages pg
    join project_pages pp on pp.page_id = pg.id and pp.deleted_at is null
    join projects pr on pr.id = pp.project_id and pr.deleted_at is null
    join project_members pm on pm.project_id = pr.id and pm.member_id = ${ctx.userId} and pm.is_active = 1 and pm.deleted_at is null
    where ${allOf([
      sql`pg.workspace_id = ${ctx.workspaceId} and pg.deleted_at is null and pg.access = 0`,
      sql`pm.role > 5 or pr.guest_view_all_features = 1 or pg.owned_by_id = ${ctx.userId}`,
      anyContains(['pg.name'], ctx.query),
      ctx.projectId === null ? sql`pg.is_global = 1` : sql`pr.id = ${ctx.projectId}`
    ])}
    group by pg.id order by pg.created_at desc, pg.id desc limit ${count}`)
  return rows.map(row => ({
    name: row.name,
    id: row.id,
    logoProps: parseJson(row.logo_props),
    projectId: row.project_id,
    workspaceSlug: ctx.slug
  }))
}

/**
 * PD-0790 `SearchEndpoint.get` (`entity-search`): mention and picker lookups. `query_type=a,b` picks the result sets,
 * `count` caps each (default 5). A project the actor is not a member of gives empty sets.
 */
export async function search(db: LancityDb, actor: Actor, slug: string, input: EntitySearchQuery) {
  const { workspace } = await requireReportingWorkspace(db, actor, slug)
  const types = (input.query_type ?? 'user_mention').split(',').map(item => item.trim())
  const countParam = input.count ?? '5'
  if (!/^\d{1,4}$/.test(countParam)) throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid count')
  const count = Math.min(Math.max(Number(countParam), 1), RESULT_LIMIT)
  if (input.project_id && !/^[1-9]\d{0,15}$/.test(input.project_id))
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid project_id')
  const projectId = input.project_id ? Number(input.project_id) : null
  const ctx: SearchContext = {
    db,
    userId: actor.userId,
    workspaceId: workspace.id,
    slug,
    query: input.query?.trim() || null,
    projectId
  }
  if (projectId !== null) {
    const [member] = await db.all<{
      n: number
    }>(sql`select 1 as n from project_members pm where pm.project_id = ${projectId}
      and pm.workspace_id = ${workspace.id} and pm.member_id = ${actor.userId} and pm.is_active = 1 and pm.deleted_at is null limit 1`)
    if (!member) return Object.fromEntries(types.map(type => [type, [] as unknown[]]))
  }
  const handlers: Record<(typeof ENTITY_SEARCH_TYPES)[number], () => Promise<unknown[]>> = {
    user_mention: () => searchUserMentions(ctx, count),
    project: () => searchEntityProjects(ctx, count),
    issue: () => searchEntityIssues(ctx, count),
    cycle: () => searchEntityPlanning(ctx, 'cycles', count),
    module: () => searchEntityPlanning(ctx, 'modules', count),
    page: () => searchEntityPages(ctx, count)
  }
  const known = types.filter((type): type is keyof typeof handlers => Object.hasOwn(handlers, type))
  const entries = await Promise.all(known.map(async type => [type, await handlers[type]()] as const))
  return Object.fromEntries(entries)
}
