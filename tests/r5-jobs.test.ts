import assert from 'node:assert/strict'
import { openTargetDatabase } from '../scripts/plane-import/target-schema'
import { test } from 'vitest'
import { getDb } from '../src/db/client'
import { createLocalD1 } from '../scripts/maintenance/d1-shim'
import { claimActivityRows } from '../src/server/common/job-claims'
import { dispatchJob, enqueueJob, type JobMessage } from '../src/server/common/jobs'
import { transferCycleIssues } from '../src/server/cycle/cycle-transfer-issues'
import { setIssueEventEnv } from '../src/server/issue/events'
import { createIssueComment } from '../src/server/issue/comment'
import { createIssueLink, deleteIssueLink } from '../src/server/issue/link'
import { createIssue, updateIssue } from '../src/server/issue/service'
import { register as registerIssueJobs } from '../src/server/issue/jobs/index'
import { register as registerNotificationJobs } from '../src/server/notification/jobs/index'
import type { InfraEnv } from '../src/server/common/env'

const admin = { userId: 1 }
const mention = (id: number) => `<mention-component entity_name="user_mention" entity_identifier="${id}"></mention-component>`

registerIssueJobs()
registerNotificationJobs()

/** In-memory database with every migration, the `job_claims` table of ext-r5-jobs and a fake Queue. */
function openDb() {
  const raw = openTargetDatabase('drizzle')
  raw.exec(`PRAGMA foreign_keys = ON;
    INSERT INTO user(id,name,email,username,created_at,updated_at) VALUES(1,'Owner','owner@example.com','owner',1,1),(2,'Mia','mia@example.com','mia',1,1),(3,'Leo','leo@example.com','leo',1,1);
    INSERT INTO workspaces(id,name,slug,owner_id) VALUES(1,'Workspace','ws',1);
    INSERT INTO workspace_members(workspace_id,member_id,role) VALUES(1,1,20),(1,2,15),(1,3,15);
    INSERT INTO projects(id,name,identifier,workspace_id) VALUES(1,'Project','PRJ',1);
    INSERT INTO project_members(project_id,workspace_id,member_id,role) VALUES(1,1,1,20),(1,1,2,15),(1,1,3,15);
    INSERT INTO states(id,name,color,slug,project_id,workspace_id,"group") VALUES(1,'Todo','#000','todo',1,1,'unstarted');`)
  const d1 = createLocalD1(raw)
  const db = getDb(d1)
  const queue: JobMessage[] = []
  const env = { DB: d1, JOBS_QUEUE: { send: async (body: JobMessage) => void queue.push(body) } } as unknown as InfraEnv
  setIssueEventEnv(env)
  const count = (table: string, where = '1') => (raw.prepare(`select count(*) as n from ${table} where ${where}`).get() as { n: number }).n
  const all = (sql: string) => raw.prepare(sql).all() as Record<string, unknown>[]
  /** Run queued jobs like the queue consumer. Jobs without a handler (webhooks, versions) are dropped. */
  async function drain(): Promise<JobMessage[]> {
    const ran: JobMessage[] = []
    while (queue.length) {
      const message = queue.shift()!
      ran.push(message)
      await dispatchJob(env, message).catch(error => {
        if (!(error instanceof Error) || error.name !== 'UnknownJobError') throw error
      })
    }
    return ran
  }
  return { raw, db, env, queue, count, all, drain }
}

