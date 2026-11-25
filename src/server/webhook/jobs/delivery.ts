import { and, eq, getTableColumns, inArray, isNull } from 'drizzle-orm'
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@/db/schema'
import { user } from '@/db/schema/auth'
import { issueActivities, issueAssignees, issueComments, issueLabels, issues, labels, states } from '@/db/schema/issue'
import { webhookLogs, webhooks } from '@/db/schema/integration'
import { cycleIssues, cycles, intakeIssues, moduleIssues, moduleMembers, modules } from '@/db/schema/planning'
import { projects, workspaces } from '@/db/schema/workspace'
import type { InfraEnv } from '@/server/common/env'
import { logException } from '@/server/common/exception-logger'
import { UrlSecurityError, type HostResolver } from '@/server/common/ip-address'
import { enqueueJob } from '@/server/common/jobs'
import { linkEmail } from '@/server/common/mail-templates'
import { pinnedFetch, readCappedBody } from '@/server/common/url-security'
import { webhookAllowedHosts, webhookAllowedIps } from '@/server/webhook/presenters'
import { ISSUE_COMMENT_EXCLUDE, serializeModelRow, serializeStateLite, serializeUserLite } from '@/server/webhook/serializers'
import type { LancityDb } from '@/types/database/schema'
import {
  modelActivityJobSchema,
  webhookActivityJobSchema,
  webhookDispatchJobSchema,
  webhookSendJobSchema,
  type ModelActivityJob,
  type WebhookActivityJob,
  type WebhookDeactivationEmailJob,
  type WebhookDispatchJob,
  type WebhookSendJob
} from '@/types/integration/p3-integration-schema'

/** Job types of the webhook domain. `activity`, `modelActivity` and `dispatch` are enqueued by other domains. */
export const WEBHOOK_JOB = {
  send: 'webhook.send',
  activity: 'webhook.activity',
  modelActivity: 'webhook.model_activity',
  dispatch: 'webhook.dispatch',
  deactivationEmail: 'webhook.deactivation_email'
} as const

/** Plane `webhook_send_task`: `max_retries=5`. After the sixth failed attempt the webhook is deactivated. */
export const MAX_WEBHOOK_RETRIES = 5
/** Celery `retry_backoff=600` with `retry_jitter`: the next attempt waits a random 0 to 600 seconds. */
const RETRY_BACKOFF_MAX_SECONDS = 600
/** Plane limits on how much of a response body is read and logged. */
const MAX_WEBHOOK_RESPONSE_BYTES = 10 * 1024
const MAX_WEBHOOK_RESPONSE_SECONDS = 30
/** Queue messages are limited to 128 KB. Larger event data is reloaded by the send job. */
const MAX_INLINE_DATA_CHARS = 90_000

export type DeliveryDeps = { resolver?: HostResolver }

const makeDb = (env: InfraEnv) => drizzle(env.DB, { schema }) as unknown as LancityDb
const siteOf = (env: InfraEnv) =>
  typeof env.BETTER_AUTH_URL === 'string' ? env.BETTER_AUTH_URL.replace(/\/$/, '') : ''

// ------------------------------------------------------------------ model data (Plane `get_model_data`)

const MODELS = {
  project: projects,
  issue: issues,
  cycle: cycles,
  module: modules,
  cycle_issue: cycleIssues,
  module_issue: moduleIssues,
  issue_comment: issueComments,
  intake_issue: intakeIssues
} as const
type ModelEvent = keyof typeof MODELS

const userLite = serializeUserLite

/**
 * Plane `get_issue_prefetches`: labels and assignees of the given issues in two queries instead of Django's
 * prefetch. Soft-deleted links are skipped.
 */
