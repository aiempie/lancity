import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { apiV1Routes } from '@/data/linkto'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import { getPageLiveAccess } from '@/server/collaboration/access'
import {
  createPage,
  createPageFavorite,
  deletePage,
  deletePageFavorite,
  duplicatePage,
  getPage,
  getPagesDescription,
  listPages,
  listPageVersions,
  setPageAccess,
  setPageArchived,
  setPageLocked,
  summaryPage,
  updatePage,
  updatePagesDescription
} from '@/server/page/service'
import { getPageVersion } from '@/server/page/version'
import type { ApiEnv } from '@/types/api/schema'
import {
  camelizeKeys,
  PAGE_DESCRIPTION_KEYS,
  pageAccessBodySchema,
  pageCreateBodySchema,
  pageDescriptionBodySchema,
  pageListQuerySchema,
  pageUpdateBodySchema
} from '@/types/content/p2-page-schema'
import { contentIdSchema, pageLiveActionSchema } from '@/types/content/schema'

const pagePaths = {
  summary: apiV1Routes.projectPagesSummary,
  access: apiV1Routes.projectPageAccess,
  duplicate: apiV1Routes.projectPageDuplicate,
  favorite: apiV1Routes.projectPageFavorite
}
const projectIdOf = (c: Context) => parseInput(contentIdSchema, c.req.param('projectId'))
const pageIdOf = (c: Context) => parseInput(contentIdSchema, c.req.param('pageId'))

export const pagesRoutes = new Hono<ApiEnv>({ strict: false })
pagesRoutes.use('*', authenticate)
pagesRoutes.get(apiV1Routes.workspacePageLiveAccess, async c =>
  c.json(
    await getPageLiveAccess(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      parseInput(contentIdSchema, c.req.param('pageId')),
      parseInput(pageLiveActionSchema, c.req.query('action'))
    )
  )
)
pagesRoutes.get(pagePaths.summary, async c =>
  c.json(await summaryPage(getDb(), c.get('actor'), c.req.param('slug'), projectIdOf(c)))
)
pagesRoutes.get(apiV1Routes.projectPages, async c => {
  const query = parseInput(pageListQuerySchema, c.req.query())
  return c.json(
    await listPages(getDb(), c.get('actor'), c.req.param('slug'), projectIdOf(c), {
      orderBy: query.order_by,
      search: query.search
    })
  )
})
pagesRoutes.post(apiV1Routes.projectPages, async c =>
  c.json(
    await createPage(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      projectIdOf(c),
      await readJson(c, pageCreateBodySchema)
    ),
    201
  )
)
pagesRoutes.get(apiV1Routes.projectPage, async c => {
  const query = parseInput(pageListQuerySchema, c.req.query())
  return c.json(
    await getPage(getDb(), c.get('actor'), c.req.param('slug'), projectIdOf(c), pageIdOf(c), {
      trackVisit: query.track_visit !== 'false'
    })
  )
})
pagesRoutes.patch(apiV1Routes.projectPage, async c =>
  c.json(
    await updatePage(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      projectIdOf(c),
      pageIdOf(c),
      await readJson(c, pageUpdateBodySchema)
    )
  )
)
// Plane only deletes archived pages.
pagesRoutes.delete(apiV1Routes.projectPage, async c => {
  await deletePage(getDb(), c.get('actor'), c.req.param('slug'), projectIdOf(c), pageIdOf(c), { requireArchived: true })
  return c.body(null, 204)
})
pagesRoutes.post(pagePaths.access, async c => {
  await setPageAccess(
    getDb(),
    c.get('actor'),
    c.req.param('slug'),
    projectIdOf(c),
    pageIdOf(c),
    (await readJson(c, pageAccessBodySchema)).access
  )
  return c.body(null, 204)
})
pagesRoutes.post(pagePaths.duplicate, async c =>
  c.json(await duplicatePage(getDb(), c.get('actor'), c.req.param('slug'), projectIdOf(c), pageIdOf(c)), 201)
)
pagesRoutes.post(pagePaths.favorite, async c => {
  await createPageFavorite(getDb(), c.get('actor'), c.req.param('slug'), projectIdOf(c), pageIdOf(c))
  return c.body(null, 204)
})
pagesRoutes.delete(pagePaths.favorite, async c => {
  await deletePageFavorite(getDb(), c.get('actor'), c.req.param('slug'), projectIdOf(c), pageIdOf(c))
  return c.body(null, 204)
})
pagesRoutes.post(apiV1Routes.projectPageLock, async c => {
  await setPageLocked(getDb(), c.get('actor'), c.req.param('slug'), projectIdOf(c), pageIdOf(c), true)
  return c.body(null, 204)
})
pagesRoutes.delete(apiV1Routes.projectPageLock, async c => {
  await setPageLocked(getDb(), c.get('actor'), c.req.param('slug'), projectIdOf(c), pageIdOf(c), false)
  return c.body(null, 204)
})
pagesRoutes.post(apiV1Routes.projectPageArchive, async c => {
  const result = await setPageArchived(getDb(), c.get('actor'), c.req.param('slug'), projectIdOf(c), pageIdOf(c), true)
  return c.json({ archived_at: result.archivedAt })
})
pagesRoutes.delete(apiV1Routes.projectPageArchive, async c => {
  await setPageArchived(getDb(), c.get('actor'), c.req.param('slug'), projectIdOf(c), pageIdOf(c), false)
  return c.body(null, 204)
})
// Plane streams the Yjs state as an octet stream. The JSON text form stays the default for earlier clients.
pagesRoutes.get(apiV1Routes.projectPageDescription, async c => {
  const [slug, projectId, pageId] = [c.req.param('slug'), projectIdOf(c), pageIdOf(c)]
  if (c.req.query('format') === 'binary' || c.req.header('accept')?.includes('application/octet-stream')) {
    const bytes = await getPagesDescription(getDb(), c.get('actor'), slug, projectId, pageId)
    return c.body(bytes.buffer as ArrayBuffer, 200, {
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment; filename="page_description.bin"'
    })
  }
  const page = await getPage(getDb(), c.get('actor'), slug, projectId, pageId)
  return c.json({ descriptionText: page.descriptionText, descriptionHtml: page.descriptionHtml })
})
// A body with description_binary / description_html / description_json is the Plane binary update; anything else is the earlier text update.
pagesRoutes.patch(apiV1Routes.projectPageDescription, async c => {
  const [slug, projectId, pageId] = [c.req.param('slug'), projectIdOf(c), pageIdOf(c)]
  const body = await readJson(c, z.record(z.string(), z.unknown()))
  const keys = Object.keys(camelizeKeys(body) as Record<string, unknown>)
  if (keys.some(key => (PAGE_DESCRIPTION_KEYS as readonly string[]).includes(key)))
    return c.json(
      await updatePagesDescription(
        getDb(),
        c.get('actor'),
        slug,
        projectId,
        pageId,
        parseInput(pageDescriptionBodySchema, body)
      )
    )
  return c.json(
    await updatePage(getDb(), c.get('actor'), slug, projectId, pageId, parseInput(pageUpdateBodySchema, body))
  )
})
pagesRoutes.get(apiV1Routes.projectPageVersions, async c =>
  c.json(await listPageVersions(getDb(), c.get('actor'), c.req.param('slug'), projectIdOf(c), pageIdOf(c)))
)
pagesRoutes.get(apiV1Routes.projectPageVersion, async c =>
  c.json(
    await getPageVersion(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      projectIdOf(c),
      pageIdOf(c),
      parseInput(contentIdSchema, c.req.param('versionId'))
    )
  )
)
