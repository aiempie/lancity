import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { profiles } from '@/db/schema/identity'
import { workspaceUserProperties, workspaces } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import { sanitizeCsvRow } from '@/server/export/csv-utils'
import {
  getDefaultDisplayFilters,
  getDefaultDisplayProperties,
  getDefaultFilters
} from '@/server/workspace/model-rules'
import { pageEnvelope, pageWindow } from '@/server/workspace/pagination'
import { getWorkspace } from '@/server/workspace/service'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { UpdateWorkspaceUserProperties, WorkspaceUserIssuesQuery } from '@/types/workspace/schema'

type Row = Record<string, unknown>
const all = (db: LancityDb, query: SQL) => db.all<Row>(query)
const join = (parts: SQL[], separator = sql` and `) => sql.join(parts, separator)
const list = (values: (number | string)[]) =>
  sql.join(
    values.map(value => sql`${value}`),
    sql`, `
  )
const ints = (values: string[]) => values.map(Number).filter(value => Number.isInteger(value) && value > 0)
const today = () => new Date().toISOString().slice(0, 10)

/** Issue.issue_objects: not deleted, archived or draft, project not archived, not in the triage state group. */
export function issueObjectsQ(alias = 'i'): SQL {
  const a = sql.raw(alias)
  return sql`${a}.deleted_at is null and ${a}.archived_at is null and ${a}.is_draft = 0
    and not exists (select 1 from projects ap where ap.id = ${a}.project_id and (ap.archived_at is not null or ap.deleted_at is not null))
    and not exists (select 1 from states ast where ast.id = ${a}.state_id and ast."group" = 'triage')`
}

/**
 * _visible_issues_q: issues in projects where the user is an active member. Guests only see the issues they
 * created unless the project enables guest_view_all_features.
 */
export function visibleIssuesQ(userId: number, alias = 'i'): SQL {
  const a = sql.raw(alias)
  return sql`exists (select 1 from project_members vpm join projects vpr on vpr.id = vpm.project_id
    where vpm.project_id = ${a}.project_id and vpm.member_id = ${userId} and vpm.is_active = 1 and vpm.deleted_at is null
      and (vpm.role > 5 or vpr.guest_view_all_features = 1 or ${a}.created_by_id = ${userId}))`
}

const assignedQ = (userId: number, alias = 'i'): SQL =>
  sql`exists (select 1 from issue_assignees ia where ia.issue_id = ${sql.raw(alias)}.id and ia.assignee_id = ${userId} and ia.deleted_at is null)`

/** plane.utils.issue_filters.date_filter (relative `N_weeks;after;fromnow` forms are supported too). */
function dateConditions(column: SQL, values: string[] | undefined): SQL[] {
  const out: SQL[] = []
  for (const value of values ?? []) {
    const bits = value.split(';')
    const relative = /^(\d+)_(weeks|months)$/.exec(bits[0] ?? '')
    if (bits.length >= 2 && relative) {
      if (bits.length !== 3) continue
      const days = Number(relative[1]) * (relative[2] === 'months' ? 30 : 7) * (bits[2] === 'fromnow' ? 1 : -1)
      const date = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
      out.push(bits[1] === 'after' ? sql`${column} >= ${date}` : sql`${column} <= ${date}`)
    } else if (bits.length >= 2)
      out.push(bits.includes('after') ? sql`${column} >= ${bits[0]}` : sql`${column} <= ${bits[0]}`)
    else out.push(sql`${column} like ${`%${bits[0]}%`}`)
  }
  return out
}

