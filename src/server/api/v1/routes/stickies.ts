import { Hono } from 'hono'
import { apiV1Routes } from '@/data/linkto'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import { presentSticky } from '@/server/sticky/presenters'
import { createSticky, deleteSticky, getSticky, listStickiesPage, updateSticky } from '@/server/sticky/service'
import type { ApiEnv } from '@/types/api/schema'
import { stickyApiInputSchema, stickyListQuerySchema } from '@/types/notification/p2-notification-schema'
import { reportingIdSchema } from '@/types/reporting/schema'

export const stickiesRoutes = new Hono<ApiEnv>()
stickiesRoutes.use('*', authenticate)
const stickyId = (c: { req: { param(name: string): string | undefined } }) =>
  parseInput(reportingIdSchema, c.req.param('stickyId'))
// PD-0262, PD-0935 list
stickiesRoutes.get(apiV1Routes.stickies, async c =>
  c.json(
    await listStickiesPage(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(stickyListQuerySchema, c.req.query()).query,
      c.req.query()
    )
  )
)
// PD-0261, PD-0934 create
stickiesRoutes.post(apiV1Routes.stickies, async c =>
  c.json(
    presentSticky(
      await createSticky(getDb(), c.get('actor'), c.req.param('slug')!, await readJson(c, stickyApiInputSchema))
    ),
    201
  )
)
// PD-0264, PD-0932 retrieve
stickiesRoutes.get(apiV1Routes.sticky, async c =>
  c.json(presentSticky(await getSticky(getDb(), c.get('actor'), c.req.param('slug')!, stickyId(c))))
)
// PD-0259 (PUT), PD-0265, PD-0937 (PATCH): DRF `update` and `partial_update` only touch the fields sent.
for (const method of ['put', 'patch'] as const) {
  stickiesRoutes[method](apiV1Routes.sticky, async c =>
    c.json(
      presentSticky(
        await updateSticky(
          getDb(),
          c.get('actor'),
          c.req.param('slug')!,
          stickyId(c),
          await readJson(c, stickyApiInputSchema)
        )
      )
    )
  )
}
// PD-0266, PD-0938 destroy
stickiesRoutes.delete(apiV1Routes.sticky, async c => {
  await deleteSticky(getDb(), c.get('actor'), c.req.param('slug')!, stickyId(c))
  return c.body(null, 204)
})
