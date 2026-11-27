import assert from 'node:assert/strict'
import { test } from 'vitest'
import { getDb } from '../src/db/client'
import { createLocalD1 } from '../scripts/maintenance/d1-shim'
import { openTargetDatabase } from '../scripts/plane-import/target-schema'
import { archiveIssue, unarchiveIssue } from '../src/server/issue/archive'
import { register as registerIssueJobs } from '../src/server/issue/jobs/index'
import { presentIssueApi } from '../src/server/issue/issue-presenters'
import { getIssueById, paginateIssues, issueListContext } from '../src/server/issue/list'
import { createState, createIssue, deleteIssue, listIssueActivities, listIssues, updateIssue } from '../src/server/issue/service'
import { createSubIssues, getSubIssues } from '../src/server/issue/sub-issue'
import { register as registerMaintenanceJobs } from '../src/server/maintenance/jobs'
import { dispatchJob, type JobMessage } from '../src/server/common/jobs'
import type { InfraEnv } from '../src/server/common/env'

const admin = { userId: 1 }

registerIssueJobs()
registerMaintenanceJobs()

/** In-memory database with all migrations, a workspace with one project and three members. */
function openDb() {
  const raw = openTargetDatabase('drizzle')
  raw.exec(`PRAGMA foreign_keys = ON;
    INSERT INTO user(id,name,email,username,created_at,updated_at) VALUES(1,'Owner','owner@example.com',NULL,1,1),(2,'Mia','mia@example.com','mia',1,1),(3,'Leo','leo@example.com',NULL,1,1);
    INSERT INTO workspaces(id,name,slug,owner_id) VALUES(1,'Workspace','ws',1);
    INSERT INTO workspace_members(workspace_id,member_id,role) VALUES(1,1,20),(1,2,15),(1,3,15);
    INSERT INTO projects(id,name,identifier,workspace_id) VALUES(1,'Project','PRJ',1);
    INSERT INTO project_members(project_id,workspace_id,member_id,role) VALUES(1,1,1,20),(1,1,2,15),(1,1,3,15);`)
  const d1 = createLocalD1(raw)
  const db = getDb(d1)
  const count = (table: string, where = '1') => (raw.prepare(`select count(*) as n from ${table} where ${where}`).get() as { n: number }).n
  return { raw, d1, db, count }
}

/** Env with a fake Queue that records every job message instead of running it. */
function fakeEnv(d1: D1Database) {
  const sent: Array<JobMessage<{ outboxId: number }>> = []
  const env = { DB: d1, JOBS_QUEUE: { send: async (body: JobMessage<{ outboxId: number }>) => void sent.push(body) } } as unknown as InfraEnv
  function published(raw: ReturnType<typeof openTargetDatabase>, type: string) {
    const read = raw.prepare('SELECT payload FROM job_outbox WHERE id = ? AND type = ?')
    return sent.flatMap(message => {
      if (message.type !== 'outbox.dispatch' || !message.payload) return []
      const row = read.get(message.payload.outboxId, type) as { payload: string } | undefined
      return row ? [{ message, payload: JSON.parse(row.payload) }] : []
    })
  }
  return { env, sent, published }
}

