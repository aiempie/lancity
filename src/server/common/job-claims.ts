import { and, eq, inArray, like } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { jobClaims } from '@/db/schema/ext-r5-jobs'
import type { LancityDb } from '@/types/database/schema'

// Each inserted claim binds both key and owner; selects bind one extra owner.
const CHUNK = 50

/** True while the `job_claims` migration has not been applied. Jobs then run without dedupe instead of failing. */
function tableMissing(error: unknown): boolean {
  const text = (e: unknown): string => (e instanceof Error ? `${e.message} ${text(e.cause)}` : String(e ?? ''))
  return /no such table:?\s*job_claims/i.test(text(error))
}

/**
 * Has the job with this key already committed its writes? `available` is false when the claim table is missing,
 * in which case the caller must not add a claim statement to its batch.
 */
export async function checkJobClaim(db: LancityDb, key: string): Promise<{ done: boolean; available: boolean }> {
  try {
    const [row] = await db.select({ id: jobClaims.id }).from(jobClaims).where(eq(jobClaims.key, key)).limit(1)
    return { done: Boolean(row), available: true }
  } catch (error) {
    if (!tableMissing(error)) throw error
    console.warn(JSON.stringify({ level: 'warn', label: 'job-claims', message: 'job_claims table is missing, dedupe is off' }))
    return { done: false, available: false }
  }
}

/**
 * Claim a job before it does its work (fan-out and delivery jobs that cannot write their claim in one batch with the
 * result). Returns false when an earlier delivery already holds the claim. Returns true without a claim when the
 * table is missing.
 */
export async function claimJob(db: LancityDb, key: string, owner: string | null = null): Promise<boolean> {
  try {
    const rows = await db.insert(jobClaims).values({ key, owner }).onConflictDoNothing().returning({ id: jobClaims.id })
    return rows.length > 0
  } catch (error) {
    if (!tableMissing(error)) throw error
    return true
  }
}

/** Give a claim back after the job failed, so the queue retry can run it again. Never throws. */
export async function releaseJobClaim(db: LancityDb, key: string): Promise<void> {
  try {
    await db.delete(jobClaims).where(eq(jobClaims.key, key))
  } catch (error) {
    console.warn(JSON.stringify({ level: 'warn', label: 'job-claims', message: `could not release ${key}: ${String(error)}` }))
  }
}

/**
 * Run `run` once per queue message. The claim `<type>:<jobId>` is taken first, so a redelivery after success does
 * nothing. When `run` throws, the claim is given back and the error propagates so Queues retries. Without a job id
 * (direct calls, tests) or without a D1 binding the job simply runs.
 */
export async function withJobClaim(env: { DB?: D1Database }, type: string, jobId: string | undefined, run: () => Promise<void>): Promise<void> {
  if (!jobId || !env.DB) return run()
  const db = getDb(env.DB)
  const key = `${type}:${jobId}`
  if (!(await claimJob(db, key, jobId))) return
  try {
    await run()
  } catch (error) {
    await releaseJobClaim(db, key)
    throw error
  }
}

/** Claim insert for a D1 batch. A concurrent duplicate violates the unique key and rolls the whole batch back. */
export function jobClaimStatement(db: LancityDb, key: string, owner: string | null = null) {
  return db.insert(jobClaims).values({ key, owner })
}

/**
 * Keep only the activity rows this job may fan out: rows nobody claimed yet, or claimed by this job (redelivery).
 * Claims are written before the rows are used, so two jobs never fan out the same activity row.
 */
export async function claimActivityRows<T extends { id: number }>(db: LancityDb, jobId: string, rows: T[]): Promise<T[]> {
  if (!rows.length) return rows
  try {
    const keys = rows.map(row => `activity:${row.id}`)
    for (let i = 0; i < keys.length; i += CHUNK)
      await db
        .insert(jobClaims)
        .values(keys.slice(i, i + CHUNK).map(key => ({ key, owner: jobId })))
        .onConflictDoNothing()
    const owned = new Set<string>()
    for (let i = 0; i < keys.length; i += CHUNK) {
      const found = await db
        .select({ key: jobClaims.key })
        .from(jobClaims)
        .where(and(inArray(jobClaims.key, keys.slice(i, i + CHUNK)), eq(jobClaims.owner, jobId)))
      for (const row of found) owned.add(row.key)
    }
    return rows.filter(row => owned.has(`activity:${row.id}`))
  } catch (error) {
    if (!tableMissing(error)) throw error
    return rows
  }
}

/** Activity ids a job claimed (to rebuild its fan-out after a redelivery). */
export async function claimedActivityIds(db: LancityDb, jobId: string): Promise<number[]> {
  try {
    const rows = await db
      .select({ key: jobClaims.key })
      .from(jobClaims)
      .where(and(eq(jobClaims.owner, jobId), like(jobClaims.key, 'activity:%')))
    return rows.map(row => Number(row.key.slice('activity:'.length))).filter(id => Number.isSafeInteger(id))
  } catch (error) {
    if (!tableMissing(error)) throw error
    return []
  }
}

/** Is this error the unique violation of a claim (a concurrent delivery of the same job won the race)? */
export function isClaimConflict(error: unknown): boolean {
  const text = (e: unknown): string => (e instanceof Error ? `${e.message} ${text(e.cause)}` : String(e ?? ''))
  return /UNIQUE constraint failed:?\s*job_claims/i.test(text(error))
}
