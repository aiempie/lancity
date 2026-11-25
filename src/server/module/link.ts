import { and, eq, isNull, ne } from 'drizzle-orm'
import { moduleLinks } from '@/db/schema/planning'
import { ServiceError } from '@/server/common/errors'
import { findModule, moduleContext } from '@/server/module/access'
import { queryModuleLink } from '@/server/module/queries'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { ModuleLinkInput, ModuleLinkUpdateInput } from '@/types/planning/p2-module-schema'

async function assertNewUrl(db: LancityDb, moduleId: number, url: string, exceptId?: number) {
  const [existing] = await db
    .select({ id: moduleLinks.id })
    .from(moduleLinks)
    .where(
      and(
        eq(moduleLinks.moduleId, moduleId),
        eq(moduleLinks.url, url),
        isNull(moduleLinks.deletedAt),
        exceptId === undefined ? undefined : ne(moduleLinks.id, exceptId)
      )
    )
    .limit(1)
  if (existing) throw new ServiceError(400, 'URL_ALREADY_EXISTS', 'URL already exists.')
}

/** PD-0674 `ModuleLinkViewSet.list`: the links of a module, newest first. Any project member may read. */
export async function listModuleLinks(db: LancityDb, actor: Actor, slug: string, projectId: number, moduleId: number) {
  const { scope } = await moduleContext(db, actor, slug, projectId)
  await findModule(db, scope, moduleId)
  return queryModuleLink(db, scope, moduleId)
}

/** PD-0676 `ModuleLinkViewSet.retrieve`. */
export async function getModuleLink(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  moduleId: number,
  linkId: number
) {
  const { scope } = await moduleContext(db, actor, slug, projectId)
  const [link] = await queryModuleLink(db, scope, moduleId, linkId)
  if (!link) throw new ServiceError(404, 'MODULE_LINK_NOT_FOUND', 'Module link not found')
  return link
}

/**
 * PD-0672 `ModuleLinkViewSet.create`, PD-0678 `perform_create`, PD-0345 and PD-0039 `ModuleLinkSerializer.create`:
 * the module must belong to the project and a URL can be linked once per module.
 */
export async function createModuleLink(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  moduleId: number,
  input: ModuleLinkInput
) {
  const { scope } = await moduleContext(db, actor, slug, projectId, 15)
  await findModule(db, scope, moduleId)
  await assertNewUrl(db, moduleId, input.url)
  const [link] = await db
    .insert(moduleLinks)
    .values({
      url: input.url,
      title: input.title,
      metadata: input.metadata,
      moduleId,
      projectId,
      workspaceId: scope.workspaceId,
      createdById: actor.userId,
      updatedById: actor.userId
    })
    .returning()
  return link
}

/** PD-0675 and PD-0677 `ModuleLinkViewSet.partial_update` and `update`, PD-0346: change title, URL or metadata. */
export async function updateModuleLink(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  moduleId: number,
  linkId: number,
  input: ModuleLinkUpdateInput
) {
  const { scope } = await moduleContext(db, actor, slug, projectId, 15)
  const [link] = await queryModuleLink(db, scope, moduleId, linkId)
  if (!link) throw new ServiceError(404, 'MODULE_LINK_NOT_FOUND', 'Module link not found')
  if (input.url !== undefined) await assertNewUrl(db, moduleId, input.url, linkId)
  const [updated] = await db
    .update(moduleLinks)
    .set({ url: input.url, title: input.title, metadata: input.metadata, updatedById: actor.userId })
    .where(and(eq(moduleLinks.id, linkId), eq(moduleLinks.moduleId, moduleId), isNull(moduleLinks.deletedAt)))
    .returning()
  return updated
}

/** PD-0673 `ModuleLinkViewSet.destroy`. */
export async function deleteModuleLink(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  moduleId: number,
  linkId: number
) {
  const { scope } = await moduleContext(db, actor, slug, projectId, 15)
  const [link] = await queryModuleLink(db, scope, moduleId, linkId)
  if (!link) throw new ServiceError(404, 'MODULE_LINK_NOT_FOUND', 'Module link not found')
  await db
    .update(moduleLinks)
    .set({ deletedAt: new Date(), updatedById: actor.userId })
    .where(and(eq(moduleLinks.id, linkId), isNull(moduleLinks.deletedAt)))
}