/** Subset of plane.utils.issue_filters.issue_filters on the issue alias. */
function issueFilterQ(query: Partial<WorkspaceUserIssuesQuery>, alias = 'i'): SQL[] {
  const a = sql.raw(alias)
  const out: SQL[] = []
  if (query.priority?.length) out.push(sql`${a}.priority in (${list(query.priority)})`)
  const states = ints(query.state ?? [])
  if (states.length) out.push(sql`${a}.state_id in (${list(states)})`)
  if (query.state_group?.length)
    out.push(
      sql`exists (select 1 from states fs where fs.id = ${a}.state_id and fs."group" in (${list(query.state_group)}))`
    )
  const projectIds = ints(query.project ?? [])
  if (projectIds.length) out.push(sql`${a}.project_id in (${list(projectIds)})`)
  const labelIds = ints(query.labels ?? [])
  if (labelIds.length)
    out.push(
      sql`exists (select 1 from issue_labels fl where fl.issue_id = ${a}.id and fl.deleted_at is null and fl.label_id in (${list(labelIds)}))`
    )
  const assigneeIds = ints(query.assignees ?? [])
  if (assigneeIds.length)
    out.push(
      sql`exists (select 1 from issue_assignees fa where fa.issue_id = ${a}.id and fa.deleted_at is null and fa.assignee_id in (${list(assigneeIds)}))`
    )
  const creators = ints(query.created_by ?? [])
  if (creators.length) out.push(sql`${a}.created_by_id in (${list(creators)})`)
  out.push(
    ...dateConditions(sql`${a}.start_date`, query.start_date),
    ...dateConditions(sql`${a}.target_date`, query.target_date)
  )
  return out
}

const ISSUE_ORDER: Record<string, SQL> = {
  created_at: sql`i.created_at`,
  updated_at: sql`i.updated_at`,
  sequence_id: sql`i.sequence_id`,
  sort_order: sql`i.sort_order`,
  target_date: sql`i.target_date`,
  start_date: sql`i.start_date`,
  completed_at: sql`i.completed_at`,
  archived_at: sql`i.archived_at`,
  priority: sql`case i.priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end`,
  state__name: sql`(select s.name from states s where s.id = i.state_id)`,
  state__group: sql`(select s."group" from states s where s.id = i.state_id)`
}
/** sanitize_order_by + order_issue_queryset: allow-listed field, nulls last, newest first as tie-break. */
function orderQ(orderBy: string): SQL {
  const key = orderBy.replace(/^-/, '')
  const known = key in ISSUE_ORDER
  const field = known ? ISSUE_ORDER[key] : ISSUE_ORDER.created_at
  const desc = known ? orderBy.startsWith('-') : true
  return sql`${field} is null, ${field} ${desc ? sql`desc` : sql`asc`}, i.created_at desc, i.id desc`
}

/** UserLastProjectWithWorkspaceEndpoint.get. */
export async function getUserLastProjectWithWorkspace(db: LancityDb, actor: Actor) {
  const [profile] = await db
    .select({ lastWorkspaceId: profiles.lastWorkspaceId })
    .from(profiles)
    .where(eq(profiles.userId, actor.userId))
  if (!profile?.lastWorkspaceId) return { project_details: [], workspace_details: {} }
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, profile.lastWorkspaceId), isNull(workspaces.deletedAt)))
  if (!workspace) return { project_details: [], workspace_details: {} }
  const projectsOfUser = await all(
    db,
    sql`select pm.id, pm.role, pm.is_active, pm.project_id, p.name as project_name, p.identifier as project_identifier
      from project_members pm join projects p on p.id = pm.project_id
      where pm.workspace_id = ${workspace.id} and pm.member_id = ${actor.userId} and pm.deleted_at is null and p.deleted_at is null`
  )
  return { workspace_details: workspace, project_details: projectsOfUser }
}

async function enrichIssues(db: LancityDb, rows: Row[]): Promise<Row[]> {
  if (!rows.length) return rows
  const ids = list(rows.map(row => Number(row.id)))
  const [assignees, labels, modules] = await Promise.all([
    all(
      db,
      sql`select issue_id, assignee_id as value from issue_assignees where deleted_at is null and issue_id in (${ids})`
    ),
    all(
      db,
      sql`select issue_id, label_id as value from issue_labels where deleted_at is null and issue_id in (${ids})`
    ),
    all(
      db,
      sql`select issue_id, module_id as value from module_issues where deleted_at is null and issue_id in (${ids})`
    )
  ])
  const pick = (source: Row[], id: unknown) => source.filter(item => item.issue_id === id).map(item => item.value)
  return rows.map(row => ({
    ...row,
    assignee_ids: pick(assignees, row.id),
    label_ids: pick(labels, row.id),
    module_ids: pick(modules, row.id)
  }))
}

