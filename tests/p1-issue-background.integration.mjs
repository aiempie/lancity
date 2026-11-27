import assert from 'node:assert/strict'
import { openTargetDatabase } from '../scripts/plane-import/target-schema.ts'
import { test } from 'vitest'
import { ISSUE_JOB } from '../src/server/issue/activity/index.ts'
import { extractIds, issueActivity, toId } from '../src/server/issue/jobs/issue-activities.ts'
import { archiveAndCloseOldIssues, unsnoozeExpiredIntakeIssues } from '../src/server/issue/jobs/issue-automation.ts'
import {
  issueDescriptionVersionTask,
  shouldUpdateExistingVersion
} from '../src/server/issue/jobs/issue-description-version.ts'
import { syncIssueDescriptionVersion } from '../src/server/issue/jobs/issue-description-version-sync.ts'
import { issueTask, syncIssueVersion } from '../src/server/issue/jobs/issue-version-sync.ts'
import { bulkSubscribeIssue } from '../src/server/issue/jobs/issue-subscribers.ts'
import { crawlWorkItemLinkTitle, isBlockedIp, validateUrlIp } from '../src/server/issue/jobs/work-item-link.ts'
import { register } from '../src/server/issue/jobs/index.ts'
import { dispatchJob } from '../src/server/common/jobs.ts'

// A SQLite-backed D1 adapter runs the real Drizzle queries and atomic batches (same approach as issue.test.mjs).
function createEnv() {
  const sqlite = openTargetDatabase('drizzle')
  sqlite.exec(`PRAGMA foreign_keys = ON;
    INSERT INTO user(id,name,email,username,created_at,updated_at) VALUES(1,'Owner','o@example.com','owner',1,1),(2,'Member','m@example.com','member',1,1),(3,'Guest','g@example.com','guest',1,1);
    INSERT INTO workspaces(id,name,slug,owner_id) VALUES(1,'Workspace','ws',1);
    INSERT INTO workspace_members(workspace_id,member_id,role) VALUES(1,1,20),(1,2,15),(1,3,5);
    INSERT INTO projects(id,name,identifier,workspace_id,created_by_id) VALUES(1,'Project','PRJ',1,1);
    INSERT INTO project_members(project_id,workspace_id,member_id,role) VALUES(1,1,1,20),(1,1,2,15),(1,1,3,5);
    INSERT INTO states(id,name,color,slug,project_id,workspace_id,"group") VALUES(1,'Todo','#000','todo',1,1,'unstarted'),(2,'Done','#111','done',1,1,'completed'),(3,'Cancelled','#222','cancelled',1,1,'cancelled');
    INSERT INTO labels(id,name,workspace_id,project_id) VALUES(1,'Bug',1,1);
    INSERT INTO issues(id,name,sequence_id,state_id,project_id,workspace_id,created_by_id) VALUES(1,'A',1,1,1,1,1),(2,'B',2,1,1,1,1);`)
  const prepare = sql => ({
    bind: (...params) => ({
      async raw() {
        const stmt = sqlite.prepare(sql)
        stmt.setReturnArrays(true)
        return stmt.all(...params)
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...params) }
      },
      async run() {
        sqlite.prepare(sql).run(...params)
        return { results: [] }
      },
      execute() {
        const stmt = sqlite.prepare(sql)
        return { results: stmt.columns().length ? stmt.all(...params) : (stmt.run(...params), []) }
      }
    })
  })
  const d1 = {
    prepare,
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const result = statements.map(stmt => stmt.execute())
        sqlite.exec('COMMIT')
        return result
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    }
  }
  const sent = []
  return { sqlite, sent, env: { DB: d1, JOBS_QUEUE: { send: async body => void sent.push(body) } } }
}

const rows = (sqlite, sql, ...params) => sqlite.prepare(sql).all(...params)

