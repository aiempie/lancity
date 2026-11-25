import { env } from 'cloudflare:workers'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { apiV1Routes, linkto } from '@/data/linkto'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput } from '@/server/api/v1/validation'
import { deleteProjectAsset, downloadProjectAsset, uploadProjectAsset } from '@/server/asset/service'
import {
  createFileAsset,
  createUserFileAssets,
  deleteFileAsset,
  deleteUserFileAssets,
  getFileAsset,
  getUserAssets,
  restoreFileAsset
} from '@/server/asset/file-assets'
import { createGenericAsset, getGenericAsset, updateGenericAsset } from '@/server/asset/generic'
import { objectResponse, uploadInstructions } from '@/server/asset/storage'
import * as assets from '@/server/asset/v2'
import { getEnv } from '@/server/common/env'
import { ServiceError } from '@/server/common/errors'
import { assetRateLimit } from '@/server/common/rate-limit'
import { requireProjectAccess } from '@/server/project/permissions'
import type { ApiEnv } from '@/types/api/schema'
import { contentIdSchema, type ContentWorkerEnv } from '@/types/content/schema'

/**
 * Paths of the asset API. `assetsRoutes` is mounted at `linkto.workspaces` (existing mount) and `userAssetsRoutes` at
 * `/assets` below `linkto.apiV1`; the latter has no `linkto` key yet (see handoff p2-asset).
 */
export const assetPaths = {
  workspaceAssets: apiV1Routes.workspaceAssets,
  workspaceAsset: apiV1Routes.workspaceAsset,
  workspaceAssetContent: apiV1Routes.workspaceAssetContent,
  workspaceAssetRestore: apiV1Routes.workspaceAssetRestore,
  workspaceAssetCheck: apiV1Routes.workspaceAssetCheck,
  workspaceAssetDuplicate: apiV1Routes.workspaceAssetDuplicate,
  workspaceAssetDownload: apiV1Routes.workspaceAssetDownload,
  genericAssets: apiV1Routes.genericAssets,
  genericAsset: apiV1Routes.genericAsset,
  projectEntityAssets: apiV1Routes.projectEntityAssets,
  projectEntityAsset: apiV1Routes.projectEntityAsset,
  projectEntityAssetContent: apiV1Routes.projectEntityAssetContent,
  projectEntityAssetDownload: apiV1Routes.projectEntityAssetDownload,
  projectEntityAssetsBulk: apiV1Routes.projectEntityAssetsBulk,
  fileAssets: apiV1Routes.fileAssets,
  fileAsset: apiV1Routes.fileAsset,
  fileAssetRestore: apiV1Routes.fileAssetRestore,
  userAssets: apiV1Routes.userAssets,
  userAsset: apiV1Routes.userAsset,
  userAssetContent: apiV1Routes.userAssetContent,
  staticAsset: apiV1Routes.staticAsset,
  userFileAssets: apiV1Routes.userFileAssets,
  userFileAsset: apiV1Routes.userFileAsset
} as const

const bucket = () => getEnv().ASSET_BUCKET
const idParam = (c: Context, name: string) => parseInput(contentIdSchema, c.req.param(name))

/** A JSON body that may be absent (PATCH confirmations). Invalid JSON is a 400. */
async function optionalJson(c: Context): Promise<unknown> {
  const text = await c.req.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new ServiceError(400, 'INVALID_JSON', 'Request body must be valid JSON')
  }
}

/** Replacement for Plane's presigned POST: where and how the client sends the bytes. */
function createdResponse(c: Context, created: assets.CreatedAsset, contentPath: string) {
  const { asset, assetUrl } = created
  const type = (asset.attributes as { type?: string }).type ?? 'application/octet-stream'
  return c.json(
    {
      upload_data: uploadInstructions(contentPath.replace(':assetId', String(asset.id)), type, asset.size),
      asset_id: asset.id,
      asset_url: assetUrl
    },
    200
  )
}

function disposition(c: Context) {
  return c.req.query('disposition') === 'inline' ? 'inline' : 'attachment'
}

/** Reject a body whose declared length is too big before it is read. */
function requireLength(c: Context, max: number) {
  const declared = c.req.header('content-length')
  if (!declared || !/^\d+$/.test(declared))
    throw new ServiceError(411, 'LENGTH_REQUIRED', 'A valid Content-Length is required')
  if (Number(declared) > max) throw new ServiceError(413, 'ASSET_TOO_LARGE', 'Asset upload is too large')
}

