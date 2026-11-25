import { apiV1Routes } from '@/data/linkto'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput } from '@/server/api/v1/validation'
import { ServiceError } from '@/server/common/errors'
import { getEnv } from '@/server/common/env'
import { getImport, listImports, startImport } from '@/server/import/service'
import type { ApiEnv } from '@/types/api/schema'
import { MAX_IMPORT_BYTES } from '@/types/reporting/p3-export-schema'
import { reportingIdSchema } from '@/types/reporting/schema'

// Project level issue imports. Mount at `linkto.apiProject`.
const paths = { importIssues: apiV1Routes.importIssues, importJob: apiV1Routes.importIssue }

const uploadLimit = bodyLimit({
  maxSize: MAX_IMPORT_BYTES + 1024 * 1024,
  onError: () => {
    throw new ServiceError(413, 'FILE_TOO_LARGE', `The file exceeds ${MAX_IMPORT_BYTES / 1024 / 1024} MiB`)
  }
})

export const importsRoutes = new Hono<ApiEnv>()
importsRoutes.use('*', authenticate)
const projectId = (c: { req: { param(name: string): string | undefined } }) => parseInput(reportingIdSchema, c.req.param('projectId'))

importsRoutes.post(paths.importIssues, uploadLimit, async c => {
  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    throw new ServiceError(400, 'INVALID_FORM', 'Send the file as multipart form data')
  }
  const file = form.get('file')
  if (!(file instanceof File)) throw new ServiceError(400, 'FILE_REQUIRED', 'The "file" field is required')
  const source = form.get('source')
  return c.json(
    await startImport(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      projectId(c),
      file,
      typeof source === 'string' ? { source } : {},
      getEnv().ASSET_BUCKET
    ),
    202
  )
})
importsRoutes.get(paths.importIssues, async c =>
  c.json(await listImports(getDb(), c.get('actor'), c.req.param('slug')!, projectId(c), new URL(c.req.url).searchParams))
)
importsRoutes.get(paths.importJob, async c =>
  c.json(
    await getImport(getDb(), c.get('actor'), c.req.param('slug')!, projectId(c), parseInput(reportingIdSchema, c.req.param('importId')))
  )
)

export default importsRoutes
