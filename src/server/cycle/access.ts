import { and, eq, isNull } from 'drizzle-orm'
import { cycles } from '@/db/schema/planning'
import { ServiceError } from '@/server/common/errors'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

/**
 * Project access for the cycle services. `role` is 20 for workspace admins, otherwise the project role (the
 * `allow_permission` rule of Plane). With `visibleOnly`, an archived project answers 404 like Plane's
 * `project__archived_at__isnull=True` filter.
 */
export async function cycleAccess(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  minimumRole: 5 | 15 | 20 = 5,
  visibleOnly = false
) {
  const row = await requireProjectAccess(db, actor, slug, projectId, minimumRole)
  if (visibleOnly && row.project.archivedAt) throw new ServiceError(404, 'PROJECT_NOT_FOUND', 'Project not found')
  const role = row.workspaceMembership.role === 20 ? 20 : row.membership.role
  return { workspace: row.workspace, project: row.project, role }
}

export type CycleRecord = typeof cycles.$inferSelect

/** Load a cycle of the project, 404 when it is missing or soft-deleted. */
export async function loadCycle(
  db: LancityDb,
  workspaceId: number,
  projectId: number,
  cycleId: number,
  archived: 'any' | 'no' | 'only' = 'any'
): Promise<CycleRecord> {
  const [cycle] = await db
    .select()
    .from(cycles)
    .where(
      and(
        eq(cycles.id, cycleId),
        eq(cycles.projectId, projectId),
        eq(cycles.workspaceId, workspaceId),
        isNull(cycles.deletedAt)
      )
    )
    .limit(1)
  if (!cycle || (archived === 'no' && cycle.archivedAt) || (archived === 'only' && !cycle.archivedAt))
    throw new ServiceError(404, 'CYCLE_NOT_FOUND', 'Cycle not found')
  return cycle
}