export const assetsRoutes = new Hono<ApiEnv>({ strict: false })
assetsRoutes.use('*', authenticate)
assetsRoutes.post(apiV1Routes.projectAssets, async c => {
  // Reject oversized bodies before multipart parsing; Content-Length can be absent, so the File is also checked.
  const declaredLength = c.req.header('content-length')
  if (!declaredLength || !/^\d+$/.test(declaredLength))
    throw new ServiceError(411, 'LENGTH_REQUIRED', 'A valid Content-Length is required')
  const length = Number(declaredLength)
  if (!Number.isSafeInteger(length) || length > 11 * 1024 * 1024)
    throw new ServiceError(413, 'ASSET_TOO_LARGE', 'Asset upload is too large')
  await requireProjectAccess(
    getDb(),
    c.get('actor'),
    c.req.param('slug'),
    parseInput(contentIdSchema, c.req.param('projectId'))
  )
  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    throw new ServiceError(400, 'INVALID_ASSET', 'Expected a multipart file')
  }
  const file = form.get('file')
  if (!(file instanceof File)) throw new ServiceError(400, 'INVALID_ASSET', 'Expected a multipart file')
  return c.json(
    await uploadProjectAsset(
      getDb(),
      (env as unknown as ContentWorkerEnv).ASSET_BUCKET,
      c.get('actor'),
      c.req.param('slug'),
      parseInput(contentIdSchema, c.req.param('projectId')),
      file
    ),
    201
  )
})
assetsRoutes.get(apiV1Routes.projectAsset, async c => {
  const object = await downloadProjectAsset(
    getDb(),
    (env as unknown as ContentWorkerEnv).ASSET_BUCKET,
    c.get('actor'),
    c.req.param('slug'),
    parseInput(contentIdSchema, c.req.param('projectId')),
    parseInput(contentIdSchema, c.req.param('assetId'))
  )
  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store'
    }
  })
})
assetsRoutes.delete(apiV1Routes.projectAsset, async c => {
  await deleteProjectAsset(
    getDb(),
    (env as unknown as ContentWorkerEnv).ASSET_BUCKET,
    c.get('actor'),
    c.req.param('slug'),
    parseInput(contentIdSchema, c.req.param('projectId')),
    parseInput(contentIdSchema, c.req.param('assetId'))
  )
  return c.body(null, 204)
})

// ------------------------------------------------------------------------------------ workspace assets
const workspaceContent = (c: Context) => `${linkto.apiV1}/workspaces/${c.req.param('slug')}/assets/:assetId/content`
const projectContent = (c: Context) =>
  `${linkto.apiV1}/workspaces/${c.req.param('slug')}/projects/${c.req.param('projectId')}/entity-assets/:assetId/content`

