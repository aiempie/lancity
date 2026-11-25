import type { InfraEnv } from '@/server/common/env'

export type JobMessage<T = unknown> = {
  type: string
  payload?: T
  delaySeconds?: number
  /**
   * Stable id of this job. `enqueueJob` assigns one when missing and Queues redeliver the same body, so handlers use
   * it as an idempotency key. Fan-out jobs derive their ids from the parent id (`<parent>:<suffix>`), so a parent
   * that runs twice enqueues the same children and they are skipped the second time.
   */
  id?: string
}
export type JobMeta = { jobId?: string }
export type JobHandler<T = unknown> = (payload: T, env: InfraEnv, meta?: JobMeta) => Promise<void> | void
export type ScheduledHandler = (env: InfraEnv, scheduledTime: Date) => Promise<void> | void

const handlers = new Map<string, JobHandler<never>>()
const schedules: { cron: string; name: string; run: ScheduledHandler }[] = []
let registryLoaded: Promise<void> | undefined

/** Register the handler of a job type. Registering the same type again replaces it. */
export function registerJobHandler<T = unknown>(type: string, handler: JobHandler<T>): void {
  handlers.set(type, handler as JobHandler<never>)
}

/**
 * Register a periodic job. `cron` is a 5-field UTC expression (wildcard, step, single value, list or range).
 * The Worker has one 5-minute Cron Trigger, so the expression must fire on 5-minute boundaries.
 */
export function registerScheduled(cron: string, run: ScheduledHandler, name = cron): void {
  validateCron(cron)
  if (!schedules.some(s => s.cron === cron && s.name === name)) schedules.push({ cron, name, run })
}

/** Load every `src/server/<domain>/jobs.ts` once (see job-registry.ts). */
export function loadJobRegistry(): Promise<void> {
  registryLoaded ??= import('@/server/common/job-registry').then(m => m.registerAllJobs())
  return registryLoaded
}

/** Run one job through its registered handler. Throws when the type is unknown or the handler fails. */
export async function dispatchJob(env: InfraEnv, message: JobMessage): Promise<void> {
  const handler = handlers.get(message.type)
  if (!handler) throw new UnknownJobError(message.type)
  await handler(message.payload as never, env, { jobId: message.id })
}

export class UnknownJobError extends Error {
  constructor(readonly type: string) {
    super(`No handler registered for job type "${type}"`)
    this.name = 'UnknownJobError'
  }
}

/**
 * Push a background job. Uses the JOBS_QUEUE Cloudflare Queue when bound.
 * Without a queue (local dev) it runs in `ctx.waitUntil` when `ctx` is given, otherwise inline.
 * `delaySeconds` is honoured by Queues only; the fallback runs immediately.
 */
export async function enqueueJob(
  env: InfraEnv,
  input: JobMessage,
  ctx?: { waitUntil(promise: Promise<unknown>): void }
): Promise<void> {
  const message: JobMessage = { ...input, id: input.id ?? crypto.randomUUID() }
  if (env.JOBS_QUEUE) {
    const { delaySeconds, ...body } = message
    await env.JOBS_QUEUE.send(body, delaySeconds ? { delaySeconds } : undefined)
    return
  }
  const run = loadJobRegistry().then(() => dispatchJob(env, message))
  if (ctx) {
    ctx.waitUntil(run.catch(error => logJobError(message.type, error)))
    return
  }
  await run
}

/** Queue consumer: dispatch each message, retry failures with backoff, drop unknown types. */
export async function handleQueueBatch(batch: MessageBatch<JobMessage>, env: InfraEnv): Promise<void> {
  await loadJobRegistry()
  for (const message of batch.messages) {
    try {
      await dispatchJob(env, message.body)
      message.ack()
    } catch (error) {
      logJobError(message.body?.type, error)
      if (error instanceof UnknownJobError) message.ack()
      else message.retry({ delaySeconds: Math.min(30 * 2 ** (message.attempts - 1), 3600) })
    }
  }
}

/** Cron consumer: run every scheduled handler whose expression matches the trigger time (UTC). */
export async function handleScheduledEvent(
  controller: { scheduledTime: number },
  env: InfraEnv,
  ctx: { waitUntil(promise: Promise<unknown>): void }
): Promise<void> {
  await loadJobRegistry()
  const time = new Date(controller.scheduledTime)
  for (const schedule of schedules) {
    if (!cronMatches(schedule.cron, time)) continue
    ctx.waitUntil(
      Promise.resolve()
        .then(() => schedule.run(env, time))
        .catch(error => logJobError(`scheduled:${schedule.name}`, error))
    )
  }
}

function logJobError(label: string | undefined, error: unknown): void {
  console.error(JSON.stringify({ level: 'error', label: `job:${label}`, message: error instanceof Error ? error.message : String(error) }))
}

const FIELD_RANGES: [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6]
]

function validateCron(cron: string): void {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error(`Invalid cron expression "${cron}"`)
  fields.forEach((field, i) => {
    if (!fieldValues(field, FIELD_RANGES[i]).size) throw new Error(`Invalid cron field "${field}" in "${cron}"`)
  })
}

function fieldValues(field: string, [min, max]: [number, number]): Set<number> {
  const values = new Set<number>()
  for (const part of field.split(',')) {
    const [range, stepText] = part.split('/')
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isInteger(step) || step < 1) return new Set()
    let [from, to] = [min, max]
    if (range !== '*') {
      const [a, b] = range.split('-')
      from = Number(a)
      to = b === undefined ? (stepText === undefined ? from : max) : Number(b)
    }
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < min || to > max || from > to) return new Set()
    for (let v = from; v <= to; v += step) values.add(v)
  }
  return values
}

/** Match a 5-field cron expression against a date in UTC. Day-of-month and weekday are ANDed. */
export function cronMatches(cron: string, date: Date): boolean {
  const fields = cron.trim().split(/\s+/)
  const parts = [date.getUTCMinutes(), date.getUTCHours(), date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCDay()]
  return fields.every((field, i) => fieldValues(field, FIELD_RANGES[i]).has(parts[i]))
}