test('deleting an issue queues the cascade and hides its sub-issues immediately', async () => {
  const { raw, d1, db, count } = openDb()
  const { env, sent, published } = fakeEnv(d1)
  raw.exec(`INSERT INTO labels(id,name,color,project_id,workspace_id) VALUES(1,'Bug','#f00',1,1)`)
  const parent = await createIssue(db, admin, 'ws', 1, { name: 'Parent', assigneeIds: [2], labelIds: [1] }, env)
  const child = await createIssue(db, admin, 'ws', 1, { name: 'Child', parentId: parent.id }, env)
  raw.exec(`INSERT INTO issue_comments(issue_id,project_id,workspace_id,comment_html,comment_stripped) VALUES(${parent.id},1,1,'<p>x</p>','x');
    INSERT INTO issue_links(issue_id,project_id,workspace_id,url) VALUES(${parent.id},1,1,'https://example.com');
    INSERT INTO issue_comments(issue_id,project_id,workspace_id,comment_html,comment_stripped) VALUES(${child.id},1,1,'<p>y</p>','y')`)
  assert.equal(count('issue_assignees', 'deleted_at is null'), 1)
  assert.equal((await getSubIssues(db, admin, 'ws', 1, parent.id)).subIssues.length, 1)

  sent.length = 0
  await deleteIssue(db, admin, 'ws', 1, parent.id, env)
  const [cascade] = published(raw, 'maintenance.soft_delete_related')
  assert.equal(cascade?.payload.model, 'issues')
  assert.equal(cascade?.payload.id, parent.id)

  // Before the queue consumer runs, the child is already gone from every list.
  assert.equal((await getSubIssues(db, admin, 'ws', 1, parent.id)).subIssues.length, 0)
  const page = await paginateIssues(db, await issueListContext(db, admin, 'ws', 1), {})
  assert.equal((page.results as unknown[]).length, 0)
  assert.equal((await listIssues(db, admin, 'ws', 1)).length, 0)

  // The consumer runs `softDeleteRelatedObjects` with the queued payload.
  await dispatchJob(env, cascade.message)
  assert.equal(count('issues', `id = ${child.id} and deleted_at is not null`), 1)
  assert.equal(count('issue_comments', 'deleted_at is null'), 0)
  assert.equal(count('issue_links', 'deleted_at is null'), 0)
  assert.equal(count('issue_assignees', 'deleted_at is null'), 0)
  assert.equal(count('issue_labels', 'deleted_at is null'), 0)
  assert.equal(count('issue_subscribers', 'deleted_at is null'), 0)
  // The sequence stays reserved (Plane SET_NULL), so numbers are never reused.
  const next = await createIssue(db, admin, 'ws', 1, { name: 'Next' }, env)
  assert.equal(next.sequenceId, 3)
})

test('an archived issue can be deleted', async () => {
  const { db, count } = openDb()
  const done = await createState(db, admin, 'ws', 1, { name: 'Done', color: '#0f0', group: 'completed' })
  const issue = await createIssue(db, admin, 'ws', 1, { name: 'Done soon', stateId: done.id })
  await archiveIssue(db, admin, 'ws', 1, issue.id)
  assert.equal(count('issues', 'archived_at is not null'), 1)
  await deleteIssue(db, admin, 'ws', 1, issue.id)
  assert.equal(count('issues', `id = ${issue.id} and deleted_at is not null`), 1)
  await assert.rejects(deleteIssue(db, admin, 'ws', 1, issue.id), (error: { status?: number }) => error.status === 404)
})

test('inline activities match the Plane trackers', async () => {
  const { raw, db } = openDb()
  raw.exec(`INSERT INTO estimates(id,name,project_id,workspace_id,type) VALUES(1,'Points',1,1,'points');
    INSERT INTO estimate_points(id,key,value,estimate_id,project_id,workspace_id) VALUES(1,0,'3',1,1,1),(2,1,'5',1,1,1)`)
  const done = await createState(db, admin, 'ws', 1, { name: 'Done', color: '#0f0', group: 'completed' })
  const parent = await createIssue(db, admin, 'ws', 1, { name: 'Parent' })
  const other = await createIssue(db, admin, 'ws', 1, { name: 'Other' })
  const issue = await createIssue(db, admin, 'ws', 1, { name: 'Child', assigneeIds: [2] })

  // Creating with an assignee records `added assignee` and subscribes the assignee (Plane `create_issue_activity`).
  let activities = await listIssueActivities(db, admin, 'ws', 1, issue.id)
  const added = activities.find(activity => activity.comment === 'added assignee ')
  assert.equal(added?.field, 'assignees')
  assert.equal(added?.newValue, 'mia')
  assert.equal(added?.newIdentifier, 2)
  assert.equal((raw.prepare('select count(*) as n from issue_subscribers where issue_id = ? and subscriber_id = 2').get(issue.id) as { n: number }).n, 1)

  await updateIssue(db, admin, 'ws', 1, issue.id, { parentId: parent.id })
  await updateIssue(db, admin, 'ws', 1, issue.id, { parentId: other.id })
  await updateIssue(db, admin, 'ws', 1, issue.id, { estimatePointId: 1 })
  await updateIssue(db, admin, 'ws', 1, issue.id, { estimatePointId: null })
  activities = await listIssueActivities(db, admin, 'ws', 1, issue.id)
  const parents = activities.filter(activity => activity.field === 'parent').reverse()
  assert.deepEqual(parents.map(a => [a.oldValue, a.newValue]), [['', 'PRJ-1'], ['PRJ-1', 'PRJ-2']])
  const estimates = activities.filter(activity => activity.field === 'estimate_points').reverse()
  assert.deepEqual(estimates.map(a => [a.verb, a.oldValue, a.newValue]), [['updated', null, '3'], ['removed', '3', null]])

  // Archive and restore use the Plane values, not dates.
  await updateIssue(db, admin, 'ws', 1, issue.id, { stateId: done.id })
  await archiveIssue(db, admin, 'ws', 1, issue.id)
  await unarchiveIssue(db, admin, 'ws', 1, issue.id)
  activities = await listIssueActivities(db, admin, 'ws', 1, issue.id)
  const archive = activities.filter(activity => activity.field === 'archived_at').reverse()
  assert.deepEqual(archive.map(a => [a.oldValue, a.newValue]), [[null, 'manual_archive'], ['archive', 'restore']])

  // Sub-issue attach writes the same `PROJ-12` label.
  await createSubIssues(db, admin, 'ws', 1, parent.id, { subIssueIds: [issue.id] })
  const last = (await listIssueActivities(db, admin, 'ws', 1, issue.id)).find(activity => activity.field === 'parent')
  assert.deepEqual([last?.oldValue, last?.newValue], ['PRJ-2', 'PRJ-1'])
})

