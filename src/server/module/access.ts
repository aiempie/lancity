import { and, eq, inArray, isNull } from 'drizzle-orm'
import { modules } from '@/db/schema/planning'
import { projectMembers } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import type { ModuleScope } from '@/server/module/queries'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

/** Project access check plus the scope every module query needs. */
export async function moduleContext(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  minimumRole: 5 | 15 | 20 = 5
) {
  const access = await requireProjectAccess(db, actor, slug, projectId, minimumRole)
  const scope: ModuleScope = { workspaceId: access.workspace.id, projectId, userId: actor.userId }
  return { ...access, scope }
}

/** The module row (archived or not), or a 404 when it is not in the project. */
export async function findModule(db: LancityDb, scope: ModuleScope, moduleId: number) {
  const [item] = await db
    .select()
    .from(modules)
    .where(
      and(
        eq(modules.id, moduleId),
        eq(modules.projectId, scope.projectId),
        eq(modules.workspaceId, scope.workspaceId),
        isNull(modules.deletedAt)
      )
    )
    .limit(1)
  if (!item) throw new ServiceError(404, 'MODULE_NOT_FOUND', 'Module not found')
  return item
}

/** D1 allows 100 bound parameters per statement, so id lists are processed in slices. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const slices: T[][] = []
  for (let index = 0; index < items.length; index += size) slices.push(items.slice(index, index + size))
  return slices
}

/** The ids of `candidates` that are active members of the project (members of a module must belong to it). */
export async function activeProjectMemberIds(db: LancityDb, projectId: number, candidates: readonly number[]) {
  const unique = [...new Set(candidates)]
  const found = await Promise.all(
    chunk(unique, 50).map(part =>
      db
        .select({ id: projectMembers.memberId })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.isActive, true),
            isNull(projectMembers.deletedAt),
            inArray(projectMembers.memberId, part)
          )
        )
    )
  )
  return found.flat().map(row => row.id)
}