export async function getIssuePrefetches(db: LancityDb, issueIds: number[]) {
  const labelsByIssue = new Map<number, { id: number; name: string; color: string }[]>()
  const assigneesByIssue = new Map<number, ReturnType<typeof userLite>[]>()
  if (!issueIds.length) return { labelsByIssue, assigneesByIssue }
  const [labelRows, assigneeRows] = await Promise.all([
    db
      .select({ issueId: issueLabels.issueId, id: labels.id, name: labels.name, color: labels.color })
      .from(issueLabels)
      .innerJoin(labels, eq(labels.id, issueLabels.labelId))
      .where(and(inArray(issueLabels.issueId, issueIds), isNull(issueLabels.deletedAt), isNull(labels.deletedAt))),
    db
      .select({
        issueId: issueAssignees.issueId,
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        displayUsername: user.displayUsername,
        image: user.image
      })
      .from(issueAssignees)
      .innerJoin(user, eq(user.id, issueAssignees.assigneeId))
      .where(and(inArray(issueAssignees.issueId, issueIds), isNull(issueAssignees.deletedAt)))
  ])
  for (const { issueId, ...label } of labelRows)
    labelsByIssue.set(issueId, [...(labelsByIssue.get(issueId) ?? []), label])
  for (const { issueId, ...assignee } of assigneeRows) {
    assigneesByIssue.set(issueId, [...(assigneesByIssue.get(issueId) ?? []), userLite(assignee)])
  }
  return { labelsByIssue, assigneesByIssue }
}

/**
 * Plane `IssueExpandSerializer` on top of the `__all__` fields: nested `state`, the `cycle` and `module` the issue
 * belongs to, expanded `labels` and `assignees`, and `description` (the JSON description).
 */
async function expandIssues(db: LancityDb, data: Record<string, unknown>[]) {
  if (!data.length) return
  const ids = data.map(row => row.id as number)
  const stateIds = [...new Set(data.map(row => row.state).filter((id): id is number => typeof id === 'number'))]
  const [{ labelsByIssue, assigneesByIssue }, stateRows, cycleRows, moduleRows] = await Promise.all([
    getIssuePrefetches(db, ids),
    stateIds.length
      ? db.select({ id: states.id, name: states.name, color: states.color, group: states.group }).from(states).where(inArray(states.id, stateIds))
      : [],
    db
      .select({ issueId: cycleIssues.issueId, cycle: cycles })
      .from(cycleIssues)
      .innerJoin(cycles, eq(cycles.id, cycleIssues.cycleId))
      .where(and(inArray(cycleIssues.issueId, ids), isNull(cycleIssues.deletedAt), isNull(cycles.deletedAt))),
    db
      .select({ issueId: moduleIssues.issueId, module: modules })
      .from(moduleIssues)
      .innerJoin(modules, eq(modules.id, moduleIssues.moduleId))
      .where(and(inArray(moduleIssues.issueId, ids), isNull(moduleIssues.deletedAt), isNull(modules.deletedAt)))
  ])
  const stateById = new Map(stateRows.map(row => [row.id, serializeStateLite(row)]))
  const cycleByIssue = new Map(cycleRows.map(row => [row.issueId, serializeModelRow(cycles, row.cycle)]))
  const moduleByIssue = new Map(moduleRows.map(row => [row.issueId, serializeModelRow(modules, row.module)]))
  for (const row of data) {
    const id = row.id as number
    row.state = typeof row.state === 'number' ? (stateById.get(row.state) ?? null) : null
    row.cycle = cycleByIssue.get(id) ?? null
    row.module = moduleByIssue.get(id) ?? null
    row.labels = labelsByIssue.get(id) ?? []
    row.assignees = assigneesByIssue.get(id) ?? []
    row.description = row.description_json ?? null
  }
}

/** Plane `ModuleSerializer.to_representation`: `members` is the list of member ids. */
async function addModuleMembers(db: LancityDb, data: Record<string, unknown>[]) {
  if (!data.length) return
  const rows = await db
    .select({ moduleId: moduleMembers.moduleId, memberId: moduleMembers.memberId })
    .from(moduleMembers)
    .where(and(inArray(moduleMembers.moduleId, data.map(row => row.id as number)), isNull(moduleMembers.deletedAt)))
  for (const row of data) row.members = rows.filter(item => item.moduleId === row.id).map(item => item.memberId)
}

/**
 * Plane `get_model_data`: the JSON a webhook receives for `event`. Issues carry expanded `labels` and
 * `assignees`. Returns null when the row is gone (Plane's `ObjectDoesNotExist`) or belongs to another workspace.
 * `many` takes a list of ids and returns a list. An unknown event throws, like Plane's `ValueError`.
 */