test('a mention in the description notifies the user (requestedData reaches the job as snake_case)', async () => {
  const { db, env, all, drain } = openDb()
  const issue = await createIssue(db, admin, 'ws', 1, { name: 'Task' }, env)
  await drain()
  await updateIssue(db, admin, 'ws', 1, issue.id, { descriptionHtml: `<p>Please look ${mention(2)}</p>` }, env)
  const activityRow = all("select payload from job_outbox where type = 'issue.activity' order by id desc limit 1")[0]
  const payload = JSON.parse(String(activityRow.payload)) as { requestedData: Record<string, unknown> }
  assert.ok(payload.requestedData.description_html, 'requestedData uses Plane snake_case keys')
  assert.equal(payload.requestedData.descriptionHtml, undefined)
  await drain()
  const mentioned = all(`select receiver_id, sender from notifications where sender = 'in_app:issue_activities:mentioned'`)
  assert.deepEqual(mentioned.map(row => row.receiver_id), [2])
  assert.equal(all(`select * from issue_mentions where mention_id = 2 and deleted_at is null`).length, 1)
})

test('a mention in a new issue description notifies the user', async () => {
  const { db, env, all, drain } = openDb()
  await createIssue(db, admin, 'ws', 1, { name: 'Task', descriptionHtml: `<p>${mention(3)}</p>` }, env)
  await drain()
  assert.deepEqual(
    all(`select receiver_id from notifications where sender = 'in_app:issue_activities:mentioned'`).map(row => row.receiver_id),
    [3]
  )
})

test('a comment queues an activity job, notifies the mentioned user and is not stored twice', async () => {
  const { db, env, queue, count, all, drain } = openDb()
  const issue = await createIssue(db, admin, 'ws', 1, { name: 'Task' }, env)
  await drain()
  await createIssueComment(db, admin, 'ws', 1, issue.id, { comment_html: `<p>hi ${mention(2)}</p>` })
  const job = queue.find(message => message.type === 'outbox.dispatch')
  assert.ok(job)
  assert.ok(job?.id, 'enqueueJob assigns a job id')
  const ran = await drain()
  assert.ok(ran.some(message => message.type === 'outbox.dispatch'))
  assert.equal(count('issue_activities', `field = 'comment'`), 1)
  const rows = all(`select receiver_id, message from notifications where sender = 'in_app:issue_activities:mentioned'`)
  assert.deepEqual(rows.map(row => row.receiver_id), [2])
  assert.match(String(rows[0].message), /mentioned you in a comment/)
})

test('a link change reaches the activity job without a second activity row', async () => {
  const { db, env, count, all, drain } = openDb()
  const issue = await createIssue(db, admin, 'ws', 1, { name: 'Task' }, env)
  await drain()
  const link = await createIssueLink(db, admin, 'ws', 1, issue.id, { url: 'https://example.com/a' })
  await deleteIssueLink(db, admin, 'ws', 1, issue.id, link.id)
  const types = all("select payload from job_outbox where type = 'issue.activity' and json_extract(payload, '$.type') like 'link.%' order by id").map(row => JSON.parse(String(row.payload)).type)
  assert.deepEqual(types, ['link.activity.created', 'link.activity.deleted'])
  await drain()
  assert.equal(count('issue_activities', `field = 'link'`), 2)
})

test('redelivering the activity job does not duplicate activities or notifications', async () => {
  const { db, env, queue, count, drain } = openDb()
  const issue = await createIssue(db, admin, 'ws', 1, { name: 'Task' }, env)
  await drain()
  await createIssueComment(db, admin, 'ws', 1, issue.id, { comment_html: `<p>${mention(2)}</p>` })
  const delivered = structuredClone(queue.find(message => message.type === 'outbox.dispatch')!)
  await drain()
  const notifications = count('notifications')
  const logs = count('email_notification_logs')
  assert.ok(notifications > 0)
  // The queue delivers the same message again (same id), and so do the child jobs it enqueues.
  await dispatchJob(env, delivered)
  await drain()
  assert.equal(count('notifications'), notifications)
  assert.equal(count('email_notification_logs'), logs)
  assert.equal(count('issue_activities', `field = 'comment'`), 1)
})