test('create and update queue the description version job, which merges within 600 seconds', async () => {
  const { raw, d1, db, count } = openDb()
  const { env, sent, published } = fakeEnv(d1)
  const descriptionJob = 'issue.description_version.update'
  const issue = await createIssue(db, admin, 'ws', 1, { name: 'Doc', descriptionHtml: '<p>one</p>' }, env)
  const [created] = published(raw, descriptionJob)
  assert.equal(created?.payload.issueId, issue.id)
  assert.equal(created?.payload.isCreating, true)
  await dispatchJob(env, created.message)
  assert.equal(count('issue_description_versions'), 1)

  sent.length = 0
  await updateIssue(db, admin, 'ws', 1, issue.id, { descriptionHtml: '<p>two</p>' }, env)
  const [updated] = published(raw, descriptionJob)
  assert.deepEqual(updated?.payload.updatedIssue, { description_html: '<p>one</p>' })
  await dispatchJob(env, updated.message)
  // Same user inside the window: the existing version is updated, not duplicated.
  assert.equal(count('issue_description_versions'), 1)
  assert.equal((await getIssueById(db, admin, 'ws', 1, issue.id)).descriptionHtml, '<p>two</p>')

  // A name-only update queues nothing.
  sent.length = 0
  await updateIssue(db, admin, 'ws', 1, issue.id, { name: 'Doc 2' }, env)
  assert.equal(published(raw, descriptionJob).length, 0)
})

test('description HTML is stored sanitized', async () => {
  const { db } = openDb()
  const html = '<p onclick="steal()">hello</p><img src="x" onerror="steal()">'
  const outcome = await createIssue(db, admin, 'ws', 1, { name: 'Xss', descriptionHtml: html }).then(
    issue => ({ issue }),
    (error: { status?: number }) => ({ error })
  )
  if ('issue' in outcome) assert.doesNotMatch(String(outcome.issue.descriptionHtml), /onclick|onerror/i)
  else assert.equal(outcome.error.status, 400)
})

test('assignees that left the project are not listed, and the API presenter applies fields and expand', async () => {
  const { raw, db } = openDb()
  const issue = await createIssue(db, admin, 'ws', 1, { name: 'Team', assigneeIds: [2, 3] })
  raw.exec('UPDATE project_members SET is_active = 0 WHERE member_id = 3')
  const detail = await getIssueById(db, admin, 'ws', 1, issue.id)
  assert.deepEqual(detail.assigneeIds, [2])
  const page = await paginateIssues(db, await issueListContext(db, admin, 'ws', 1), {})
  assert.deepEqual((page.results as Array<{ assigneeIds: number[] }>)[0].assigneeIds, [2])

  // A raw row from create has no id lists: the presenter adds the active ones, hides the binary, expands, limits fields.
  const full = await presentIssueApi(db, issue, { expand: 'assignees' })
  assert.deepEqual(full.assigneeIds, [2])
  assert.deepEqual((full.assignees as Array<{ id: number }>).map(a => a.id), [2])
  assert.equal('descriptionBinary' in full, false)
  const limited = await presentIssueApi(db, issue, { fields: 'name,assignee_ids' })
  assert.deepEqual(Object.keys(limited).sort(), ['assigneeIds', 'id', 'name'])
})