test('pure helpers: IDs, SSRF filter and version window', async () => {
  assert.deepEqual([...extractIds({ label_ids: [1, 2] }, 'label_ids', 'labels')], ['1', '2'])
  assert.deepEqual([...extractIds({ labels: [3] }, 'label_ids', 'labels')], ['3'])
  assert.equal(extractIds(null, 'a', 'b').size, 0)
  assert.equal(toId('12'), 12)
  assert.equal(toId('abc'), null)
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '100.64.0.1',
    '192.168.0.1',
    '::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    'fd00::1'
  ])
    assert.ok(isBlockedIp(ip), ip)
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.ok(!isBlockedIp(ip), ip)
  await assert.rejects(validateUrlIp('http://127.0.0.1/'), /private/)
  await assert.rejects(validateUrlIp('http://[::1]/'), /private/)
  await assert.rejects(validateUrlIp('file:///etc/passwd'), /scheme/)
  await assert.rejects(validateUrlIp('http://localhost/'), /private/)
  const recent = { ownedById: 1, lastSavedAt: new Date(Date.now() - 60_000) }
  assert.ok(shouldUpdateExistingVersion(recent, 1))
  assert.ok(!shouldUpdateExistingVersion(recent, 2))
  assert.ok(!shouldUpdateExistingVersion({ ownedById: 1, lastSavedAt: new Date(Date.now() - 700_000) }, 1))
  assert.ok(!shouldUpdateExistingVersion(null, 1))
})

test('issue.activity records field changes, subscribers and the notification hook', async () => {
  const { sqlite, env, sent } = createEnv()
  const created = await issueActivity(env, {
    type: 'issue.activity.updated',
    requestedData: JSON.stringify({
      name: 'A2',
      priority: 'high',
      assignee_ids: [2, 3],
      label_ids: [1],
      state_id: 2,
      closed_to: 3
    }),
    currentInstance: JSON.stringify({ name: 'A', priority: 'none', assignee_ids: [], label_ids: [], state_id: 1 }),
    issueId: 1,
    projectId: 1,
    actorId: 1,
    epoch: 10,
    notification: true,
    webhook: true
  })
  const byField = Object.fromEntries(created.map(a => [`${a.field}:${a.comment.trim()}`, a]))
  assert.equal(byField['name:updated the name to'].newValue, 'A2')
  assert.equal(byField['priority:updated the priority to'].oldValue, 'none')
  assert.equal(byField['state:updated the state to'].newValue, 'Done')
  assert.equal(byField['labels:added label'].newIdentifier, 1)
  // Role 5 (guest) cannot be assigned. Only the member is recorded and subscribed.
  const assignees = created.filter(a => a.field === 'assignees')
  assert.equal(assignees.length, 1)
  assert.equal(assignees[0].newValue, 'member')
  assert.deepEqual(
    rows(sqlite, 'select subscriber_id from issue_subscribers where issue_id=1').map(r => r.subscriber_id),
    [2]
  )
  assert.equal(rows(sqlite, 'select count(*) as n from issue_activities where issue_id=1').at(0).n, created.length)
  assert.ok(
    sent.some(m => m.type === 'notification.issue' && m.payload.issueActivitiesCreated.length === created.length)
  )
  assert.ok(sent.some(m => m.type === 'webhook.dispatch' && m.payload.activityIds.length === created.length))
  // Same actor, same description edit window: the last description activity is reused.
  const desc = { type: 'issue.activity.updated', issueId: 1, projectId: 1, actorId: 1 }
  const first = await issueActivity(env, {
    ...desc,
    requestedData: { description_html: '<p>x</p>' },
    currentInstance: { description_html: '<p></p>' }
  })
  assert.equal(first.length, 1)
  assert.equal(
    (
      await issueActivity(env, {
        ...desc,
        requestedData: { description_html: '<p>y</p>' },
        currentInstance: { description_html: '<p>x</p>' }
      })
    ).length,
    0
  )
  // Invalid payloads are dropped without throwing.
  assert.deepEqual(await issueActivity(env, { type: '', projectId: 'x' }), [])
})

