import { Hono } from 'hono'
import { apiV1Routes } from '@/data/linkto'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import { ServiceError } from '@/server/common/errors'
import { presentNotificationPreference } from '@/server/notification/presenters'
import {
  deleteNotification,
  getNotification,
  getNotificationPreferences,
  listNotificationItems,
  markAllNotificationsRead,
  presentNotifications,
  setNotificationState,
  snoozeNotification,
  unreadNotificationCounts,
  updateNotificationPreferences
} from '@/server/notification/service'
import type { ApiEnv } from '@/types/api/schema'
import {
  notificationListQuerySchema,
  notificationMarkAllSchema,
  notificationPreferencesUpdateSchema,
  notificationSnoozeSchema
} from '@/types/notification/schema'
import { reportingIdSchema } from '@/types/reporting/schema'

const present = async (row: Parameters<typeof presentNotifications>[1][number]) =>
  (await presentNotifications(getDb(), [row]))[0]

export const notificationsRoutes = new Hono<ApiEnv>()
notificationsRoutes.use('*', authenticate)
// PD-0701 list
notificationsRoutes.get(apiV1Routes.notifications, async c =>
  c.json(
    await listNotificationItems(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(notificationListQuerySchema, c.req.query()),
      c.req.query()
    )
  )
)
// PD-0708. Registered before `/:notificationId` so "unread" is not read as an id.
notificationsRoutes.get(apiV1Routes.notificationsUnread, async c =>
  c.json(await unreadNotificationCounts(getDb(), c.get('actor'), c.req.param('slug')!))
)
// PD-0709
notificationsRoutes.post(apiV1Routes.notificationsMarkAllRead, async c => {
  const raw = await c.req.text()
  let body: unknown = {}
  if (raw) {
    try {
      body = JSON.parse(raw)
    } catch {
      throw new ServiceError(400, 'INVALID_JSON', 'Request body must be valid JSON')
    }
  }
  await markAllNotificationsRead(
    getDb(),
    c.get('actor'),
    c.req.param('slug')!,
    parseInput(notificationMarkAllSchema, body)
  )
  return c.json({ message: 'Successful' })
})
const notificationId = (c: { req: { param(name: string): string | undefined } }) =>
  parseInput(reportingIdSchema, c.req.param('notificationId'))
// PD-0699 retrieve
notificationsRoutes.get(apiV1Routes.notification, async c =>
  c.json(await present(await getNotification(getDb(), c.get('actor'), c.req.param('slug')!, notificationId(c))))
)
// PD-0698 destroy
notificationsRoutes.delete(apiV1Routes.notification, async c => {
  await deleteNotification(getDb(), c.get('actor'), c.req.param('slug')!, notificationId(c))
  return c.body(null, 204)
})
// PD-0703 partial_update (only `snoozed_till` is writable)
notificationsRoutes.patch(apiV1Routes.notification, async c => {
  const input = await readJson(c, notificationSnoozeSchema)
  const row = await snoozeNotification(
    getDb(),
    c.get('actor'),
    c.req.param('slug')!,
    notificationId(c),
    input.snoozed_till
  )
  return c.json(await present(row))
})
// PD-0704 to PD-0707
for (const [method, key, field, enabled] of [
  ['post', apiV1Routes.notificationRead, 'read', true],
  ['delete', apiV1Routes.notificationRead, 'read', false],
  ['post', apiV1Routes.notificationArchive, 'archive', true],
  ['delete', apiV1Routes.notificationArchive, 'archive', false]
] as const) {
  notificationsRoutes[method](key, async c =>
    c.json(
      await present(
        await setNotificationState(getDb(), c.get('actor'), c.req.param('slug')!, notificationId(c), field, enabled)
      )
    )
  )
}

export const notificationPreferencesRoutes = new Hono<ApiEnv>()
notificationPreferencesRoutes.use('*', authenticate)
// PD-0710
notificationPreferencesRoutes.get(apiV1Routes.notificationPreferences, async c =>
  c.json(presentNotificationPreference(await getNotificationPreferences(getDb(), c.get('actor'))))
)
// PD-0711
notificationPreferencesRoutes.patch(apiV1Routes.notificationPreferences, async c =>
  c.json(
    presentNotificationPreference(
      await updateNotificationPreferences(
        getDb(),
        c.get('actor'),
        await readJson(c, notificationPreferencesUpdateSchema)
      )
    )
  )
)