// PD-0453, 0059: register an upload that may be bound to an entity.
assetsRoutes.post(assetPaths.workspaceAssets, async c =>
  createdResponse(
    c,
    await assets.createWorkspaceFileAsset(getDb(), c.get('actor'), c.req.param('slug'), await optionalJson(c)),
    workspaceContent(c)
  )
)
// PD-0456: download. `?disposition=inline` is honoured for allow-listed images only.
assetsRoutes.get(assetPaths.workspaceAsset, async c => {
  const { asset, object } = await assets.getWorkspaceFileAsset(
    getDb(),
    bucket(),
    c.get('actor'),
    c.req.param('slug'),
    idParam(c, 'assetId')
  )
  return assets.streamAsset(asset, object, disposition(c))
})
assetsRoutes.get(assetPaths.workspaceAssetDownload, async c => {
  const { asset, object } = await assets.getWorkspaceAssetDownload(
    getDb(),
    bucket(),
    c.get('actor'),
    c.req.param('slug'),
    idParam(c, 'assetId')
  )
  return assets.streamAsset(asset, object, 'attachment')
})
// Worker upload that replaces the presigned POST.
assetsRoutes.put(assetPaths.workspaceAssetContent, async c =>
  c.json(
    await assets.uploadAssetContent(getDb(), bucket(), c.get('actor'), idParam(c, 'assetId'), c.req.raw, {
      slug: c.req.param('slug')
    })
  )
)
// PD-0454: confirm the upload.
assetsRoutes.patch(assetPaths.workspaceAsset, async c => {
  await assets.updateWorkspaceFileAsset(
    getDb(),
    bucket(),
    c.get('actor'),
    c.req.param('slug'),
    idParam(c, 'assetId'),
    await optionalJson(c)
  )
  return c.body(null, 204)
})
// PD-0455
assetsRoutes.delete(assetPaths.workspaceAsset, async c => {
  await assets.deleteWorkspaceFileAsset(getDb(), c.get('actor'), c.req.param('slug'), idParam(c, 'assetId'))
  return c.body(null, 204)
})
// PD-0458
assetsRoutes.post(assetPaths.workspaceAssetRestore, async c => {
  await assets.createAssetRestore(getDb(), c.get('actor'), c.req.param('slug'), idParam(c, 'assetId'))
  return c.body(null, 204)
})
// PD-0466
assetsRoutes.get(assetPaths.workspaceAssetCheck, async c =>
  c.json(await assets.getAssetCheck(getDb(), c.get('actor'), c.req.param('slug'), idParam(c, 'assetId')))
)
// PD-0468: 5 requests per minute per asset (Plane `AssetRateThrottle`).
assetsRoutes.post(assetPaths.workspaceAssetDuplicate, assetRateLimit('assetId'), async c =>
  c.json(
    await assets.duplicateAsset(
      getDb(),
      bucket(),
      c.get('actor'),
      c.req.param('slug'),
      idParam(c, 'assetId'),
      await optionalJson(c)
    )
  )
)

// PD-0059, 0058, 0060: generic assets (issue attachments created by integrations).
assetsRoutes.post(assetPaths.genericAssets, async c =>
  createdResponse(
    c,
    await createGenericAsset(getDb(), c.get('actor'), c.req.param('slug'), await optionalJson(c)),
    workspaceContent(c)
  )
)
assetsRoutes.get(assetPaths.genericAsset, async c =>
  c.json(await getGenericAsset(getDb(), c.get('actor'), c.req.param('slug'), idParam(c, 'assetId')))
)
assetsRoutes.patch(assetPaths.genericAsset, async c => {
  await updateGenericAsset(getDb(), bucket(), c.get('actor'), c.req.param('slug'), idParam(c, 'assetId'))
  return c.body(null, 204)
})

// -------------------------------------------------------------------------------------- project assets
// PD-0460
assetsRoutes.post(assetPaths.projectEntityAssets, async c =>
  createdResponse(
    c,
    await assets.createProjectAsset(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      idParam(c, 'projectId'),
      await optionalJson(c)
    ),
    projectContent(c)
  )
)
// PD-0465
assetsRoutes.post(assetPaths.projectEntityAssetsBulk, async c => {
  await assets.createProjectBulkAsset(
    getDb(),
    c.get('actor'),
    c.req.param('slug'),
    idParam(c, 'projectId'),
    idParam(c, 'entityId'),
    await optionalJson(c)
  )
  return c.body(null, 204)
})
assetsRoutes.put(assetPaths.projectEntityAssetContent, async c =>
  c.json(
    await assets.uploadAssetContent(getDb(), bucket(), c.get('actor'), idParam(c, 'assetId'), c.req.raw, {
      slug: c.req.param('slug'),
      projectId: idParam(c, 'projectId')
    })
  )
)
// PD-0463, 0470
assetsRoutes.get(assetPaths.projectEntityAsset, async c => {
  const { asset, object } = await assets.getProjectAsset(
    getDb(),
    bucket(),
    c.get('actor'),
    c.req.param('slug'),
    idParam(c, 'projectId'),
    idParam(c, 'assetId')
  )
  return assets.streamAsset(asset, object, disposition(c))
})
assetsRoutes.get(assetPaths.projectEntityAssetDownload, async c => {
  const { asset, object } = await assets.getProjectAssetDownload(
    getDb(),
    bucket(),
    c.get('actor'),
    c.req.param('slug'),
    idParam(c, 'projectId'),
    idParam(c, 'assetId')
  )
  return assets.streamAsset(asset, object, 'attachment')
})
// PD-0461
assetsRoutes.patch(assetPaths.projectEntityAsset, async c => {
  await assets.updateProjectAsset(
    getDb(),
    bucket(),
    c.get('actor'),
    c.req.param('slug'),
    idParam(c, 'projectId'),
    idParam(c, 'assetId'),
    await optionalJson(c)
  )
  return c.body(null, 204)
})
// PD-0462
assetsRoutes.delete(assetPaths.projectEntityAsset, async c => {
  await assets.deleteProjectAsset(
    getDb(),
    c.get('actor'),
    c.req.param('slug'),
    idParam(c, 'projectId'),
    idParam(c, 'assetId')
  )
  return c.body(null, 204)
})