/**
 * WorkspaceUserProfileIssuesEndpoint.get: issues assigned to, created by or subscribed by one user that the
 * caller may see, with the Plane filter, order and paging parameters. group_by groups the rows of the page.
 */
export async function getWorkspaceUserProfileIssues(
  db: LancityDb,
  actor: Actor,
  slug: string,
  userId: number,
  query: WorkspaceUserIssuesQuery
) {
  const { workspace } = await getWorkspace(db, actor, slug)
  const where = join([
    sql`i.workspace_id = ${workspace.id}`,
    issueObjectsQ(),
    visibleIssuesQ(actor.userId),
    sql`(${assignedQ(userId)} or i.created_by_id = ${userId}
      or exists (select 1 from issue_subscribers sub where sub.issue_id = i.id and sub.subscriber_id = ${userId} and sub.deleted_at is null))`,
    ...issueFilterQ(query)
  ])
  const win = pageWindow(query.cursor, query.per_page)
  const [{ total }] = (await all(db, sql`select count(*) as total from issues i where ${where}`)) as { total: number }[]
  const rows = await all(
    db,
    sql`select i.id, i.sequence_id, i.name, i.state_id, i.sort_order, i.completed_at, i.estimate_point_id as estimate_point,
      i.priority, i.start_date, i.target_date, i.project_id, i.parent_id, i.created_by_id as created_by, i.updated_by_id as updated_by,
      i.created_at, i.updated_at, i.archived_at, i.is_draft, i.type_id,
      (select ci.cycle_id from cycle_issues ci where ci.issue_id = i.id and ci.deleted_at is null limit 1) as cycle_id,
      (select count(*) from issue_links l where l.issue_id = i.id and l.deleted_at is null) as link_count,
      (select count(*) from issue_attachments at where at.issue_id = i.id and at.deleted_at is null) as attachment_count,
      (select count(*) from issues sub where sub.parent_id = i.id and ${issueObjectsQ('sub')}) as sub_issues_count
      from issues i where ${where} order by ${orderQ(query.order_by)} limit ${win.limit + 1} offset ${win.offset}`
  )
  const page = await enrichIssues(db, rows.slice(0, win.limit))
  const envelope = pageEnvelope([...page, ...rows.slice(win.limit)], Number(total), win)
  if (!query.group_by) return envelope
  const grouped: Record<string, { results: Row[]; total_results: number }> = {}
  for (const row of page) {
    const key = String(row[query.group_by === 'state__group' ? 'state_group' : query.group_by] ?? 'None')
    ;(grouped[key] ??= { results: [], total_results: 0 }).results.push(row)
    grouped[key].total_results += 1
  }
  return { ...envelope, grouped_by: query.group_by, results: grouped }
}

async function propertiesRow(db: LancityDb, actor: Actor, slug: string) {
  const { workspace } = await getWorkspace(db, actor, slug)
  await db
    .insert(workspaceUserProperties)
    .values({
      userId: actor.userId,
      workspaceId: workspace.id,
      filters: getDefaultFilters(),
      displayFilters: getDefaultDisplayFilters(),
      displayProperties: getDefaultDisplayProperties(),
      createdById: actor.userId,
      updatedById: actor.userId
    })
    .onConflictDoNothing()
  return workspace.id
}
const ownProperties = (workspaceId: number, userId: number) =>
  and(
    eq(workspaceUserProperties.workspaceId, workspaceId),
    eq(workspaceUserProperties.userId, userId),
    isNull(workspaceUserProperties.deletedAt)
  )

