import { and, eq, isNull, sql } from 'drizzle-orm'
import { user } from '@/db/schema/auth'
import { workspaceMembers, workspaces } from '@/db/schema/workspace'
import { isIntegrityError, ServiceError } from '@/server/common/errors'
import { containsFolded, searchValue } from '@/server/common/unicode'
import { OffsetPaginator, paginate } from '@/server/common/pagination'
import { requireInstanceAdmin } from '@/server/instance/permissions'
import { toInstanceWorkspaceResponse } from '@/server/instance/presenters'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import { instanceWorkspaceSlugSchema, type CreateInstanceWorkspaceInput } from '@/types/instance/p3-instance-schema'

async function slugTaken(db: LancityDb, slug: string): Promise<boolean> {
  const [row] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(isNull(workspaces.deletedAt), sql`lower(${workspaces.slug}) = ${slug.toLowerCase()}`))
    .limit(1)
  return Boolean(row)
}

/** PD-1555 `InstanceWorkSpaceAvailabilityCheckEndpoint.get`: `status` is true when the slug can be used. */
export async function getInstanceWorkspaceAvailabilityCheck(db: LancityDb, actor: Actor, slug: string | null | undefined) {
  await requireInstanceAdmin(db, actor)
  if (!slug) throw new ServiceError(400, 'SLUG_REQUIRED', 'Workspace Slug is required')
  // Reserved slugs count as taken, like Plane's RESTRICTED_WORKSPACE_SLUGS check.
  return { status: instanceWorkspaceSlugSchema.safeParse(slug).success && !(await slugTaken(db, slug)) }
}

/**
 * PD-1556 `InstanceWorkSpaceEndpoint.get` (with PD-1557, the `on_results` callback): every workspace on the instance
 * with project and active non-bot member totals, optional `search` on the name, 10 per page.
 */
export async function getInstanceWorkspace(db: LancityDb, actor: Actor, query: URLSearchParams) {
  await requireInstanceAdmin(db, actor)
  const search = query.get('search')?.trim()
  const where = and(isNull(workspaces.deletedAt), search ? containsFolded(sql`${workspaces.name}`, search, searchValue('workspaces', 'name', sql`${workspaces.id}`)) : undefined)
  return paginate(query, {
    defaultPerPage: 10,
    maxPerPage: 10,
    paginator: new OffsetPaginator({
      orderBy: '-created_at',
      count: async () => {
        const [row] = await db.select({ total: sql<number>`count(*)` }).from(workspaces).where(where)
        return row.total
      },
      fetch: async (offset, limit) => {
        const rows = await db
          .select({
            id: workspaces.id,
            name: workspaces.name,
            slug: workspaces.slug,
            logo: workspaces.logo,
            logoAssetId: workspaces.logoAssetId,
            ownerId: workspaces.ownerId,
            ownerEmail: user.email,
            ownerName: user.name,
            organizationSize: workspaces.organizationSize,
            timezone: workspaces.timezone,
            backgroundColor: workspaces.backgroundColor,
            createdAt: workspaces.createdAt,
            updatedAt: workspaces.updatedAt,
            totalProjects: sql<number>`(select count(*) from projects p where p.workspace_id = ${workspaces.id} and p.deleted_at is null)`,
            totalMembers: sql<number>`(select count(*) from workspace_members m
              left join user_security s on s.user_id = m.member_id
              where m.workspace_id = ${workspaces.id} and m.is_active = 1 and m.deleted_at is null and coalesce(s.is_bot, 0) = 0)`
          })
          .from(workspaces)
          .leftJoin(user, eq(user.id, workspaces.ownerId))
          .where(where)
          .orderBy(sql`${workspaces.createdAt} desc`, sql`${workspaces.id} desc`)
          .limit(limit)
          .offset(offset)
        return rows.map(toInstanceWorkspaceResponse)
      }
    })
  })
}

/**
 * PD-1558 `InstanceWorkSpaceEndpoint.post`: an instance admin creates a workspace and becomes its owner and admin
 * member. Unlike the app endpoint, `DISABLE_WORKSPACE_CREATION` does not apply to instance admins.
 */
export async function createInstanceWorkspace(db: LancityDb, actor: Actor, input: CreateInstanceWorkspaceInput) {
  await requireInstanceAdmin(db, actor)
  if (await slugTaken(db, input.slug)) throw new ServiceError(400, 'SLUG_IN_USE', 'Slug is already in use')
  try {
    const [created] = await db.batch([
      db
        .insert(workspaces)
        .values({ name: input.name, slug: input.slug, ownerId: actor.userId, createdById: actor.userId, updatedById: actor.userId })
        .returning(),
      db.insert(workspaceMembers).values({
        workspaceId: sql`(select id from workspaces where slug = ${input.slug})`,
        memberId: actor.userId,
        role: 20,
        companyRole: input.company_role ?? '',
        createdById: actor.userId,
        updatedById: actor.userId
      })
    ])
    const workspace = created[0]
    return { ...workspace, total_projects: 0, total_members: 1 }
  } catch (error) {
    if (isIntegrityError(error) || (await slugTaken(db, input.slug)))
      throw new ServiceError(409, 'WORKSPACE_SLUG_EXISTS', 'The workspace with the slug already exists')
    throw error
  }
}
