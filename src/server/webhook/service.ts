import { and, desc, eq, isNull, lt } from 'drizzle-orm'
import { webhookLogs, webhooks } from '@/db/schema/integration'
import { ServiceError } from '@/server/common/errors'
import type { HostResolver } from '@/server/common/ip-address'
import { generateToken } from '@/server/webhook/model-rules'
import {
  toWebhookLogResponse,
  toWebhookResponse,
  validateWebhookUrl,
  type WebhookUrlEnv
} from '@/server/webhook/presenters'
import { getWorkspace } from '@/server/workspace/service'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { WebhookInput } from '@/types/integration/schema'
import type { WebhookLogQuery, WebhookPatch } from '@/types/integration/p3-integration-schema'

/** Request context for the URL check. Without `env` the Worker env is loaded lazily (absent in unit tests). */
export type WebhookServiceOptions = { env?: WebhookUrlEnv; requestHost?: string; resolver?: HostResolver }

const publicFields = {
  id: webhooks.id,
  url: webhooks.url,
  isActive: webhooks.isActive,
  project: webhooks.project,
  issue: webhooks.issue,
  module: webhooks.module,
  cycle: webhooks.cycle,
  issueComment: webhooks.issueComment,
  createdAt: webhooks.createdAt,
  updatedAt: webhooks.updatedAt
}

function workspaceHooks(workspaceId: number, webhookId?: number) {
  return and(
    eq(webhooks.workspaceId, workspaceId),
    eq(webhooks.isInternal, false),
    isNull(webhooks.deletedAt),
    webhookId === undefined ? undefined : eq(webhooks.id, webhookId)
  )
}

async function checkUrl(url: string, options: WebhookServiceOptions) {
  let env = options.env
  if (!env) {
    try {
      env = (await import('@/server/common/env')).getEnv()
    } catch {
      env = {}
    }
  }
  await validateWebhookUrl(url, env, { requestHost: options.requestHost, resolver: options.resolver })
}

const urlExists = () => new ServiceError(409, 'WEBHOOK_URL_EXISTS', 'URL already exists for this workspace')

export async function listWebhooks(db: LancityDb, actor: Actor, slug: string) {
  const { workspace } = await getWorkspace(db, actor, slug, 20)
  const rows = await db
    .select(publicFields)
    .from(webhooks)
    .where(workspaceHooks(workspace.id))
    .orderBy(desc(webhooks.id))
    .limit(100)
  return rows.map(row => toWebhookResponse(row))
}

export async function getWebhook(db: LancityDb, actor: Actor, slug: string, webhookId: number) {
  const { workspace } = await getWorkspace(db, actor, slug, 20)
  const [hook] = await db.select(publicFields).from(webhooks).where(workspaceHooks(workspace.id, webhookId)).limit(1)
  if (!hook) throw new ServiceError(404, 'WEBHOOK_NOT_FOUND', 'Webhook not found')
  return toWebhookResponse(hook)
}

/** Plane `WebhookSerializer.create`. The secret is returned once. The webhook starts inactive until an admin turns it on. */
export async function createWebhook(
  db: LancityDb,
  actor: Actor,
  slug: string,
  input: WebhookInput,
  options: WebhookServiceOptions = {}
) {
  const { workspace } = await getWorkspace(db, actor, slug, 20)
  await checkUrl(input.url, options)
  const [created] = await db
    .insert(webhooks)
    .values({
      ...input,
      workspaceId: workspace.id,
      secretKey: generateToken(),
      isActive: false,
      createdById: actor.userId
    })
    .onConflictDoNothing()
    .returning({ ...publicFields, secretKey: webhooks.secretKey })
  if (!created) throw urlExists()
  return toWebhookResponse(created, { showSecretKey: true })
}

/** Plane `WebhookSerializer.update` (partial). A changed URL goes through the same checks as on creation. */
export async function updateWebhook(
  db: LancityDb,
  actor: Actor,
  slug: string,
  webhookId: number,
  input: WebhookPatch,
  options: WebhookServiceOptions = {}
) {
  const { workspace } = await getWorkspace(db, actor, slug, 20)
  if (input.url) await checkUrl(input.url, options)
  const [updated] = await db
    .update(webhooks)
    .set({ ...input, updatedById: actor.userId })
    .where(workspaceHooks(workspace.id, webhookId))
    .returning(publicFields)
    .catch(async error => {
      if (input.url) {
        const [duplicate] = await db
          .select({ id: webhooks.id })
          .from(webhooks)
          .where(and(eq(webhooks.workspaceId, workspace.id), eq(webhooks.url, input.url), isNull(webhooks.deletedAt)))
        if (duplicate && duplicate.id !== webhookId) throw urlExists()
      }
      throw error
    })
  if (!updated) throw new ServiceError(404, 'WEBHOOK_NOT_FOUND', 'Webhook not found')
  return toWebhookResponse(updated)
}

/** Plane `WebhookSecretRegenerateEndpoint.post`. */
export async function rotateWebhookSecret(db: LancityDb, actor: Actor, slug: string, webhookId: number) {
  const { workspace } = await getWorkspace(db, actor, slug, 20)
  const [updated] = await db
    .update(webhooks)
    .set({ secretKey: generateToken(), updatedById: actor.userId })
    .where(workspaceHooks(workspace.id, webhookId))
    .returning({ ...publicFields, secretKey: webhooks.secretKey })
  if (!updated) throw new ServiceError(404, 'WEBHOOK_NOT_FOUND', 'Webhook not found')
  return toWebhookResponse(updated, { showSecretKey: true })
}

export async function deleteWebhook(db: LancityDb, actor: Actor, slug: string, webhookId: number) {
  const { workspace } = await getWorkspace(db, actor, slug, 20)
  const [removed] = await db
    .update(webhooks)
    .set({ deletedAt: new Date(), isActive: false, updatedById: actor.userId })
    .where(workspaceHooks(workspace.id, webhookId))
    .returning({ id: webhooks.id })
  if (!removed) throw new ServiceError(404, 'WEBHOOK_NOT_FOUND', 'Webhook not found')
}

/** Plane `WebhookLogsEndpoint.get`, newest first. `before` is the id of the last log of the previous page. */
export async function listWebhookLogs(
  db: LancityDb,
  actor: Actor,
  slug: string,
  webhookId: number,
  query: Partial<WebhookLogQuery> = {}
) {
  const { workspace } = await getWorkspace(db, actor, slug, 20)
  await getWebhook(db, actor, slug, webhookId)
  const rows = await db
    .select({
      id: webhookLogs.id,
      eventType: webhookLogs.eventType,
      requestMethod: webhookLogs.requestMethod,
      requestHeaders: webhookLogs.requestHeaders,
      requestBody: webhookLogs.requestBody,
      responseStatus: webhookLogs.responseStatus,
      responseHeaders: webhookLogs.responseHeaders,
      responseBody: webhookLogs.responseBody,
      retryCount: webhookLogs.retryCount,
      webhook: webhookLogs.webhook,
      createdAt: webhookLogs.createdAt,
      updatedAt: webhookLogs.updatedAt
    })
    .from(webhookLogs)
    .where(
      and(
        eq(webhookLogs.webhook, webhookId),
        eq(webhookLogs.workspaceId, workspace.id),
        isNull(webhookLogs.deletedAt),
        query.before === undefined ? undefined : lt(webhookLogs.id, query.before)
      )
    )
    .orderBy(desc(webhookLogs.id))
    .limit(query.limit ?? 100)
  return rows.map(toWebhookLogResponse)
}