/** WorkspaceUserPropertiesEndpoint.get: get or create the caller's properties. */
export async function getWorkspaceUserProperties(db: LancityDb, actor: Actor, slug: string) {
  const workspaceId = await propertiesRow(db, actor, slug)
  const [row] = await db.select().from(workspaceUserProperties).where(ownProperties(workspaceId, actor.userId))
  return row
}

/** WorkspaceUserPropertiesEndpoint.patch. */
export async function updateWorkspaceUserProperties(
  db: LancityDb,
  actor: Actor,
  slug: string,
  input: UpdateWorkspaceUserProperties
) {
  const workspaceId = await propertiesRow(db, actor, slug)
  const [row] = await db
    .update(workspaceUserProperties)
    .set({
      filters: input.filters as never,
      displayFilters: input.display_filters as never,
      displayProperties: input.display_properties as never,
      richFilters: input.rich_filters as never,
      navigationProjectLimit: input.navigation_project_limit,
      navigationControlPreference: input.navigation_control_preference,
      updatedById: actor.userId
    })
    .where(ownProperties(workspaceId, actor.userId))
    .returning()
  return row
}

/** WorkspaceUserProfileEndpoint.get: public profile of an active member plus per-project issue counts. */
export async function getWorkspaceUserProfile(db: LancityDb, actor: Actor, slug: string, userId: number) {
  const { workspace, membership } = await getWorkspace(db, actor, slug)
  const [target] =
    await db.all<Row>(sql`select u.id, u.email, u.name, u.username, u.image, u.created_at, pr.first_name, pr.last_name,
      pr.cover_image, pr.user_timezone from workspace_members wm join "user" u on u.id = wm.member_id
      left join profiles pr on pr.user_id = u.id
      where wm.workspace_id = ${workspace.id} and wm.member_id = ${userId} and wm.is_active = 1 and wm.deleted_at is null`)
  if (!target) throw new ServiceError(404, 'MEMBER_NOT_FOUND', 'Workspace member not found')
  const hideEmail = membership.role <= 5 && userId !== actor.userId
  const projectData =
    membership.role >= 15
      ? await all(
          db,
          sql`select p.id, p.logo_props,
            ${countIssues(actor.userId, sql`i.created_by_id = ${userId}`)} as created_issues,
            ${countIssues(actor.userId, assignedQ(userId))} as assigned_issues,
            ${countIssues(actor.userId, sql`${assignedQ(userId)} and i.completed_at is not null`)} as completed_issues,
            ${countIssues(actor.userId, sql`${assignedQ(userId)} and exists (select 1 from states s where s.id = i.state_id and s."group" in ('backlog', 'unstarted', 'started'))`)} as pending_issues
            from projects p join project_members mine on mine.project_id = p.id and mine.member_id = ${actor.userId}
              and mine.is_active = 1 and mine.deleted_at is null
            where p.workspace_id = ${workspace.id} and p.archived_at is null and p.deleted_at is null`
        )
      : []
  return {
    project_data: projectData,
    user_data: {
      ...(hideEmail ? {} : { email: target.email }),
      first_name: target.first_name ?? String(target.name).split(' ')[0],
      last_name: target.last_name ?? '',
      avatar_url: target.image,
      cover_image_url: target.cover_image ?? null,
      date_joined: target.created_at,
      user_timezone: target.user_timezone ?? null,
      display_name: target.username ?? target.name
    }
  }
}

// Issue count of one project row `p` visible to the caller (_visible_issues_q with the caller's own project role).
const countIssues = (callerId: number, condition: SQL): SQL =>
  sql`(select count(*) from issues i where i.project_id = p.id and i.archived_at is null and i.is_draft = 0 and i.deleted_at is null
    and ${condition} and (p.guest_view_all_features = 1 or i.created_by_id = ${callerId} or mine.role > 5))`

