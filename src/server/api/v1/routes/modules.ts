import { Hono, type Context } from 'hono'
import { apiV1Routes } from '@/data/linkto'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import { listArchivedModules, listArchivedModulesPaginated, setModuleArchived } from '@/server/module/archive'
import {
  assignModuleIssues,
  createIssueModules,
  createModule,
  createModuleFavorite,
  createModuleIssues,
  createModuleLink,
  deleteModule,
  deleteModuleFavorite,
  deleteModuleLink,
  getModuleApi,
  getModuleDetail,
  getModuleIssueItem,
  getModuleLink,
  getModuleUserProperties,
  getWorkspaceModules,
  listModuleFavorites,
  listModuleIssues,
  listModuleIssuesApi,
  listModuleIssuesPaginated,
  listModuleLinks,
  listModules,
  listModulesLite,
  listModulesPaginated,
  removeModuleIssue,
  updateModule,
  updateModuleLink,
  updateModuleUserProperties
} from '@/server/module/service'
import type { ApiEnv } from '@/types/api/schema'
import {
  issueModulesInputSchema,
  moduleFavoriteInputSchema,
  moduleIssuesInputSchema,
  moduleLinkInputSchema,
  moduleLinkUpdateInputSchema,
  moduleListQuerySchema,
  moduleUpdateInputSchema,
  moduleUserPropertiesInputSchema,
  moduleWriteInputSchema
} from '@/types/planning/p2-module-schema'
import { planningIdSchema } from '@/types/planning/schema'

/** Paths relative to a project (and to a workspace for `workspaceModules`) that `linkto.ts` does not list yet. */
const moduleRoutes = {
  modulesLite: apiV1Routes.modulesLite,
  moduleLinks: apiV1Routes.moduleLinks,
  moduleLink: apiV1Routes.moduleLink,
  moduleUserProperties: apiV1Routes.moduleUserProperties,
  moduleAppIssues: apiV1Routes.moduleAppIssues,
  moduleAppIssue: apiV1Routes.moduleAppIssue,
  issueModules: apiV1Routes.issueModules,
  userFavoriteModules: apiV1Routes.userFavoriteModules,
  userFavoriteModule: apiV1Routes.userFavoriteModule,
  workspaceModules: apiV1Routes.workspaceModules
} as const

type C = Context<ApiEnv>
const project = (c: C) =>
  [getDb(), c.get('actor'), c.req.param('slug')!, parseInput(planningIdSchema, c.req.param('projectId'))] as const
const id = (c: C, name: string) => parseInput(planningIdSchema, c.req.param(name))
const listQuery = (c: C) => parseInput(moduleListQuerySchema, c.req.query())
/** A request with `cursor` or `per_page` wants the paginated envelope of the external API. */
const paged = (query: { cursor?: string; per_page?: string }) =>
  query.cursor !== undefined || query.per_page !== undefined
const success = { message: 'success' }

/** Mounted at `apiProject`. */
export const modulesRoutes = new Hono<ApiEnv>()
modulesRoutes.use('*', authenticate)

// ---------------------------------------------------------------- modules
modulesRoutes.get(apiV1Routes.modules, async c => {
  const query = listQuery(c)
  return c.json(paged(query) ? await listModulesPaginated(...project(c), query) : await listModules(...project(c)))
})
modulesRoutes.get(moduleRoutes.modulesLite, async c => c.json(await listModulesLite(...project(c), listQuery(c))))
modulesRoutes.post(apiV1Routes.modules, async c =>
  c.json(await createModule(...project(c), await readJson(c, moduleWriteInputSchema)), 201)
)
modulesRoutes.get(apiV1Routes.module, async c => {
  const query = listQuery(c)
  const moduleId = id(c, 'moduleId')
  return c.json(
    query.fields || query.expand
      ? await getModuleApi(...project(c), moduleId, query)
      : await getModuleDetail(...project(c), moduleId)
  )
})
modulesRoutes.patch(apiV1Routes.module, async c =>
  c.json(await updateModule(...project(c), id(c, 'moduleId'), await readJson(c, moduleUpdateInputSchema)))
)
modulesRoutes.put(apiV1Routes.module, async c =>
  c.json(await updateModule(...project(c), id(c, 'moduleId'), await readJson(c, moduleWriteInputSchema)))
)
modulesRoutes.delete(apiV1Routes.module, async c => {
  await deleteModule(...project(c), id(c, 'moduleId'))
  return c.body(null, 204)
})

// ---------------------------------------------------------------- module issues (external API paths)
modulesRoutes.get(apiV1Routes.moduleIssues, async c => {
  const query = c.req.query()
  const moduleId = id(c, 'moduleId')
  const wantsPage = ['cursor', 'per_page', 'order_by', 'group_by', 'fields'].some(key => query[key] !== undefined)
  return c.json(
    wantsPage
      ? await listModuleIssuesApi(...project(c), moduleId, query)
      : await listModuleIssues(...project(c), moduleId)
  )
})
modulesRoutes.post(apiV1Routes.moduleIssues, async c => {
  const input = await readJson(c, moduleIssuesInputSchema)
  await assignModuleIssues(...project(c), id(c, 'moduleId'), input.issues)
  return c.body(null, 204)
})
modulesRoutes.get(apiV1Routes.moduleIssue, async c =>
  c.json(await getModuleIssueItem(...project(c), id(c, 'moduleId'), id(c, 'issueId')))
)
modulesRoutes.delete(apiV1Routes.moduleIssue, async c => {
  await removeModuleIssue(...project(c), id(c, 'moduleId'), id(c, 'issueId'))
  return c.body(null, 204)
})

