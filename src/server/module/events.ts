import { outboxStatement, publishOutbox } from '@/server/common/outbox'
import type { LancityDb } from '@/types/database/schema'
import { emitProjectEvent, MODEL_ACTIVITY_JOB } from '@/server/project/events'

export type ModuleIssueEvent = {
  type: 'module.activity.created' | 'module.activity.deleted'
  issueId: number
  moduleId: number
  /** Required for `deleted`: the activity text names the module the issue left. */
  moduleName?: string | null
}

/** Batch these events with the corresponding assignment writes. */
export function moduleActivityOutbox(db: LancityDb, actorId: number, projectId: number, events: ModuleIssueEvent[]) {
  const keys = events.map(() => crypto.randomUUID())
  const statements = events.map((event, index) => outboxStatement(db, keys[index], 'issue.activity', {
    type: event.type, requestedData: { module_id: event.moduleId },
    currentInstance: event.type === 'module.activity.deleted' ? { module_name: event.moduleName ?? '' } : null,
    issueId: event.issueId, actorId, projectId, epoch: Math.floor(Date.now() / 1000), notification: true
  }))
  return { keys, statements }
}
export async function publishModuleActivities(db: LancityDb, keys: string[]) {
  for (const key of keys) await publishOutbox(db, key)
}

/** Plane `model_activity.delay(model_name="module", ...)`: webhook delivery of a module change. */
export function emitModuleModelActivity(input: {
  moduleId: number
  requestedData: unknown
  currentInstance: unknown
  actorId: number
  slug: string
}) {
  return emitProjectEvent(MODEL_ACTIVITY_JOB, {
    model_name: 'module',
    model_id: input.moduleId,
    requested_data: input.requestedData,
    current_instance: input.currentInstance,
    actor_id: input.actorId,
    slug: input.slug
  })
}