const HIDDEN_FIELDS = ['comment', 'vote', 'reaction', 'draft']
function activityWhere(actor: Actor, workspaceId: number, userId: number, extra: SQL[] = []): SQL {
  return join([
    sql`a.workspace_id = ${workspaceId}`,
    sql`a.actor_id = ${userId}`,
    sql`a.deleted_at is null`,
    sql`(a.field is null or a.field not in (${list(HIDDEN_FIELDS)}))`,
    sql`i.deleted_at is null`,
    visibleIssuesQ(actor.userId, 'i'),
    ...extra
  ])
}

/** WorkspaceUserActivityEndpoint.get: paginated activity of a user on issues the caller can see. */
export async function getWorkspaceUserActivity(
  db: LancityDb,
  actor: Actor,
  slug: string,
  userId: number,
  query: { cursor?: string; per_page: number; order_by: string; project?: string[] }
) {
  const { workspace } = await getWorkspace(db, actor, slug, 15)
  const projectIds = ints(query.project ?? [])
  const where = activityWhere(actor, workspace.id, userId, [
    sql`exists (select 1 from projects ap where ap.id = a.project_id and ap.archived_at is null)`,
    ...(projectIds.length ? [sql`a.project_id in (${list(projectIds)})`] : [])
  ])
  const win = pageWindow(query.cursor, query.per_page)
  const column = query.order_by.replace('-', '') === 'updated_at' ? sql`a.updated_at` : sql`a.created_at`
  const [{ total }] = (await all(
    db,
    sql`select count(*) as total from issue_activities a join issues i on i.id = a.issue_id where ${where}`
  )) as { total: number }[]
  const rows = await all(
    db,
    sql`select a.id, a.issue_id, a.project_id, a.workspace_id, a.actor_id as actor, a.verb, a.field, a.old_value, a.new_value,
      a.comment, a.old_identifier, a.new_identifier, a.issue_comment_id as issue_comment, a.epoch, a.created_at, a.updated_at,
      i.name as issue_name, i.sequence_id as issue_sequence_id, p.identifier as project_identifier, p.name as project_name
      from issue_activities a join issues i on i.id = a.issue_id join projects p on p.id = a.project_id
      where ${where} order by ${column} ${query.order_by.startsWith('-') ? sql`desc` : sql`asc`}, a.id desc
      limit ${win.limit + 1} offset ${win.offset}`
  )
  return pageEnvelope(rows, Number(total), win)
}

/** WorkspaceUserProfileStatsEndpoint.get. */
export async function getWorkspaceUserProfileStats(
  db: LancityDb,
  actor: Actor,
  slug: string,
  userId: number,
  query: Partial<WorkspaceUserIssuesQuery>
) {
  const { workspace } = await getWorkspace(db, actor, slug)
  const base = [
    sql`i.workspace_id = ${workspace.id}`,
    issueObjectsQ(),
    visibleIssuesQ(actor.userId),
    ...issueFilterQ(query)
  ]
  const assigned = [...base, assignedQ(userId)]
  const count = async (conditions: SQL[], extra = sql`true`) =>
    Number(
      ((await all(db, sql`select count(*) as n from issues i where ${join(conditions)} and ${extra}`))[0] as Row).n
    )
  const groupOf = (groups: string[], negate = false) =>
    sql`${negate ? sql`not ` : sql``}exists (select 1 from states s where s.id = i.state_id and s."group" in (${list(groups)}))`
  const now = Date.now()
  const cycles = (condition: SQL) =>
    all(
      db,
      sql`select c.name as cycle__name, c.id as cycle__id, c.project_id as cycle__project_id
        from cycle_issues ci join issues i on i.id = ci.issue_id join cycles c on c.id = ci.cycle_id
        where ci.workspace_id = ${workspace.id} and ci.deleted_at is null and c.deleted_at is null and c.project_id = i.project_id
          and ${visibleIssuesQ(actor.userId)} and ${assignedQ(userId)} and ${condition}`
    )
  const [state, priority, created, assignedCount, pending, completed, subscribed, present, upcoming] =
    await Promise.all([
      all(
        db,
        sql`select s."group" as state_group, count(*) as state_count from issues i join states s on s.id = i.state_id
        where ${join(assigned)} group by s."group" order by s."group"`
      ),
      all(
        db,
        sql`select i.priority, count(*) as priority_count,
        case i.priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end as priority_order
        from issues i where ${join(assigned)} group by i.priority having count(*) >= 1 order by priority_order`
      ),
      count([...base, sql`i.created_by_id = ${userId}`]),
      count(assigned),
      count(assigned, groupOf(['completed', 'cancelled'], true)),
      count(assigned, groupOf(['completed'])),
      count(
        base,
        sql`exists (select 1 from issue_subscribers sub where sub.issue_id = i.id and sub.subscriber_id = ${userId} and sub.deleted_at is null)`
      ),
      cycles(sql`c.start_date < ${now} and c.end_date > ${now}`),
      cycles(sql`c.start_date > ${now}`)
    ])
  return {
    state_distribution: state,
    priority_distribution: priority,
    created_issues: created,
    assigned_issues: assignedCount,
    completed_issues: completed,
    pending_issues: pending,
    subscribed_issues: subscribed,
    present_cycles: present,
    upcoming_cycles: upcoming
  }
}

