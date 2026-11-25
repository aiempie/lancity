import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { user } from '@/db/schema/auth'
import { projects } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import { pickFields, presentProject, presentProjectLite } from '@/server/project/presenters'
import {
  projectOrderBy,
  projectOrderClauses,
  queryProjectDetailAPI,
  queryProjectListCreateAPI,
  queryProjectListLiteAPI,
  visibleToApi
} from '@/server/project/queries'
import { pageEnvelope, pageWindow } from '@/server/workspace/pagination'
import { getWorkspace } from '@/server/workspace/service'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

/** `snake_case` query names (Plane) to the camelCase keys of this API. */
const camel = (value: string) => value.trim().replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase())
const csv = (value: string | undefined) => (value ?? '').split(',').map(camel).filter(Boolean)

type ApiListOptions = { cursor?: string; perPage?: number; orderBy?: string; fields?: string; expand?: string; includeArchived?: boolean }

/** PD-0070 `fields` and PD-0071 `expand` for projects: `expand` swaps lead and default assignee ids for user objects. */
async function shape(db: LancityDb, slug: string, rows: Record<string, unknown>[], options: ApiListOptions) {
  const expand = csv(options.expand)
  const fields = csv(options.fields)
  const userIds = new Set<number>()
  if (expand.length)
    for (const row of rows)
      for (const key of ['projectLeadId', 'defaultAssigneeId'] as const)
        if (typeof row[key] === 'number') userIds.add(row[key])
  const users = userIds.size
    ? await db.select({ id: user.id, name: user.name, image: user.image }).from(user).where(inArray(user.id, [...userIds]))
    : []
  const byId = new Map(users.map(row => [row.id, row]))
  return rows.map(row => {
    const presented = presentProject(row as never, slug) as Record<string, unknown>
    if (expand.includes('projectLead') || expand.includes('projectLeadId'))
      presented.projectLead = byId.get(presented.projectLeadId as number) ?? null
    if (expand.includes('defaultAssignee') || expand.includes('defaultAssigneeId'))
      presented.defaultAssignee = byId.get(presented.defaultAssigneeId as number) ?? null
    return pickFields(presented, fields)
  })
}

/** PD-0225 `ProjectListCreateAPIEndpoint.get` and PD-0226: paginated list with counts, ordered by the member's `sort_order`. */
export async function listProjectsApi(db: LancityDb, actor: Actor, slug: string, options: ApiListOptions = {}) {
  const { workspace, membership } = await getWorkspace(db, actor, slug)
  const win = pageWindow(options.cursor, options.perPage ?? 20, 100)
  const order = projectOrderBy(options.orderBy, 'sort_order')
  const rows = await queryProjectListCreateAPI(db, actor.userId, workspace.id, membership.role)
    .orderBy(...projectOrderClauses(order, actor.userId, 'member'))
    .limit(win.limit + 1)
    .offset(win.offset)
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(projects)
    .where(and(eq(projects.workspaceId, workspace.id), isNull(projects.deletedAt), visibleToApi(membership.role, actor.userId)))
  return pageEnvelope(await shape(db, slug, rows.slice(0, win.limit), options), total, win)
}

/** PD-0230 `ProjectListLiteAPIEndpoint.get` and PD-0231: minimal fields, archived projects on request. */
export async function listProjectsLiteApi(db: LancityDb, actor: Actor, slug: string, options: ApiListOptions = {}) {
  const { workspace, membership } = await getWorkspace(db, actor, slug)
  const win = pageWindow(options.cursor, options.perPage ?? 20, 100)
  const order = projectOrderBy(options.orderBy, '-created_at')
  const archived = options.includeArchived ? undefined : isNull(projects.archivedAt)
  const rows = await queryProjectListLiteAPI(db, actor.userId, workspace.id, membership.role, archived)
    .orderBy(...projectOrderClauses(order.field === 'sort_order' ? { field: 'created_at', descending: true } : order, actor.userId))
    .limit(win.limit + 1)
    .offset(win.offset)
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(projects)
    .where(
      and(eq(projects.workspaceId, workspace.id), isNull(projects.deletedAt), visibleToApi(membership.role, actor.userId), archived)
    )
  return pageEnvelope(
    rows.slice(0, win.limit).map(row => ({ ...presentProjectLite(row, slug), archivedAt: row.archivedAt })),
    total,
    win
  )
}

/** PD-0233 `ProjectDetailAPIEndpoint.get`: a project the actor belongs to, or a public one for non-guests. */
export async function getProjectApi(db: LancityDb, actor: Actor, slug: string, projectId: number, options: ApiListOptions = {}) {
  const { workspace, membership } = await getWorkspace(db, actor, slug)
  const [row] = await queryProjectDetailAPI(db, actor.userId, workspace.id, membership.role, eq(projects.id, projectId))
  if (!row) throw new ServiceError(404, 'PROJECT_NOT_FOUND', 'Project does not exist')
  return (await shape(db, slug, [row], options))[0]
}