test('redelivering a job that writes the activity itself stores it once and still fans out once', async () => {
  const { db, env, queue, count, drain } = openDb()
  const issue = await createIssue(db, admin, 'ws', 1, { name: 'Task' }, env)
  await drain()
  const message: JobMessage = {
    id: 'fixed-job-id',
    type: 'issue.activity',
    payload: {
      type: 'link.activity.created',
      requestedData: JSON.stringify({ id: 9, url: 'https://example.com/x' }),
      currentInstance: null,
      issueId: issue.id,
      actorId: 1,
      projectId: 1,
      epoch: Math.floor(Date.now() / 1000),
      notification: true
    }
  }
  await dispatchJob(env, message)
  await drain()
  const notifications = count('notifications')
  await dispatchJob(env, message)
  await drain()
  assert.equal(count('issue_activities', `field = 'link'`), 1)
  assert.equal(count('notifications'), notifications)
  // A different job id is a different event.
  await enqueueJob(env, { ...message, id: 'other-job-id' })
  await drain()
  assert.equal(count('issue_activities', `field = 'link'`), 2)
  assert.equal(queue.length, 0)
})

test('transferring cycle issues records the Plane cycles activity with names and ids', async () => {
  const { db, raw, all } = openDb()
  const issue = await createIssue(db, admin, 'ws', 1, { name: 'Task', stateId: 1 })
  const past = Date.now() - 86_400_000
  const future = Date.now() + 86_400_000
  raw.exec(`INSERT INTO cycles(id,name,owned_by_id,project_id,workspace_id,end_date) VALUES(1,'Sprint 1',1,1,1,${past}),(2,'Sprint 2',1,1,1,${future});
    INSERT INTO cycle_issues(cycle_id,issue_id,project_id,workspace_id) VALUES(1,${issue.id},1,1)`)
  await transferCycleIssues(db, admin, 'ws', 1, 1, 2)
  const [row] = all(`select * from issue_activities where field in ('cycle','cycles')`)
  assert.equal(row.field, 'cycles')
  assert.equal(row.verb, 'updated')
  assert.equal(row.old_value, 'Sprint 1')
  assert.equal(row.new_value, 'Sprint 2')
  assert.equal(row.old_identifier, 1)
  assert.equal(row.new_identifier, 2)
  assert.match(String(row.comment), /^updated cycle from Sprint 1\s+to Sprint 2$/)
  assert.equal(all(`select cycle_id from cycle_issues where issue_id = ${issue.id}`)[0].cycle_id, 2)
})

test('consecutive description edits keep separate activity rows and mention recipients', async () => {
  const { db, env, all, drain } = openDb()
  const issue = await createIssue(db, admin, 'ws', 1, { name: 'Task' }, env)
  await drain()
  await updateIssue(db, admin, 'ws', 1, issue.id, { descriptionHtml: `<p>${mention(2)}</p>` }, env)
  await updateIssue(db, admin, 'ws', 1, issue.id, { descriptionHtml: `<p>${mention(2)} ${mention(3)}</p>` }, env)
  const events = all("select id, actor_id, mutation_id from issue_activities where field = 'description' and mutation_id is not null order by id")
  assert.equal(new Set(events.map(row => row.mutation_id)).size, 2)
  await drain()
  const mentioned = all("select receiver_id, triggered_by_id, json_extract(data, '$.issue_activity.id') as activity_id, json_extract(data, '$.issue_activity.actor') as actor from notifications where sender = 'in_app:issue_activities:mentioned' order by receiver_id")
  assert.deepEqual(mentioned.map(row => row.receiver_id), [2, 3])
  assert.deepEqual(mentioned.map(row => row.activity_id), events.map(row => row.id))
  assert.deepEqual(mentioned.map(row => row.triggered_by_id), [1, 1])
  assert.deepEqual(mentioned.map(row => row.actor), ['1', '1'])
})