const monthsAgo = (months: number) => {
  const date = new Date()
  date.setUTCMonth(date.getUTCMonth() - months)
  return date.getTime()
}
const activityByDay = (db: LancityDb, workspaceId: number, userId: number, since: number) =>
  all(
    db,
    sql`select date(created_at / 1000, 'unixepoch') as created_date, count(*) as activity_count from issue_activities
      where actor_id = ${userId} and workspace_id = ${workspaceId} and deleted_at is null and created_at >= ${since}
      group by created_date order by created_date`
  )

/** UserActivityGraphEndpoint.get: the caller's activity per day over six months. */
export async function getUserActivityGraph(db: LancityDb, actor: Actor, slug: string) {
  const { workspace } = await getWorkspace(db, actor, slug)
  return activityByDay(db, workspace.id, actor.userId, monthsAgo(6))
}

/** ISO 8601 week number of a date (Django ExtractWeek). */
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  return Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)
}
const completedInMonth = (db: LancityDb, workspaceId: number, userId: number, month: number) =>
  all(
    db,
    sql`select i.completed_at from issues i where i.workspace_id = ${workspaceId} and ${issueObjectsQ()} and ${assignedQ(userId)}
      and i.completed_at is not null and cast(strftime('%m', i.completed_at / 1000, 'unixepoch') as integer) = ${month}`
  )