export async function getModelData(
  db: LancityDb,
  event: string,
  eventId: number | number[],
  options: { many?: boolean; workspaceId?: number } = {}
): Promise<Record<string, unknown> | Record<string, unknown>[] | null> {
  const ids = Array.isArray(eventId) ? eventId : [eventId]
  if (event === 'user') {
    const rows = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        displayUsername: user.displayUsername,
        image: user.image
      })
      .from(user)
      .where(inArray(user.id, ids))
    if (options.many) return rows.map(userLite)
    return rows[0] ? userLite(rows[0]) : null
  }
  const table = MODELS[event as ModelEvent]
  if (!table) throw new Error(`Model not found for event: ${event}`)
  const columns = getTableColumns(table as SQLiteTable) as unknown as Record<string, AnySQLiteColumn>
  const rows = (await db
    .select()
    .from(table as SQLiteTable)
    .where(
      and(
        inArray(columns.id, ids),
        'deletedAt' in columns ? isNull(columns.deletedAt) : undefined,
        options.workspaceId !== undefined && 'workspaceId' in columns
          ? eq(columns.workspaceId, options.workspaceId)
          : undefined
      )
    )) as Record<string, unknown>[]
  if (!options.many && !rows.length) return null
  const exclude = event === 'issue_comment' ? ISSUE_COMMENT_EXCLUDE : []
  const data = rows.map(row => serializeModelRow(table as SQLiteTable, row, exclude))
  if (event === 'issue') await expandIssues(db, data)
  if (event === 'module') await addModuleMembers(db, data)
  if (event === 'intake_issue') {
    // Plane `IntakeIssueSerializer`: `issue_detail` is the expanded issue and `inbox` the intake id.
    const issueIds = [...new Set(data.map(row => row.issue as number))]
    const details = issueIds.length
      ? ((await db.select().from(issues).where(and(inArray(issues.id, issueIds), isNull(issues.deletedAt)))) as Record<string, unknown>[])
      : []
    const expanded = details.map(row => serializeModelRow(issues, row))
    await expandIssues(db, expanded)
    const byId = new Map(expanded.map(row => [row.id as number, row]))
    for (const row of data) {
      row.issue_detail = byId.get(row.issue as number) ?? null
      row.inbox = row.intake ?? null
    }
  }
  return options.many ? data : data[0]
}

// ------------------------------------------------------------------ logs and mail

type LogInput = {
  webhookId: number
  workspaceId: number
  requestMethod: string
  requestHeaders: string
  requestBody: string
  responseStatus: string
  responseHeaders: string
  responseBody: string
  retryCount: number
  eventType: string
}

/** Plane `save_webhook_log`: a failed insert is logged and never breaks the delivery. */
export async function saveWebhookLog(db: LancityDb, input: LogInput): Promise<void> {
  try {
    await db.insert(webhookLogs).values({
      workspaceId: input.workspaceId,
      webhook: input.webhookId,
      eventType: input.eventType,
      requestMethod: input.requestMethod,
      requestHeaders: input.requestHeaders,
      requestBody: input.requestBody,
      responseStatus: input.responseStatus,
      responseHeaders: input.responseHeaders,
      responseBody: input.responseBody,
      retryCount: input.retryCount
    })
  } catch (error) {
    logException(error, { warning: true, context: { label: 'webhook-log' } })
  }
}

/** Plane `send_webhook_deactivation_email`. Failures are logged, not retried, as in Plane. */
export async function sendWebhookDeactivationEmail(env: InfraEnv, job: WebhookDeactivationEmailJob): Promise<void> {
  try {
    const db = makeDb(env)
    const [row] = await db
      .select({ url: webhooks.url, slug: workspaces.slug, email: user.email })
      .from(webhooks)
      .innerJoin(workspaces, eq(workspaces.id, webhooks.workspaceId))
      .innerJoin(user, eq(user.id, job.receiverId))
      .where(eq(webhooks.id, job.webhookId))
      .limit(1)
    if (!row) return
    const site = job.currentSite || siteOf(env)
    const mail = linkEmail(
      'Webhook Deactivated',
      'Webhook deactivated',
      `Webhook ${row.url} has been deactivated due to failed requests.`,
      'View webhook',
      `${site}/${row.slug}/settings/webhooks/${job.webhookId}`
    )
    // `mail` imports `cloudflare:workers`; loading it lazily keeps this module testable in Node.
    const { sendMail } = await import('@/server/common/mail')
    await sendMail({ to: row.email, ...mail }, env)
  } catch (error) {
    logException(error, { warning: true, context: { label: 'webhook-deactivation-email' } })
  }
}

