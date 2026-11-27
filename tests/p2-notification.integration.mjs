import assert from 'node:assert/strict'
import { test } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'
import { openTargetDatabase } from '../scripts/plane-import/target-schema.ts'
import { register } from '../src/server/notification/jobs/index.ts'
import { dispatchJob } from '../src/server/common/jobs.ts'
import {
  extractMentionsAsSubscribers,
  getNewCommentMentions,
  getNewMentions,
  getRemovedMentions,
  notifications
} from '../src/server/notification/jobs/notification.ts'
import {
  acquireLock,
  createPayload,
  processHtmlContent,
  processMention,
  releaseLock,
  removeUnwantedCharacters,
  stackEmailNotification
} from '../src/server/notification/jobs/email-notification.ts'
import { generatePlainTextFromHtml, removeStyleBlocks } from '../src/server/notification/email.ts'
import { stickyDescriptionStripped, validateStickyBinary } from '../src/server/sticky/model-rules.ts'
import { formatSticky } from '../src/server/sticky/presenters.ts'
import { getDefaultPreference } from '../src/server/notification/model-rules.ts'

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
    INSERT INTO issues(id,name,sequence_id,state_id,project_id,workspace_id,created_by_id) VALUES(1,'A',1,1,1,1,1),(2,'B',2,1,1,1,1);
    INSERT INTO user_notification_preferences(user_id,created_by_id,updated_by_id,property_change) VALUES(2,2,2,0),(3,3,3,1);
    INSERT INTO issue_subscribers(issue_id,project_id,workspace_id,subscriber_id) VALUES(1,1,1,2),(1,1,1,3);`)
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
const mention = id => `<mention-component entity_name="user_mention" entity_identifier="${id}"></mention-component>`

test('email helpers: style blocks, plain text, subject characters (PD-1123, PD-1729, PD-1730)', () => {
  assert.equal(removeStyleBlocks('a<STYLE type="x">b{}</style>c'), 'ac')
  assert.equal(removeStyleBlocks('a<style>never closed'), 'a<style>never closed')
  assert.equal(
    generatePlainTextFromHtml('<style>p{}</style><p>Hi &amp; bye</p>\n\n\n\n<p>End</p>'),
    '\n\nHi & bye\n\nEnd\n\n'
  )
  assert.equal(removeUnwantedCharacters('a\u0000b\u0085c\nd'), 'abcd')
})

test('mention helpers diff description and comment mentions (PD-1202 to PD-1207)', () => {
  const older = { description_html: `<p>${mention(2)}${mention(3)}</p>` }
  const newer = { description_html: `<p>${mention(3)}${mention(4)}</p>` }
  assert.deepEqual(getNewMentions(newer, older), [4])
  assert.deepEqual(getRemovedMentions(newer, older), [2])
  assert.deepEqual(getNewMentions({ description_html: 'x' }, null), [])
  assert.deepEqual(getNewCommentMentions(mention(2), null), [2])
  assert.deepEqual(getNewCommentMentions(`${mention(2)}${mention(3)}`, mention(2)), [3])
})

test('email payload and mention rendering (PD-1127 to PD-1129)', () => {
  const entry = (field, old_value, new_value, activity_time) => ({
    issue_activity: { field, old_value, new_value, activity_time }
  })
  const payload = createPayload(
    new Map([
      [
        1,
        [
          entry('state', 'Todo', 'Done', '2026-01-02T03:04:05Z'),
          entry('state', 'Todo', 'Done', '2026-01-02T03:05:06Z'),
          entry('priority', 'None', 'high', '2026-01-02T03:05:06Z')
        ]
      ]
    ])
  )
  const actor = payload.get(1)
  assert.deepEqual(actor.changes.state, { old_value: ['Todo'], new_value: ['Done'] })
  assert.deepEqual(actor.changes.priority.new_value, ['high'])
  assert.equal(actor.activityTime, '2026-01-02 03:05:06')
  const names = new Map([[2, 'member']])
  assert.equal(processMention(`hi ${mention(2)}!`, names), 'hi @member!')
  assert.deepEqual(processHtmlContent([mention(2)], names), ['@member'])
  assert.equal(processHtmlContent(null, names), null)
})

test('sticky and preference model rules (PD-1455, PD-1490, PD-1491, PD-0047)', () => {
  assert.equal(stickyDescriptionStripped('<p>a <b>b</b></p>'), 'a b')
  assert.equal(stickyDescriptionStripped(''), null)
  assert.equal(formatSticky(null), 'None')
  assert.deepEqual(Object.keys(getDefaultPreference()), ['property_change', 'state', 'comment', 'mentions'])
  assert.ok(validateStickyBinary(btoa('abcdef')) instanceof Uint8Array)
  assert.throws(() => validateStickyBinary(btoa('<script>alert(1)</script>')), /suspicious/)
  assert.throws(() => validateStickyBinary(btoa('ab')), /too short/)
  assert.throws(() => validateStickyBinary('***'), /base64/)
})

test('notification.issue creates notifications, email logs and subscriptions', async () => {
  const { sqlite, env } = createEnv()
  const activity = {
    id: 1,
    verb: 'updated',
    field: 'name',
    oldValue: 'A',
    newValue: 'A2',
    comment: 'updated the name to',
    issueId: 1,
    actorId: 1,
    createdAt: new Date().toISOString()
  }
  sqlite.exec(
    "INSERT INTO issue_activities(id,verb,field,old_value,new_value,comment,issue_id,project_id,workspace_id,actor_id) VALUES(1,'updated','name','A','A2','updated the name to',1,1,1,1)"
  )
  register()
  await dispatchJob(env, {
    type: 'notification.issue',
    payload: {
      type: 'issue.activity.updated',
      issueId: 1,
      actorId: 1,
      projectId: 1,
      subscriber: true,
      issueActivitiesCreated: [activity]
    }
  })
  const list = rows(sqlite, 'SELECT receiver_id, sender, title FROM notifications ORDER BY receiver_id')
  // The actor is not notified; both subscribers are.
  assert.deepEqual(
    list.map(row => row.receiver_id),
    [2, 3]
  )
  assert.equal(list[0].sender, 'in_app:issue_activities:subscribed')
  assert.equal(list[0].title, 'updated the name to')
  // Member 2 turned property_change off, so only member 3 gets an email log.
  assert.deepEqual(
    rows(sqlite, 'SELECT receiver_id FROM email_notification_logs').map(row => row.receiver_id),
    [3]
  )
  assert.equal(rows(sqlite, 'SELECT count(*) AS n FROM issue_subscribers WHERE subscriber_id = 1').at(0).n, 1)
  // Skipped types do nothing.
  await dispatchJob(env, {
    type: 'notification.issue',
    payload: {
      type: 'issue_vote.activity.created',
      issueId: 1,
      actorId: 1,
      projectId: 1,
      issueActivitiesCreated: [activity]
    }
  })
  assert.equal(rows(sqlite, 'SELECT count(*) AS n FROM notifications').at(0).n, 2)
})

test('mentions notify project members, subscribe them and skip the actor', async () => {
  const { sqlite, env } = createEnv()
  const html = `<p>${mention(2)}${mention(1)}</p>`
  sqlite.prepare('UPDATE issues SET description_html = ? WHERE id = 1').run(html)
  sqlite.exec(
    "INSERT INTO issue_activities(id,verb,field,old_value,new_value,comment,issue_id,project_id,workspace_id,actor_id) VALUES(5,'updated','description','','x','updated the description',1,1,1,1)"
  )
  await notifications(env, {
    type: 'issue.activity.updated',
    issueId: 1,
    actorId: 1,
    projectId: 1,
    subscriber: false,
    issueActivitiesCreated: [
      { id: 5, verb: 'updated', field: 'description', issueId: 1, actorId: 1, newValue: 'x', oldValue: '', comment: '' }
    ],
    requestedData: { description_html: html },
    currentInstance: { description_html: '<p></p>' }
  })
  const mentioned = rows(sqlite, "SELECT receiver_id, message FROM notifications WHERE sender LIKE '%mentioned'")
  assert.deepEqual(
    mentioned.map(row => row.receiver_id),
    [2]
  )
  assert.match(mentioned[0].message, /You have been mentioned in the issue A/)
  assert.equal(rows(sqlite, 'SELECT count(*) AS n FROM issue_mentions WHERE mention_id = 2').at(0).n, 1)
  // The issue creator (user 1) is never added as a mention subscriber.
  const db = drizzle(env.DB)
  assert.deepEqual(await extractMentionsAsSubscribers(db, 1, 1, [1, 2, 3]), [])
})

test('email lock and stacking (PD-1124 to PD-1126)', async () => {
  const { sqlite, env, sent } = createEnv()
  const db = drizzle(env.DB)
  assert.equal(await acquireLock(db, 'k'), true)
  assert.equal(await acquireLock(db, 'k'), false)
  await releaseLock(db, 'k')
  assert.equal(await acquireLock(db, 'k'), true)
  for (const [receiver, issue] of [
    [2, 1],
    [2, 1],
    [3, 1],
    [2, 2]
  ])
    sqlite.exec(
      `INSERT INTO email_notification_logs(receiver_id,triggered_by_id,entity_identifier,entity_name,entity,data) VALUES(${receiver},1,${issue},'issue','','{}')`
    )
  assert.equal(await stackEmailNotification(env), 3)
  assert.equal(sent.length, 3)
  assert.ok(sent.every(message => message.type === 'notification.email.send'))
  assert.equal(rows(sqlite, 'SELECT count(*) AS n FROM email_notification_logs WHERE processed_at IS NULL').at(0).n, 0)
  assert.equal(await stackEmailNotification(env), 0)
})