test('failed queue publish remains pending and cron republishes it', async () => {
  const { db, env, queue, count, drain } = openDb()
  const unavailable = { ...env, JOBS_QUEUE: { send: async () => { throw new Error('temporary queue failure') } } } as unknown as InfraEnv
  await createIssue(db, admin, 'ws', 1, { name: 'Task' }, unavailable)
  assert.ok(count('job_outbox', 'published_at is null') >= 2)
  const { publishPendingOutbox } = await import('../src/server/common/outbox')
  await publishPendingOutbox(env)
  assert.equal(count('job_outbox', 'published_at is null'), 0)
  assert.ok(queue.every(message => message.type === 'outbox.dispatch'))
  await drain()
})

test('large description is persisted in the outbox and never sent in queue messages', async () => {
  const { db, env, queue, all, drain } = openDb()
  const issue = await createIssue(db, admin, 'ws', 1, { name: 'Task' }, env)
  await drain()
  const html = `<p>${'x'.repeat(157_000)} ${mention(2)}</p>`
  await updateIssue(db, admin, 'ws', 1, issue.id, { descriptionHtml: html }, env)
  assert.ok(queue.every(message => JSON.stringify(message).length < 1000))
  await drain()
  assert.equal(all("select receiver_id from notifications where sender = 'in_app:issue_activities:mentioned'")[0]?.receiver_id, 2)
  assert.equal(all('select description_html from issue_description_versions order by id desc limit 1')[0]?.description_html, html)
})


test('claims 51 activities without exceeding the D1 parameter limit', async () => {
  const { raw, count } = openDb()
  const original = createLocalD1(raw)
  const counts: number[] = []
  const limited = {
    ...original,
    prepare(query: string) {
      const statement = original.prepare(query)
      return new Proxy(statement, {
        get(target, property, receiver) {
          if (property === 'bind') return (...values: unknown[]) => {
            counts.push(values.length)
            assert.ok(values.length <= 100, `D1 statement bound ${values.length} parameters`)
            return target.bind(...values)
          }
          return Reflect.get(target, property, receiver)
        }
      })
    }
  } as D1Database
  const rows = Array.from({ length: 51 }, (_, i) => ({ id: i + 1 }))
  assert.equal((await claimActivityRows(getDb(limited), 'event:51', rows)).length, 51)
  assert.equal(count('job_claims', "owner = 'event:51'"), 51)
  assert.ok(counts.some(count => count === 100), 'the first insert exercises the parameter boundary')
})

test('a rejected notification child send retries on parent redelivery', async () => {
  const { db, env, queue, count, all, drain } = openDb()
  const issue = await createIssue(db, admin, 'ws', 1, { name: 'Task' }, env)
  await drain()
  await updateIssue(db, admin, 'ws', 1, issue.id, { descriptionHtml: `<p>${mention(2)}</p>` }, env)
  const parentRow = all("select id from job_outbox where type = 'issue.activity' order by id desc limit 1")[0]
  const parent = queue.find(message => (message.payload as { outboxId?: number }).outboxId === parentRow.id)!
  const unavailable = { ...env, JOBS_QUEUE: { send: async () => { throw new Error('child queue rejected') } } } as unknown as InfraEnv
  await assert.rejects(dispatchJob(unavailable, parent), /child queue rejected/)
  assert.equal(count('job_outbox', "type = 'notification.issue' and published_at is null"), 1)
  assert.equal(count('job_outbox', `id = ${parentRow.id} and completed_at is null`), 1)
  await dispatchJob(env, parent)
  await drain()
  assert.equal(count('notifications', "receiver_id = 2 and sender = 'in_app:issue_activities:mentioned'"), 1)
  assert.equal(count('job_outbox', "type = 'notification.issue' and published_at is null"), 0)
  await dispatchJob(env, parent)
  await drain()
  assert.equal(count('notifications', "receiver_id = 2 and sender = 'in_app:issue_activities:mentioned'"), 1)
})