// ------------------------------------------------------------------ delivery (Plane `webhook_send_task`)

/** HMAC-SHA256 hex digest, the `X-Plane-Signature` value. */
export async function signPayload(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))
  return Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('')
}

const ACTIONS: Record<string, string> = { POST: 'create', PATCH: 'update', PUT: 'update', DELETE: 'delete' }

/** Validation failures of the target URL (Plane's `ValueError`). They are final: no retry, no deactivation. */
const isRejectedTarget = (error: unknown) =>
  error instanceof UrlSecurityError || (error instanceof Error && /^Invalid URL/.test(error.message))

/**
 * Send one webhook. A transport error is logged with status 500 and retried by a new `webhook.send` job that
 * carries `retryCount + 1`; after `MAX_WEBHOOK_RETRIES` retries the webhook is deactivated and its creator is
 * emailed. HTTP error statuses are logged but not retried, like Plane. The signature covers the exact bytes sent.
 */
export async function webhookSendTask(env: InfraEnv, input: WebhookSendJob, deps: DeliveryDeps = {}): Promise<void> {
  const job = webhookSendJobSchema.parse(input)
  const db = makeDb(env)
  const [hook] = await db
    .select({
      id: webhooks.id,
      url: webhooks.url,
      secretKey: webhooks.secretKey,
      isActive: webhooks.isActive,
      workspaceId: webhooks.workspaceId,
      createdById: webhooks.createdById
    })
    .from(webhooks)
    .innerJoin(workspaces, eq(workspaces.id, webhooks.workspaceId))
    .where(and(eq(webhooks.id, job.webhookId), eq(workspaces.slug, job.slug), isNull(webhooks.deletedAt)))
    .limit(1)
  // A webhook switched off or deleted while the job waited in the queue must not fire.
  if (!hook || !hook.isActive) return

  let data = job.eventData ?? null
  if (job.eventData === undefined && job.eventRef)
    data = await getModelData(db, job.eventRef.event, job.eventRef.id, { workspaceId: hook.workspaceId })
  const action = ACTIONS[job.action] ?? job.action
  const payload = {
    event: job.event,
    action,
    webhook_id: hook.id,
    workspace_id: hook.workspaceId,
    workspace_slug: job.slug,
    data,
    activity: job.activity ?? null
  }
  const body = JSON.stringify(payload)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Autopilot',
    'X-Plane-Delivery': job.deliveryId ?? crypto.randomUUID(),
    'X-Plane-Event': job.event
  }
  if (hook.secretKey) headers['X-Plane-Signature'] = await signPayload(hook.secretKey, body)
  const log = (fields: Pick<LogInput, 'responseStatus' | 'responseHeaders' | 'responseBody'>) =>
    saveWebhookLog(db, {
      webhookId: hook.id,
      workspaceId: hook.workspaceId,
      requestMethod: action,
      requestHeaders: JSON.stringify(headers),
      requestBody: body,
      retryCount: job.retryCount,
      eventType: job.event,
      ...fields
    })

  try {
    const response = await pinnedFetch('POST', hook.url, {
      allowedIps: webhookAllowedIps(env),
      allowedHosts: webhookAllowedHosts(env),
      headers,
      body,
      timeout: 30,
      resolver: deps.resolver
    })
    // Only the start of the response body is kept for the log.
    const { content, truncated } = await readCappedBody(
      response,
      MAX_WEBHOOK_RESPONSE_BYTES,
      MAX_WEBHOOK_RESPONSE_SECONDS
    )
    await log({
      responseStatus: String(response.status),
      responseHeaders: JSON.stringify(Object.fromEntries(response.headers)),
      responseBody: new TextDecoder().decode(content) + (truncated ? '... [truncated]' : '')
    })
  } catch (error) {
    if (isRejectedTarget(error)) {
      await log({
        responseStatus: '400',
        responseHeaders: '',
        responseBody: `Webhook URL rejected: ${(error as Error).message}`
      })
      return
    }
    await log({
      responseStatus: '500',
      responseHeaders: '',
      responseBody: error instanceof Error ? error.message : String(error)
    })
    if (job.retryCount >= MAX_WEBHOOK_RETRIES) {
      await db.update(webhooks).set({ isActive: false }).where(eq(webhooks.id, hook.id))
      if (hook.createdById) {
        await enqueueJob(env, {
          type: WEBHOOK_JOB.deactivationEmail,
          payload: {
            webhookId: hook.id,
            receiverId: hook.createdById,
            currentSite: job.currentSite,
            reason: error instanceof Error ? error.message : String(error)
          },
          id: `${headers['X-Plane-Delivery']}:deactivated`
        })
      }
      return
    }
    await enqueueJob(env, {
      type: WEBHOOK_JOB.send,
      payload: { ...job, deliveryId: headers['X-Plane-Delivery'], retryCount: job.retryCount + 1 },
      // Stable per attempt: a redelivery of this attempt enqueues the same retry, which is claimed once.
      id: `${headers['X-Plane-Delivery']}:retry:${job.retryCount + 1}`,
      delaySeconds: Math.floor(Math.random() * (RETRY_BACKOFF_MAX_SECONDS + 1))
    })
  }
}

