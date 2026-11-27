import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '../src/db/client'
import { createLocalD1 } from '../scripts/maintenance/d1-shim'
import type { InfraEnv } from '../src/server/common/env'
import { dispatchJob, type JobMessage } from '../src/server/common/jobs'
import { ISSUE_LIST_SELECT, groupSpec, issueOnResults } from '../src/server/issue/filter'
import { getIssueList, issueListContext, paginateIssues } from '../src/server/issue/list'
import { enforcePasswordCheckThrottle, parseRate, throttleAllows } from '../src/server/identity/throttle'
import { processCleanupTask } from '../src/server/maintenance/cleanup'
import { stickySearch } from '../src/server/sticky/queries'
import { register as registerWebhookJobs, WEBHOOK_JOB } from '../src/server/webhook/jobs'
import { queryWorkspaceMember } from '../src/server/workspace/queries'

registerWebhookJobs()

/** In-memory database with every migration, one workspace/project and users 1..4 (4 left the project). */
function openDb() {
  const raw = new DatabaseSync(':memory:')
  for (const name of readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) raw.exec(readFileSync(`drizzle/${name}`, 'utf8'))
  raw.exec(`PRAGMA foreign_keys = ON;
    INSERT INTO user(id,name,email,username,created_at,updated_at) VALUES
      (1,'Owner','owner@example.com','owner',1,1),(2,'Đặng Văn','dang@example.com','dang',1,1),
      (3,'Leo','leo@example.com','leo',1,1),(4,'Gone','gone@example.com','gone',1,1);
    INSERT INTO workspaces(id,name,slug,owner_id) VALUES(1,'Workspace','ws',1);
    INSERT INTO workspace_members(workspace_id,member_id,role) VALUES(1,1,20),(1,2,15),(1,3,15),(1,4,15);
    INSERT INTO projects(id,name,identifier,workspace_id) VALUES(1,'Project','PRJ',1);
    INSERT INTO project_members(project_id,workspace_id,member_id,role,is_active) VALUES(1,1,1,20,1),(1,1,2,15,1),(1,1,3,15,1),(1,1,4,15,0);
    INSERT INTO states(id,name,color,slug,project_id,workspace_id,"group") VALUES(1,'Todo','#000','todo',1,1,'unstarted');
    INSERT INTO issues(id,name,project_id,workspace_id,state_id,sequence_id) VALUES(1,'One',1,1,1,1);
    INSERT INTO issue_assignees(issue_id,assignee_id,project_id,workspace_id) VALUES(1,2,1,1),(1,3,1,1),(1,4,1,1);`)
  const d1 = createLocalD1(raw)
  return { raw, d1, db: getDb(d1) }
}

test('assignee_ids and the assignees group leave out members who left the project', async () => {
  const { db } = openDb()
  const rows = await db.all<Record<string, unknown>>(sql`select ${ISSUE_LIST_SELECT} from issues where issues.id = 1`)
  assert.deepEqual((issueOnResults(rows)[0].assigneeIds as number[]).sort(), [2, 3])
  const group = groupSpec('assignees__id', 'gg')
  const grouped = await db.all<{ g: number | null }>(sql`select ${group.expr} as g from issues ${sql.raw(group.join ?? '')} where issues.id = 1`)
  assert.deepEqual(grouped.map(row => row.g).sort(), [2, 3])
})

test('user text search folds Unicode case', async () => {
  const { db, raw } = openDb()
  const members = await queryWorkspaceMember(db, 1, 'ĐẶNG')
  assert.deepEqual(members.map(member => member.memberId), [2])
  raw.exec(`INSERT INTO stickies(name, owner_id, workspace_id, description_stripped) VALUES ('s', 1, 1, 'Đăng ký ngay')`)
  const hits = await db.all<{ id: number }>(sql`select id from stickies where ${stickySearch('ĐĂNG KÝ')}`)
  assert.equal(hits.length, 1)
})

test('throttle is a sliding window: hits near the window edge still count', async () => {
  const { db, raw } = openDb()
  const rate = { limit: 2, windowSeconds: 60 }
  const key = 'throttle:authentication:9.9.9.9'
  const now = Date.now()
  raw.exec(`INSERT INTO rate_limit_hits(key, hit_at) VALUES ('${key}', ${now - 59_000}), ('${key}', ${now - 58_000})`)
  assert.equal(await throttleAllows('authentication', '9.9.9.9', rate, db), false)
  raw.exec(`UPDATE rate_limit_hits SET hit_at = ${now - 61_000}`)
  assert.equal(await throttleAllows('authentication', '9.9.9.9', rate, db), true)
  assert.equal(await throttleAllows('authentication', '9.9.9.9', rate, db), true)
  assert.equal(await throttleAllows('authentication', '9.9.9.9', rate, db), false)
  assert.deepEqual(parseRate('2/minute'), rate)
})