// ---------------------------------------------------------------- module issues (app paths)
modulesRoutes.get(moduleRoutes.moduleAppIssues, async c =>
  c.json(await listModuleIssuesPaginated(...project(c), id(c, 'moduleId'), c.req.query()))
)
modulesRoutes.post(moduleRoutes.moduleAppIssues, async c => {
  const input = await readJson(c, moduleIssuesInputSchema)
  await createModuleIssues(...project(c), id(c, 'moduleId'), input.issues)
  return c.json(success, 201)
})
modulesRoutes.get(moduleRoutes.moduleAppIssue, async c =>
  c.json(await getModuleIssueItem(...project(c), id(c, 'moduleId'), id(c, 'issueId')))
)
// PD-0686 and PD-0688: Plane's inherited update handlers serialize an issue as a module issue and cannot work.
const notAllowed = (c: C) =>
  c.json({ code: 'METHOD_NOT_ALLOWED', error: 'Module issues are changed by adding or removing them' }, 405)
modulesRoutes.patch(moduleRoutes.moduleAppIssue, notAllowed)
modulesRoutes.put(moduleRoutes.moduleAppIssue, notAllowed)
modulesRoutes.delete(moduleRoutes.moduleAppIssue, async c => {
  await removeModuleIssue(...project(c), id(c, 'moduleId'), id(c, 'issueId'), { ignoreMissing: true })
  return c.body(null, 204)
})
modulesRoutes.post(moduleRoutes.issueModules, async c => {
  await createIssueModules(...project(c), id(c, 'issueId'), await readJson(c, issueModulesInputSchema))
  return c.json(success, 201)
})

// ---------------------------------------------------------------- links, properties, favorites
modulesRoutes.get(moduleRoutes.moduleLinks, async c => c.json(await listModuleLinks(...project(c), id(c, 'moduleId'))))
modulesRoutes.post(moduleRoutes.moduleLinks, async c =>
  c.json(await createModuleLink(...project(c), id(c, 'moduleId'), await readJson(c, moduleLinkInputSchema)), 201)
)
modulesRoutes.get(moduleRoutes.moduleLink, async c =>
  c.json(await getModuleLink(...project(c), id(c, 'moduleId'), id(c, 'linkId')))
)
const updateLink = async (c: C) =>
  c.json(
    await updateModuleLink(
      ...project(c),
      id(c, 'moduleId'),
      id(c, 'linkId'),
      await readJson(c, moduleLinkUpdateInputSchema)
    )
  )
modulesRoutes.patch(moduleRoutes.moduleLink, updateLink)
modulesRoutes.put(moduleRoutes.moduleLink, updateLink)
modulesRoutes.delete(moduleRoutes.moduleLink, async c => {
  await deleteModuleLink(...project(c), id(c, 'moduleId'), id(c, 'linkId'))
  return c.body(null, 204)
})
modulesRoutes.get(moduleRoutes.moduleUserProperties, async c =>
  c.json(await getModuleUserProperties(...project(c), id(c, 'moduleId')))
)
modulesRoutes.patch(moduleRoutes.moduleUserProperties, async c =>
  c.json(
    await updateModuleUserProperties(
      ...project(c),
      id(c, 'moduleId'),
      await readJson(c, moduleUserPropertiesInputSchema)
    ),
    201
  )
)
modulesRoutes.get(moduleRoutes.userFavoriteModules, async c => c.json(await listModuleFavorites(...project(c))))
modulesRoutes.post(moduleRoutes.userFavoriteModules, async c => {
  await createModuleFavorite(...project(c), (await readJson(c, moduleFavoriteInputSchema)).module)
  return c.body(null, 204)
})
modulesRoutes.delete(moduleRoutes.userFavoriteModule, async c => {
  await deleteModuleFavorite(...project(c), id(c, 'moduleId'))
  return c.body(null, 204)
})

// ---------------------------------------------------------------- archive
modulesRoutes.get(apiV1Routes.archivedModules, async c => {
  const query = listQuery(c)
  return c.json(
    paged(query) ? await listArchivedModulesPaginated(...project(c), query) : await listArchivedModules(...project(c))
  )
})
modulesRoutes.get(apiV1Routes.archivedModule, async c =>
  c.json(await listArchivedModules(...project(c), id(c, 'moduleId')))
)
const archive = (archived: boolean) => async (c: C) => {
  const result = await setModuleArchived(...project(c), id(c, 'moduleId'), archived)
  return archived ? c.json({ archived_at: result.archivedAt }) : c.body(null, 204)
}
modulesRoutes.post(apiV1Routes.moduleArchive, archive(true))
modulesRoutes.delete(apiV1Routes.moduleArchive, archive(false))
modulesRoutes.delete(apiV1Routes.archivedModuleRestore, archive(false))
modulesRoutes.post(apiV1Routes.archivedModule, archive(true))
modulesRoutes.delete(apiV1Routes.archivedModule, archive(false))

/** Mounted at `apiWorkspace`. Plane `WorkspaceModulesEndpoint` (PD-0922). */
export const workspaceModulesRoutes = new Hono<ApiEnv>()
workspaceModulesRoutes.use('*', authenticate)
workspaceModulesRoutes.get(moduleRoutes.workspaceModules, async c =>
  c.json(await getWorkspaceModules(getDb(), c.get('actor'), c.req.param('slug')!, c.req.query('order_by')))
)