// ------------------------------------------------------------------ fan-out (Plane `webhook_activity`, `model_activity`)

/** The boolean flag of `webhooks` an event type is gated by. Events without a flag go to every active webhook. */
const EVENT_FLAGS: Record<string, 'project' | 'issue' | 'module' | 'cycle' | 'issueComment'> = {
  project: 'project',
  issue: 'issue',
  module: 'module',
  module_issue: 'module',
  cycle: 'cycle',
  cycle_issue: 'cycle',
  issue_comment: 'issueComment'
}

async function activeWebhooks(db: LancityDb, slug: string, event: string) {
  const flag = EVENT_FLAGS[event]
  return db
    .select({ id: webhooks.id, workspaceId: webhooks.workspaceId })
    .from(webhooks)
    .innerJoin(workspaces, eq(workspaces.id, webhooks.workspaceId))
    .where(
      and(
        eq(workspaces.slug, slug),
        isNull(workspaces.deletedAt),
        eq(webhooks.isActive, true),
        isNull(webhooks.deletedAt),
        flag ? eq(webhooks[flag], true) : undefined
      )
    )
}

/**
 * Plane `webhook_activity`: queue one `webhook.send` job for every active webhook of the workspace that
 * subscribed to `event`. A missing object or actor ends the task silently (race with a delete).
 */
export async function webhookActivity(env: InfraEnv, input: WebhookActivityJob, jobId?: string): Promise<void> {
  const job = webhookActivityJobSchema.parse(input)
  const db = makeDb(env)
  const targets = await activeWebhooks(db, job.slug, job.event)
  if (!targets.length) return
  const workspaceId = targets[0].workspaceId
  const eventData =
    job.verb === 'deleted' ? { id: job.event_id } : await getModelData(db, job.event, job.event_id, { workspaceId })
  if (!eventData) return
  const actor = await getModelData(db, 'user', job.actor_id)
  if (!actor) return
  const activity = {
    field: job.field ?? null,
    new_value: job.new_value ?? null,
    old_value: job.old_value ?? null,
    actor,
    old_identifier: job.old_identifier ?? null,
    new_identifier: job.new_identifier ?? null
  }
  const inline = JSON.stringify([eventData, activity]).length <= MAX_INLINE_DATA_CHARS
  for (const target of targets) {
    const send: WebhookSendJob = {
      webhookId: target.id,
      slug: job.slug,
      event: job.event,
      action: job.verb,
      currentSite: siteOf(env),
      activity: inline ? activity : { ...activity, old_value: null, new_value: null },
      deliveryId: crypto.randomUUID(),
      retryCount: 0,
      ...(inline || job.verb === 'deleted' ? { eventData } : { eventRef: { event: job.event, id: job.event_id } })
    }
    await enqueueJob(env, { type: WEBHOOK_JOB.send, payload: send, id: jobId ? `${jobId}:send:${target.id}` : undefined })
  }
}

function parseObject(value: unknown): Record<string, unknown> | null {
  const parsed = typeof value === 'string' ? (value ? JSON.parse(value) : null) : value
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
}