/** UserIssueCompletedGraphEndpoint.get: issues the caller completed in a month, grouped by week % 4. */
export async function getUserIssueCompletedGraph(db: LancityDb, actor: Actor, slug: string, month: number) {
  const { workspace } = await getWorkspace(db, actor, slug)
  const counts = new Map<number, number>()
  for (const row of await completedInMonth(db, workspace.id, actor.userId, month)) {
    const week = isoWeek(new Date(Number(row.completed_at))) % 4
    counts.set(week, (counts.get(week) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => a[0] - b[0]).map(([week, completed_count]) => ({ week, completed_count }))
}

/** UserWorkspaceDashboardEndpoint.get. */
export async function getUserWorkspaceDashboard(db: LancityDb, actor: Actor, slug: string, month: number) {
  const { workspace } = await getWorkspace(db, actor, slug)
  const mine = join([sql`i.workspace_id = ${workspace.id}`, issueObjectsQ(), assignedQ(actor.userId)])
  const open = sql`not exists (select 1 from states s where s.id = i.state_id and s."group" in ('completed', 'cancelled'))`
  const count = async (extra: SQL) =>
    Number(((await all(db, sql`select count(*) as n from issues i where ${mine} and ${extra}`))[0] as Row).n)
  const week = isoWeek(new Date())
  const [activities, completedRows, assigned, pending, completed, dueDates, distribution, overdue, upcoming] =
    await Promise.all([
      activityByDay(db, workspace.id, actor.userId, monthsAgo(3)),
      completedInMonth(db, workspace.id, actor.userId, month),
      count(sql`true`),
      count(open),
      count(sql`exists (select 1 from states s where s.id = i.state_id and s."group" = 'completed')`),
      all(db, sql`select i.target_date from issues i where ${mine} and i.target_date is not null`),
      all(
        db,
        sql`select s."group" as state_group, count(*) as state_count from issues i join states s on s.id = i.state_id
        where ${mine} group by s."group" order by s."group"`
      ),
      all(
        db,
        sql`select i.id, i.name, ${slug} as workspace__slug, i.project_id, i.target_date from issues i
        where ${mine} and ${open} and ${visibleIssuesQ(actor.userId)} and i.target_date < ${today()} and i.completed_at is null`
      ),
      all(
        db,
        sql`select i.id, i.name, ${slug} as workspace__slug, i.project_id, i.start_date from issues i
        where ${mine} and ${open} and ${visibleIssuesQ(actor.userId)} and i.start_date >= ${today()} and i.completed_at is null`
      )
    ])
  const weeks = new Map<number, number>()
  for (const row of completedRows) {
    const day = new Date(Number(row.completed_at)).getUTCDate()
    const bucket = Math.floor((day - 1) / 7) + 1
    weeks.set(bucket, (weeks.get(bucket) ?? 0) + 1)
  }
  return {
    issue_activities: activities,
    completed_issues: [...weeks]
      .sort((a, b) => a[0] - b[0])
      .map(([week_in_month, completed_count]) => ({ week_in_month, completed_count })),
    assigned_issues_count: assigned,
    pending_issues_count: pending,
    completed_issues_count: completed,
    issues_due_week_count: dueDates.filter(row => isoWeek(new Date(String(row.target_date))) === week).length,
    state_distribution: distribution,
    overdue_issues: overdue,
    upcoming_issues: upcoming
  }
}

/** ExportWorkspaceUserActivityEndpoint.generate_csv_from_rows: csv.writer with QUOTE_ALL and formula sanitising. */
export function generateCsvFromRows(rows: unknown[][]): string {
  const cell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  return rows.map(row => sanitizeCsvRow(row).map(cell).join(',')).join('\r\n') + '\r\n'
}

/** ExportWorkspaceUserActivityEndpoint.post: CSV of up to 10000 activities of one user on one day. */
export async function exportWorkspaceUserActivity(
  db: LancityDb,
  actor: Actor,
  slug: string,
  userId: number,
  date: string
) {
  const { workspace } = await getWorkspace(db, actor, slug, 15)
  const rows = await all(
    db,
    sql`select coalesce(u.username, u.name) as actor_name, p.identifier, i.sequence_id, p.name as project_name,
      a.created_at, a.updated_at, a.verb, a.field, a.old_value, a.new_value
      from issue_activities a join issues i on i.id = a.issue_id join projects p on p.id = a.project_id
      left join "user" u on u.id = a.actor_id
      where ${activityWhere(actor, workspace.id, userId, [sql`date(a.created_at / 1000, 'unixepoch') = ${date}`])}
      order by a.created_at desc limit 10000`
  )
  const header = [
    'Actor name',
    'Issue ID',
    'Project',
    'Created at',
    'Updated at',
    'Action',
    'Field',
    'Old value',
    'New value'
  ]
  const iso = (value: unknown) => new Date(Number(value)).toISOString()
  return generateCsvFromRows([
    header,
    ...rows.map(row => [
      row.actor_name,
      `${row.identifier} - ${row.sequence_id ?? ''}`,
      row.project_name,
      iso(row.created_at),
      iso(row.updated_at),
      row.verb,
      row.field,
      row.old_value,
      row.new_value
    ])
  ])
}
