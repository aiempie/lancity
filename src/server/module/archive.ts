import { and, eq, isNull, sql } from 'drizzle-orm'
import { modules } from '@/db/schema/planning'
import { ServiceError } from '@/server/common/errors'
import { planningWriteAccess } from '@/server/cycle/archive'
import { moduleContext } from '@/server/module/access'
import { buildModuleDetail, paginateModules, projectUsesPoints, shapeModuleApi } from '@/server/module/detail'
import { toModuleRecord } from '@/server/module/presenters'
import { queryModules } from '@/server/module/queries'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { ModuleListQuery } from '@/types/planning/p2-module-schema'

/**
 * PD-0661 `ModuleArchiveUnarchiveEndpoint.get`: the archived modules of the project, or one archived module with its
 * distributions (`moduleId`). Archived modules are listed with their counters; the detail needs both dates for the chart.
 */
export async function listArchivedModules(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  moduleId?: number
) {
  const { scope, project } = await moduleContext(db, actor, slug, projectId)
  const rows = await queryModules(db, scope, { archived: 'only', moduleId })
  if (moduleId === undefined) return rows.map(toModuleRecord)
  if (!rows.length) throw new ServiceError(404, 'MODULE_NOT_FOUND', 'Archived module not found')
  return buildModuleDetail(db, scope, rows[0], {
    points: await projectUsesPoints(db, project.estimateId),
    chartNeedsIssues: false
  })
}

/** PD-0219 / PD-0220 `ModuleArchiveUnarchiveAPIEndpoint.get`: paginated archived modules with `fields` and `expand`. */
export async function listArchivedModulesPaginated(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  query: ModuleListQuery
) {
  const { scope } = await moduleContext(db, actor, slug, projectId)
  return paginateModules(db, scope, query, { archived: 'only' }, row => shapeModuleApi(db, row, query))
}
export async function setModuleArchived(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  moduleId: number,
  archived: boolean
) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 15)
  const [item] = await db
    .select()
    .from(modules)
    .where(
      and(
        eq(modules.id, moduleId),
        eq(modules.projectId, projectId),
        eq(modules.workspaceId, workspace.id),
        isNull(modules.deletedAt)
      )
    )
  if (!item) throw new ServiceError(404, 'MODULE_NOT_FOUND', 'Module not found')
  if (archived && item.status !== 'completed' && item.status !== 'cancelled')
    throw new ServiceError(400, 'MODULE_NOT_COMPLETED', 'Only completed or cancelled modules can be archived')
  const now = new Date()
  const update = db
    .update(modules)
    .set({ archivedAt: archived ? now : null, updatedById: actor.userId })
    .where(
      and(
        eq(modules.id, moduleId),
        eq(modules.projectId, projectId),
        eq(modules.workspaceId, workspace.id),
        isNull(modules.deletedAt),
        planningWriteAccess(actor, slug, projectId, workspace.id),
        archived ? sql`${modules.status} in ('completed', 'cancelled')` : undefined
      )
    )
    .returning({ id: modules.id })
  if (archived) {
    const statement = update.toSQL()
    const [updated] = await db.$client.batch([
      db.$client.prepare(statement.sql).bind(...statement.params),
      db.$client
        .prepare(
          `delete from user_favorites where entity_type = 'module' and entity_identifier = ? and project_id = ? and workspace_id = ? and changes() > 0`
        )
        .bind(moduleId, projectId, workspace.id)
    ])
    if (!updated.results.length) throw new ServiceError(409, 'MODULE_CHANGED', 'Module or project access changed')
  } else if (!(await update).length) throw new ServiceError(409, 'MODULE_CHANGED', 'Module or project access changed')
  return { archivedAt: archived ? now : null }
}