test('comment, relation, cycle and delete activities', async () => {
  const { sqlite, env } = createEnv()
  sqlite.exec(`INSERT INTO issue_comments(id,issue_id,project_id,workspace_id,actor_id) VALUES(1,1,1,1,1);
    INSERT INTO cycles(id,name,owned_by_id,project_id,workspace_id) VALUES(1,'Sprint',1,1,1);`)
  const base = { issueId: 1, projectId: 1, actorId: 1 }
  const [c] = await issueActivity(env, {
    ...base,
    type: 'comment.activity.created',
    requestedData: { id: 1, comment_html: '<p>hi</p>' }
  })
  assert.equal(c.issueCommentId, 1)
  assert.equal(
    (
      await issueActivity(env, {
        ...base,
        type: 'comment.activity.updated',
        requestedData: { access: 'EXTERNAL' },
        currentInstance: { id: 1, comment_html: '<p>hi</p>' }
      })
    ).length,
    0
  )
  const [u] = await issueActivity(env, {
    ...base,
    type: 'comment.activity.updated',
    requestedData: { comment_html: '<p>yo</p>' },
    currentInstance: { id: 1, comment_html: '<p>hi</p>' }
  })
  assert.equal(u.oldValue, '<p>hi</p>')
  const rel = await issueActivity(env, {
    ...base,
    type: 'issue_relation.activity.created',
    requestedData: { issues: [2], relation_type: 'blocking' },
    currentInstance: null
  })
  assert.deepEqual(
    rel.map(a => [a.issueId, a.field, a.newValue]),
    [
      [1, 'blocking', 'PRJ-2'],
      [2, 'blocked_by', 'PRJ-1']
    ]
  )
  const cyc = await issueActivity(env, {
    ...base,
    type: 'cycle.activity.created',
    requestedData: null,
    currentInstance: {
      updated_cycle_issues: [],
      created_cycle_issues: JSON.stringify([{ fields: { cycle: 1, issue: 1 } }])
    }
  })
  assert.equal(cyc[0].newValue, 'Sprint')
  const [del] = await issueActivity(env, { ...base, type: 'issue.activity.deleted' })
  assert.equal(del.comment, 'deleted the issue')
  // Activities for an issue that does not exist are dropped instead of failing the batch.
  assert.deepEqual(
    await issueActivity(env, { type: 'issue.activity.deleted', issueId: 99, projectId: 1, actorId: 1 }),
    []
  )
  const estimate = await issueActivity(env, {
    ...base,
    type: 'issue.activity.updated',
    requestedData: { estimate_point: null },
    currentInstance: { estimate_point: 5 }
  })
  assert.equal(estimate.length, 0)
})

test('issue.version.update and description versions reuse the latest version for 10 minutes', async () => {
  const { sqlite, env } = createEnv()
  await issueActivity(env, { type: 'issue.activity.created', issueId: 1, projectId: 1, actorId: 1 })
  // issue.version.update
  await issueTask(env, { updatedIssue: JSON.stringify({ name: 'Old' }), issueId: 1, userId: 1 })
  assert.equal(rows(sqlite, 'select count(*) as n from issue_versions where issue_id=1').at(0).n, 1)
  assert.ok(rows(sqlite, 'select activity_id from issue_versions where issue_id=1').at(0).activity_id)
  await issueTask(env, { updatedIssue: JSON.stringify({ name: 'Older' }), issueId: 1, userId: 1 })
  const [reused] = rows(sqlite, 'select name from issue_versions where issue_id=1')
  assert.equal(reused.name, 'Older')
  await issueTask(env, { updatedIssue: JSON.stringify({ name: 'By two' }), issueId: 1, userId: 2 })
  assert.equal(rows(sqlite, 'select count(*) as n from issue_versions where issue_id=1').at(0).n, 2)
  await issueTask(env, { updatedIssue: JSON.stringify({ name: 'A' }), issueId: 1, userId: 3 })
  assert.equal(rows(sqlite, 'select count(*) as n from issue_versions where issue_id=1').at(0).n, 2)
  // description versions
  const run = payload => issueDescriptionVersionTask(env, { issueId: 1, ...payload })
  await run({ updatedIssue: JSON.stringify({ description_html: '<p></p>' }), userId: 1 })
  assert.equal(rows(sqlite, 'select count(*) as n from issue_description_versions').at(0).n, 0)
  await run({ updatedIssue: JSON.stringify({ description_html: '<p>old</p>' }), userId: 1 })
  assert.equal(rows(sqlite, 'select count(*) as n from issue_description_versions').at(0).n, 1)
  sqlite.exec(`update issues set description_html='<p>new</p>' where id=1`)
  await run({ updatedIssue: JSON.stringify({ description_html: '<p>old</p>' }), userId: 1 })
  const [only] = rows(sqlite, 'select description_html from issue_description_versions')
  assert.equal(only.description_html, '<p>new</p>')
  await run({ updatedIssue: JSON.stringify({ description_html: '<p>old</p>' }), userId: 2 })
  assert.equal(rows(sqlite, 'select count(*) as n from issue_description_versions').at(0).n, 2)
  await run({ updatedIssue: null, userId: 2, isCreating: true })
  assert.equal(rows(sqlite, 'select count(*) as n from issue_description_versions').at(0).n, 2)
})

