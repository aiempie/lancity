import { and, eq, isNull } from 'drizzle-orm'
import { moduleUserProperties } from '@/db/schema/planning'
import { findModule, moduleContext } from '@/server/module/access'
import { getDefaultDisplayFilters, getDefaultDisplayProperties, getDefaultFilters } from '@/server/module/model-rules'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { ModuleUserPropertiesInput } from '@/types/planning/p2-module-schema'

/** The caller's saved view of a module, created with the defaults of PD-1445 to PD-1447 on first use. */
async function ensureProperties(db: LancityDb, actor: Actor, slug: string, projectId: number, moduleId: number) {
  const { scope } = await moduleContext(db, actor, slug, projectId)
  await findModule(db, scope, moduleId)
  await db
    .insert(moduleUserProperties)
    .values({
      moduleId,
      projectId,
      workspaceId: scope.workspaceId,
      userId: actor.userId,
      filters: getDefaultFilters(),
      displayFilters: getDefaultDisplayFilters(),
      displayProperties: getDefaultDisplayProperties(),
      richFilters: {},
      createdById: actor.userId,
      updatedById: actor.userId
    })
    .onConflictDoNothing()
  return scope
}

const own = (actor: Actor, moduleId: number, projectId: number) =>
  and(
    eq(moduleUserProperties.moduleId, moduleId),
    eq(moduleUserProperties.projectId, projectId),
    eq(moduleUserProperties.userId, actor.userId),
    isNull(moduleUserProperties.deletedAt)
  )

/** PD-0685 `ModuleUserPropertiesEndpoint.get` (get or create). Guests may read and save their own view. */
export async function getModuleUserProperties(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  moduleId: number
) {
  await ensureProperties(db, actor, slug, projectId, moduleId)
  const [row] = await db
    .select()
    .from(moduleUserProperties)
    .where(own(actor, moduleId, projectId))
  return row
}

/** PD-0684 `ModuleUserPropertiesEndpoint.patch`: only the keys in the body change. Plane answers 404 without a row, this creates it. */
export async function updateModuleUserProperties(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  moduleId: number,
  input: ModuleUserPropertiesInput
) {
  await ensureProperties(db, actor, slug, projectId, moduleId)
  const [row] = await db
    .update(moduleUserProperties)
    .set({
      filters: input.filters,
      richFilters: input.rich_filters,
      displayFilters: input.display_filters,
      displayProperties: input.display_properties,
      updatedById: actor.userId
    })
    .where(own(actor, moduleId, projectId))
    .returning()
  return row
}