/** Deep equality for JSON values, independent of key order (Python `!=` on dicts). */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  return (
    keysA.length === keysB.length && keysA.every(key => key in b && jsonEqual((a as never)[key], (b as never)[key]))
  )
}

/**
 * Plane `model_activity`: with no `current_instance` the object was created. Otherwise every key of
 * `requested_data` that exists in `current_instance` with a different value becomes a `webhook.activity`
 * job with `verb: "updated"`.
 */
export async function modelActivity(env: InfraEnv, input: ModelActivityJob, jobId?: string): Promise<void> {
  const job = modelActivityJobSchema.parse(input)
  const base = { event: job.model_name, actor_id: job.actor_id, slug: job.slug, event_id: job.model_id }
  const current = parseObject(job.current_instance)
  if (!current) {
    await enqueueJob(env, {
      type: WEBHOOK_JOB.activity,
      payload: { ...base, verb: 'created', field: null, old_value: null, new_value: null },
      id: jobId ? `${jobId}:created` : undefined
    })
    return
  }
  const requested = parseObject(job.requested_data) ?? {}
  for (const [key, requestedValue] of Object.entries(requested)) {
    if (!(key in current) || jsonEqual(current[key], requestedValue)) continue
    await enqueueJob(env, {
      type: WEBHOOK_JOB.activity,
      payload: {
        ...base,
        verb: 'updated',
        field: key,
        old_value: current[key] ?? null,
        new_value: requestedValue ?? null
      },
      id: jobId ? `${jobId}:updated:${key}` : undefined
    })
  }
}

const IN_CHUNK = 80

/**
 * `webhook.dispatch` from the issue activity job (`webhook: true`): turn stored `issue_activities` rows into
 * `webhook.activity` jobs. `issue.activity.*` maps to the `issue` event, `comment.activity.*` to `issue_comment`.
 * Other activity types (cycle, module, link, ...) have no webhook event in Plane and are ignored.
 */
export async function dispatchIssueActivity(env: InfraEnv, input: WebhookDispatchJob, jobId?: string): Promise<void> {
  const job = webhookDispatchJobSchema.parse(input)
  const [prefix, kind, verb] = job.type.split('.')
  const event = prefix === 'issue' ? 'issue' : prefix === 'comment' ? 'issue_comment' : null
  if (!event || kind !== 'activity' || !['created', 'updated', 'deleted'].includes(verb) || !job.actorId) return
  const db = makeDb(env)
  const [workspace] = await db
    .select({ slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.id, job.workspaceId))
    .limit(1)
  if (!workspace) return
  const rows: (typeof issueActivities.$inferSelect)[] = []
  for (let i = 0; i < job.activityIds.length; i += IN_CHUNK) {
    rows.push(
      ...(await db
        .select()
        .from(issueActivities)
        .where(
          and(
            inArray(issueActivities.id, job.activityIds.slice(i, i + IN_CHUNK)),
            eq(issueActivities.workspaceId, job.workspaceId)
          )
        ))
    )
  }
  const base = { event, verb, actor_id: job.actorId, slug: workspace.slug }
  const targetIds = (row: { issueId: number | null; issueCommentId: number | null }) =>
    event === 'issue' ? row.issueId : row.issueCommentId
  if (verb === 'updated') {
    for (const row of rows) {
      const eventId = targetIds(row)
      if (!row.field || !eventId) continue
      await enqueueJob(env, {
        type: WEBHOOK_JOB.activity,
        payload: {
          ...base,
          event_id: eventId,
          field: row.field,
          old_value: row.oldValue,
          new_value: row.newValue,
          old_identifier: row.oldIdentifier,
          new_identifier: row.newIdentifier
        },
        id: jobId ? `${jobId}:row:${row.id}` : undefined
      })
    }
    return
  }
  const ids = new Set<number>(event === 'issue' && job.issueId ? [job.issueId] : [])
  if (event === 'issue_comment') for (const row of rows) if (row.issueCommentId) ids.add(row.issueCommentId)
  for (const eventId of ids) {
    await enqueueJob(env, {
      type: WEBHOOK_JOB.activity,
      payload: { ...base, event_id: eventId, field: null, old_value: null, new_value: null },
      id: jobId ? `${jobId}:event:${eventId}` : undefined
    })
  }
}