test('backfill jobs run in windows, are repeatable and schedule the next window', async () => {
  const { sqlite, env, sent } = createEnv()
  sqlite.exec(`INSERT INTO issue_assignees(issue_id,assignee_id,project_id,workspace_id) VALUES(1,2,1,1);
    INSERT INTO issue_labels(issue_id,label_id,project_id,workspace_id) VALUES(1,1,1,1);`)
  await syncIssueVersion(env, { batchSize: 1, offset: 0, countdown: 30 })
  assert.equal(rows(sqlite, 'select count(*) as n from issue_versions').at(0).n, 1)
  const [v] = rows(sqlite, 'select assignees, labels, owned_by_id from issue_versions')
  assert.equal(v.assignees, '[2]')
  assert.equal(v.labels, '[1]')
  assert.equal(v.owned_by_id, 1)
  // Every job message carries an id (the job_claims idempotency key).
  const { id: nextId, ...next } = sent.at(-1)
  assert.equal(typeof nextId, 'string')
  assert.deepEqual(next, { type: ISSUE_JOB.versionSync, payload: { batchSize: 1, offset: 1, countdown: 30 } })
  await syncIssueVersion(env, { batchSize: 1, offset: 1, countdown: 30 })
  await syncIssueVersion(env, { batchSize: 5, offset: 0, countdown: 30 })
  assert.equal(rows(sqlite, 'select count(*) as n from issue_versions').at(0).n, 2)
  await syncIssueDescriptionVersion(env, {})
  await syncIssueDescriptionVersion(env, {})
  assert.equal(rows(sqlite, 'select count(*) as n from issue_description_versions').at(0).n, 2)
})

