import { and, eq, isNull, lte, or, SQL, sql } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { jobOutbox } from '@/db/schema/ext-r5-jobs'
import type { LancityDb } from '@/types/database/schema'
import type { InfraEnv } from '@/server/common/env'
import { dispatchJob, enqueueJob, registerJobHandler, registerScheduled } from '@/server/common/jobs'

const OUTBOX_JOB = 'outbox.dispatch'
// Queue retries can be exhausted after a successful send. Recover messages that have not completed.
const OUTBOX_RECOVERY_MS = 30 * 60 * 1000

/** Include this statement in the same D1 batch as the mutation. `condition` may use changes(). */
export function outboxStatement(db: LancityDb, eventKey: string, type: string, payload: unknown | SQL, condition: SQL = sql`1`) {
  const json = payload instanceof SQL ? payload : sql`${JSON.stringify(payload)}`
  return db.insert(jobOutbox).select(sql`select null, ${eventKey}, ${type}, ${json}, null, null,
    cast(unixepoch('subsec') * 1000 as integer) where ${condition}`)
}

async function publishRow(db: LancityDb, row: { id: number }, env: InfraEnv) {
  await enqueueJob(env, { type: OUTBOX_JOB, payload: { outboxId: row.id }, id: `outbox:${row.id}` })
  await db.update(jobOutbox).set({ publishedAt: new Date() }).where(eq(jobOutbox.id, row.id))
}

/** Store a child with a stable key before publishing, so retries rebuild the same child. */
export async function enqueueOutboxChild(db: LancityDb, eventKey: string, type: string, payload: unknown, env: InfraEnv): Promise<void> {
  await db.insert(jobOutbox).values({ eventKey, type, payload: JSON.stringify(payload) }).onConflictDoNothing()
  const [row] = await db.select({ id: jobOutbox.id, publishedAt: jobOutbox.publishedAt, completedAt: jobOutbox.completedAt }).from(jobOutbox).where(eq(jobOutbox.eventKey, eventKey)).limit(1)
  if (!row) throw new Error(`Outbox row ${eventKey} missing`)
  if (!row.publishedAt && !row.completedAt) await publishRow(db, row, env)
}

/** Publish after commit; errors leave the row pending for Cron. */
export async function publishOutbox(db: LancityDb, eventKey: string, env?: InfraEnv): Promise<void> {
  try {
    const target = env ?? (await import('@/server/common/env')).getEnv()
    const [row] = await db.select({ id: jobOutbox.id, publishedAt: jobOutbox.publishedAt, completedAt: jobOutbox.completedAt }).from(jobOutbox).where(eq(jobOutbox.eventKey, eventKey)).limit(1)
    if (row && !row.publishedAt && !row.completedAt) await publishRow(db, row, target)
  } catch (error) {
    console.warn(JSON.stringify({ level: 'warn', label: 'outbox.publish', message: String(error) }))
  }
}

export async function publishPendingOutbox(env: InfraEnv): Promise<void> {
  const db = getDb(env.DB)
  const cutoff = new Date(Date.now() - OUTBOX_RECOVERY_MS)
  const rows = await db.select({ id: jobOutbox.id }).from(jobOutbox)
    .where(and(isNull(jobOutbox.completedAt), or(isNull(jobOutbox.publishedAt), lte(jobOutbox.publishedAt, cutoff))))
    .orderBy(jobOutbox.id).limit(100)
  for (const row of rows) {
    try { await publishRow(db, row, env) } catch (error) {
      console.warn(JSON.stringify({ level: 'warn', label: 'outbox.retry', id: row.id, message: String(error) }))
    }
  }
}

export function registerOutbox(): void {
  registerJobHandler<{ outboxId: number }>(OUTBOX_JOB, async ({ outboxId }, env) => {
    const db = getDb(env.DB)
    const [row] = await db.select().from(jobOutbox).where(eq(jobOutbox.id, outboxId)).limit(1)
    if (!row) throw new Error(`Outbox row ${outboxId} missing`)
    if (row.completedAt) return
    const payload = JSON.parse(row.payload)
    if (row.type === 'issue.description_version.update') {
      const prior = await db.all<{ id: number }>(sql`select id from job_outbox where type = ${row.type}
        and id < ${row.id} and completed_at is null and json_extract(payload, '$.issueId') = ${payload.issueId} limit 1`)
      if (prior.length) throw new Error(`Waiting for earlier description snapshot ${prior[0].id}`)
    }
    await dispatchJob(env, { type: row.type, payload, id: `outbox:${row.id}` })
    await db.update(jobOutbox).set({ completedAt: new Date() }).where(eq(jobOutbox.id, row.id))
  })
  registerScheduled('*/5 * * * *', publishPendingOutbox, 'outbox.pending')
}