// ----------------------------------------------------------------------- legacy multipart file assets
async function readForm(c: Context) {
  requireLength(c, 11 * 1024 * 1024)
  try {
    return await c.req.formData()
  } catch {
    throw new ServiceError(400, 'INVALID_ASSET', 'Expected a multipart file')
  }
}
// PD-0435
assetsRoutes.post(assetPaths.fileAssets, async c =>
  c.json(await createFileAsset(getDb(), bucket(), c.get('actor'), c.req.param('slug'), await readForm(c)), 201)
)
// PD-0434
assetsRoutes.get(assetPaths.fileAsset, async c =>
  c.json(await getFileAsset(getDb(), c.get('actor'), c.req.param('slug'), c.req.param('assetKey')))
)
// PD-0436
assetsRoutes.delete(assetPaths.fileAsset, async c => {
  await deleteFileAsset(getDb(), c.get('actor'), c.req.param('slug'), c.req.param('assetKey'))
  return c.body(null, 204)
})
// PD-0437
assetsRoutes.post(assetPaths.fileAssetRestore, async c => {
  await restoreFileAsset(getDb(), c.get('actor'), c.req.param('slug'), c.req.param('assetKey'))
  return c.body(null, 204)
})

// ------------------------------------------------------------------------------------------ user assets
/** Mount at `/assets` below the API base path. Only the static route is public. */
export const userAssetsRoutes = new Hono<ApiEnv>({ strict: false })
const userContent = () => `${linkto.apiV1}/assets/user-assets/:assetId/content`

// PD-0446, 0050, 0055
userAssetsRoutes.post(assetPaths.userAssets, authenticate, async c =>
  createdResponse(c, await assets.createUserAssets(getDb(), c.get('actor'), await optionalJson(c)), userContent())
)
userAssetsRoutes.put(assetPaths.userAssetContent, authenticate, async c =>
  c.json(await assets.uploadAssetContent(getDb(), bucket(), c.get('actor'), idParam(c, 'assetId'), c.req.raw))
)
// PD-0447, 0051, 0056
userAssetsRoutes.patch(assetPaths.userAsset, authenticate, async c => {
  await assets.updateUserAssets(getDb(), bucket(), c.get('actor'), idParam(c, 'assetId'), await optionalJson(c))
  return c.body(null, 204)
})
// PD-0448, 0052, 0057
userAssetsRoutes.delete(assetPaths.userAsset, authenticate, async c => {
  await assets.deleteUserAssets(getDb(), c.get('actor'), idParam(c, 'assetId'))
  return c.body(null, 204)
})
// PD-0457: avatars, covers and logos render in <img> without a session.
userAssetsRoutes.get(assetPaths.staticAsset, async c => {
  const { asset, object } = await assets.getStaticFileAsset(getDb(), bucket(), idParam(c, 'assetId'))
  const { name, type } = asset.attributes as { name?: string; type?: string }
  return objectResponse(object, {
    disposition: 'inline',
    filename: name,
    contentType: type,
    cache: 'public, max-age=300'
  })
})
// PD-0439, 0438, 0440
userAssetsRoutes.post(assetPaths.userFileAssets, authenticate, async c =>
  c.json(await createUserFileAssets(getDb(), bucket(), c.get('actor'), await readForm(c)), 201)
)
userAssetsRoutes.get(assetPaths.userFileAsset, authenticate, async c =>
  c.json(await getUserAssets(getDb(), c.get('actor'), c.req.param('assetKey')))
)
userAssetsRoutes.delete(assetPaths.userFileAsset, authenticate, async c => {
  await deleteUserFileAssets(getDb(), c.get('actor'), c.req.param('assetKey'))
  return c.body(null, 204)
})

export default userAssetsRoutes