test('legacy activity jobs cannot claim rows tagged with a mutation id', async () => {
  const { db, env, all, drain } = openDb()
  const issue = await createIssue(db, admin, 'ws', 1, { name: 'Task' }, env)
  await drain()
  await updateIssue(db, admin, 'ws', 1, issue.id, { name: 'New name' }, env)
  const tagged = all("select id from issue_activities where field = 'name' order by id desc limit 1")[0]
  await dispatchJob(env, { id: 'legacy-event', type: 'issue.activity', payload: {
    event: 'updated', issueId: issue.id, projectId: 1, actorId: 1, epoch: Math.floor(Date.now() / 1000),
    activityRecorded: true, notification: true, requestedData: { name: 'old' }, currentInstance: null
  } })
  assert.equal(all(`select id from job_claims where key = 'activity:${tagged.id}' and owner = 'legacy-event'`).length, 0)
  await drain()
})

test('out-of-order description jobs reconcile mentions to the current description', async () => {
  for (const initiallyMentioned of [false, true]) {
    const { db, env, queue, all, drain } = openDb()
    const initial = initiallyMentioned ? `<p>${mention(2)}</p>` : '<p>Empty</p>'
    const issue = await createIssue(db, admin, 'ws', 1, { name: 'Task', descriptionHtml: initial }, env)
    await drain()
    const first = initiallyMentioned ? '<p>Empty</p>' : `<p>${mention(2)}</p>`
    const second = initiallyMentioned ? `<p>${mention(2)}</p>` : '<p>Empty</p>'
    await updateIssue(db, admin, 'ws', 1, issue.id, { descriptionHtml: first }, env)
    await updateIssue(db, admin, 'ws', 1, issue.id, { descriptionHtml: second }, env)
    const eventIds = all("select id from job_outbox where type = 'issue.activity' order by id desc limit 2").map(row => row.id)
    for (const id of eventIds) {
      const event = queue.find(message => (message.payload as { outboxId?: number }).outboxId === id)
      assert.ok(event)
      await dispatchJob(env, event)
    }
    await drain()
    const active = all(`select mention_id from issue_mentions where issue_id = ${issue.id} and deleted_at is null`)
    assert.deepEqual(active.map(row => row.mention_id), initiallyMentioned ? [2] : [])
  }
})


test('cron republishes an accepted but lost snapshot so a later snapshot can progress', async () => {
  const { db, env, queue, raw, all, drain } = openDb()
  const issue = await createIssue(db, admin, 'ws', 1, { name: 'Task' }, env)
  await drain()
  const completed = all("select id from job_outbox where type = 'issue.description_version.update' order by id desc limit 1")[0]
  await updateIssue(db, admin, 'ws', 1, issue.id, { descriptionHtml: '<p>First</p>' }, env)
  await updateIssue(db, admin, 'ws', 1, issue.id, { descriptionHtml: '<p>Second</p>' }, env)
  const versions = all("select id from job_outbox where type = 'issue.description_version.update' order by id desc limit 2").reverse()
  const [first, second] = versions
  const index = queue.findIndex(message => (message.payload as { outboxId?: number }).outboxId === first.id)
  assert.ok(index >= 0)
  const [lost] = queue.splice(index, 1)
  const successor = queue.find(message => (message.payload as { outboxId?: number }).outboxId === second.id)!
  await assert.rejects(dispatchJob(env, successor), /Waiting for earlier description snapshot/)
  raw.prepare('update job_outbox set published_at = ? where id in (?, ?)').run(Date.now() - 31 * 60 * 1000, first.id as number, completed.id as number)
  const queuedBefore = queue.length
  const { publishPendingOutbox } = await import('../src/server/common/outbox')
  await publishPendingOutbox(env)
  const recovered = queue.slice(queuedBefore)
  assert.equal(recovered.length, 1)
  assert.deepEqual(recovered[0], lost)
  await dispatchJob(env, recovered[0])
  await dispatchJob(env, successor)
  assert.equal(all('select description_html from issue_description_versions order by id desc limit 1')[0]?.description_html, '<p>Second</p>')
  assert.equal(all(`select id from job_outbox where id in (${first.id}, ${second.id}) and completed_at is not null`).length, 2)
})