test('automation archives and closes idle issues and unsnoozes intake items', async () => {
  const { sqlite, env, sent } = createEnv()
  sqlite.exec(`UPDATE projects SET archive_in = 1, close_in = 1, default_state_id = 3 WHERE id = 1;
    UPDATE states SET "group" = 'completed' WHERE id = 2;
    INSERT INTO issues(id,name,sequence_id,state_id,project_id,workspace_id,updated_at) VALUES(3,'Done old',3,2,1,1,1),(4,'Open old',4,1,1,1,1),(5,'Done fresh',5,2,1,1,${Date.now()});
    INSERT INTO cycles(id,name,owned_by_id,project_id,workspace_id,end_date) VALUES(1,'Running',1,1,1,${Date.now() + 86_400_000});
    INSERT INTO cycle_issues(cycle_id,issue_id,project_id,workspace_id) VALUES(1,3,1,1);`)
  // Issue 3 sits in a running cycle, so only issue 4 is closed and nothing is archived yet.
  await archiveAndCloseOldIssues(env)
  assert.equal(rows(sqlite, 'select state_id from issues where id=4').at(0).state_id, 3)
  assert.equal(rows(sqlite, 'select archived_at from issues where id=3').at(0).archived_at, null)
  assert.equal(rows(sqlite, 'select updated_at from issues where id=3').at(0).updated_at, 1)
  const readOutbox = sqlite.prepare('SELECT payload FROM job_outbox WHERE id = ? AND type = ?')
  const close = sent.filter(message => message.type === 'outbox.dispatch')
    .map(message => readOutbox.get(message.payload.outboxId, ISSUE_JOB.activity))
    .filter(Boolean)
    .map(row => JSON.parse(row.payload))
    .find(payload => payload.issueId === 4)
  assert.equal(close.notification, true)
  assert.equal(close.subscriber, false)
  assert.equal(JSON.parse(close.requestedData).closed_to, 3)
  sqlite.exec('DELETE FROM cycle_issues')
  await archiveAndCloseOldIssues(env)
  assert.ok(rows(sqlite, 'select archived_at from issues where id=3').at(0).archived_at)
  assert.equal(rows(sqlite, 'select archived_at from issues where id=5').at(0).archived_at, null)
  // Repeating the run does nothing new.
  const before = sent.length
  await archiveAndCloseOldIssues(env)
  assert.equal(sent.length, before)
  // Intake
  sqlite.exec(`INSERT INTO intakes(id,name,project_id,workspace_id) VALUES(1,'Intake',1,1);
    INSERT INTO issues(id,name,sequence_id,project_id,workspace_id) VALUES(6,'Snoozed',6,1,1),(7,'Still',7,1,1);
    INSERT INTO intake_issues(issue_id,project_id,workspace_id,intake_id,status,snoozed_till) VALUES(6,1,1,1,0,1),(7,1,1,1,0,${Date.now() + 3_600_000});`)
  assert.equal(await unsnoozeExpiredIntakeIssues(env), 1)
  assert.deepEqual(
    rows(sqlite, 'select issue_id, status from intake_issues order by issue_id').map(r => [r.issue_id, r.status]),
    [
      [6, -2],
      [7, 0]
    ]
  )
  assert.equal(await unsnoozeExpiredIntakeIssues(env), 0)
})

test('subscribers, link crawl metadata and job registration', async () => {
  const { sqlite, env } = createEnv()
  await bulkSubscribeIssue(env, { issueId: 1, projectId: 1, subscriberIds: [1, 2, 2] })
  await bulkSubscribeIssue(env, { issueId: 1, projectId: 1, subscriberIds: [2, 3] })
  assert.deepEqual(
    rows(sqlite, 'select subscriber_id from issue_subscribers order by subscriber_id').map(r => r.subscriber_id),
    [1, 2, 3]
  )
  await bulkSubscribeIssue(env, { issueId: 1, projectId: 2, subscriberIds: [1] })
  sqlite.exec(`INSERT INTO issue_links(id,url,issue_id,project_id,workspace_id) VALUES(1,'http://127.0.0.1/',1,1,1)`)
  // A private address is rejected before any request, so the default favicon is stored.
  await crawlWorkItemLinkTitle(env, { id: 1, url: 'http://127.0.0.1/' })
  const meta = JSON.parse(rows(sqlite, 'select metadata from issue_links where id=1').at(0).metadata)
  assert.equal(meta.title, null)
  assert.equal(meta.url, 'http://127.0.0.1/')
  assert.ok(meta.favicon.startsWith('data:image/svg+xml;base64,'))
  await crawlWorkItemLinkTitle(env, { id: 99, url: 'http://127.0.0.1/' })
  register()
  await dispatchJob(env, { type: ISSUE_JOB.subscribersBulk, payload: { issueId: 2, projectId: 1, subscriberIds: [1] } })
  assert.equal(rows(sqlite, 'select count(*) as n from issue_subscribers where issue_id=2').at(0).n, 1)
})