test('password checks are throttled per user', async () => {
  const { db } = openDb()
  const env = { AUTHENTICATION_RATE_LIMIT: '2/minute' }
  const headers = new Headers()
  await enforcePasswordCheckThrottle(1, headers, env, db)
  await enforcePasswordCheckThrottle(1, headers, env, db)
  await assert.rejects(enforcePasswordCheckThrottle(1, headers, env, db), (error: unknown) => (error as { status?: number }).status === 429)
  // Another user has its own budget.
  await enforcePasswordCheckThrottle(2, headers, env, db)
})

test('the cleanup task removes job claims older than the retention window', async () => {
  const { db, raw } = openDb()
  const now = Date.now()
  raw.exec(`INSERT INTO job_claims(key, created_at) VALUES ('old', ${now - 8 * 86_400_000}), ('fresh', ${now - 86_400_000})`)
  const result = await processCleanupTask(db, 'job_claims', { now })
  assert.equal(result.deleted, 1)
  assert.deepEqual((raw.prepare('select key from job_claims').all() as { key: string }[]).map(row => row.key), ['fresh'])
})

test('a redelivered webhook job does not fan out again, a failed one can be retried', async () => {
  const { raw, d1 } = openDb()
  const queue: JobMessage[] = []
  const env = { DB: d1, JOBS_QUEUE: { send: async (body: JobMessage) => void queue.push(body) } } as unknown as InfraEnv
  const message: JobMessage = {
    type: WEBHOOK_JOB.modelActivity,
    id: 'job-1',
    payload: { model_name: 'issue', model_id: 1, requested_data: null, current_instance: null, actor_id: 1, slug: 'ws' }
  }
  await dispatchJob(env, message)
  await dispatchJob(env, message)
  assert.equal(queue.length, 1)
  assert.equal(queue[0].type, WEBHOOK_JOB.activity)
  assert.equal(queue[0].id, 'job-1:created')
  assert.equal((raw.prepare(`select count(*) as n from job_claims where key = 'webhook.model_activity:job-1'`).get() as { n: number }).n, 1)
  // A failing run gives the claim back so the queue retry runs again.
  const failing = { ...env, JOBS_QUEUE: { send: async () => Promise.reject(new Error('queue down')) } } as unknown as InfraEnv
  await assert.rejects(dispatchJob(failing, { ...message, id: 'job-2' }))
  assert.equal((raw.prepare(`select count(*) as n from job_claims where key = 'webhook.model_activity:job-2'`).get() as { n: number }).n, 0)
  await dispatchJob(env, { ...message, id: 'job-2' })
  assert.equal(queue.length, 2)
})


test('long Vietnamese search matches consecutive text before pagination and tracks writes', async () => {
  const { db, raw } = openDb()
  const term = 'đăngkývănbản'.repeat(8) + 'tiếngviệtđẹp'.repeat(8) + 'đăngkývă'
  assert.equal(term.length, 200)
  const insert = raw.prepare('insert into issues(id,name,project_id,workspace_id,state_id,sequence_id) values(?,?,1,1,1,?)')
  insert.run(2, `prefix ${term.toUpperCase()} suffix`, 2)
  insert.run(3, `${term.slice(100)}${term.slice(0, 100)}`, 3)
  insert.run(4, `${term.slice(0, 100)} separated ${term.slice(100)}`, 4)
  const ctx = await issueListContext(db, { userId: 1 }, 'ws', 1)
  const page = await paginateIssues(db, ctx, { name: term, per_page: '1' })
  assert.equal(page.total_count, 1)
  assert.deepEqual((page.results as { id: number }[]).map(row => row.id), [2])
  raw.prepare('update issues set name = ? where id = 2').run('renamed')
  assert.equal((await paginateIssues(db, ctx, { name: term, per_page: '1' })).total_count, 0)
  raw.prepare('update issues set name = ? where id = 3').run(term)
  assert.deepEqual(((await paginateIssues(db, ctx, { name: term, per_page: '1' })).results as { id: number }[]).map(row => row.id), [3])
  raw.exec('delete from issues where id = 3')
  assert.equal((raw.prepare("select count(*) as n from search_values where source_table = 'issues' and row_id = 3").get() as { n: number }).n, 0)
})

test('issue ID lists and filters use bounded D1 parameters above 100 IDs', async () => {
  const { db } = openDb()
  const ids = Array.from({ length: 150 }, (_, i) => i + 1).join(',')
  const listed = await getIssueList(db, { userId: 1 }, 'ws', 1, { issues: ids, state: ids })
  assert.deepEqual(listed.map(row => row.id), [1])
  const page = await paginateIssues(db, await issueListContext(db, { userId: 1 }, 'ws', 1), { state: ids, per_page: '1' })
  assert.equal(page.total_count, 1)
})
