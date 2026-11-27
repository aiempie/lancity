import assert from 'node:assert/strict'
import { openTargetDatabase } from '../scripts/plane-import/target-schema'
import { test } from 'vitest'
import { getDb } from '../src/db/client'
import { createLocalD1 } from '../scripts/maintenance/d1-shim'
import { dispatchJob } from '../src/server/common/jobs'
import { MAINTENANCE_JOB, register as registerMaintenance } from '../src/server/maintenance/jobs'
import type { InfraEnv } from '../src/server/common/env'
import { cascadeGraph, softDeleteRelatedObjects } from '../src/server/maintenance/cascade'
import { CLEANUP_TASKS, cleanupSpec, processCleanupTask } from '../src/server/maintenance/cleanup'
import { hardDelete, hardDeleteTables } from '../src/server/maintenance/deletion'
import { createDummyData, createRng } from '../src/server/maintenance/dummy-data'
import { processLogs } from '../src/server/maintenance/logger'
import {
  INSTANCE_CONFIG_VARIABLES,
  activateUser,
  clearCache,
  checkForCurrentVersion,
  configureInstance,
  registerInstance,
  strictStrToInt,
  updateDeletedWorkspaceSlug
} from '../src/server/maintenance/ops'
import { parseLooseJson, readSeedFile, seedProjectNames } from '../src/server/maintenance/seed-data'
import { dummyDataSchema, fixDuplicateSequencesSchema } from '../src/types/instance/p4-maintenance-schema'

const DAY = 86_400_000

/** In-memory database with all migrations applied (no Wrangler needed). */
function openDb() {
  const raw = openTargetDatabase('drizzle')
  raw.exec(`PRAGMA foreign_keys = ON;
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (1, 'Admin', 'admin@example.com', 1, 1, 1);
    INSERT INTO workspaces (id, name, slug, owner_id) VALUES (1, 'Workspace', 'ws', 1), (2, 'Other', 'other', 1);
    INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (1, 1, 20), (2, 1, 20);
    INSERT INTO projects (id, name, identifier, workspace_id) VALUES (1, 'First', 'FIRST', 1), (2, 'Second', 'SECOND', 1);`)
  const db = getDb(createLocalD1(raw))
  const count = (table: string, where = '1') => (raw.prepare(`select count(*) as n from ${table} where ${where}`).get() as { n: number }).n
  return { raw, db, count }
}

test('cleanup deletes only expired log rows, in batches, including soft deleted ones', async () => {
  const { raw, db, count } = openDb()
  const now = Date.UTC(2026, 5, 1)
  const insert = raw.prepare(
    "insert into api_activity_logs (token_identifier, path, method, response_code, created_at, deleted_at) values ('t', '/p', 'GET', 200, ?, ?)"
  )
  insert.run(now - 20 * DAY, null)
  insert.run(now - 20 * DAY, now - DAY)
  insert.run(now - 2 * DAY, null)
  const result = await processCleanupTask(db, 'api_logs', { days: 14, now })
  assert.deepEqual({ deleted: result.deleted, done: result.done, failed: result.failed }, { deleted: 2, done: true, failed: false })
  assert.equal(count('api_activity_logs'), 1)
  assert.deepEqual([...CLEANUP_TASKS].sort(), ['api_logs', 'email_logs', 'issue_description_versions', 'job_claims', 'page_versions', 'webhook_logs'])
  assert.match(cleanupSpec('page_versions').ids(0), /row_number\(\) over \(partition by page_id/)
})

test('page versions beyond the newest 20 per page are removed', async () => {
  const { raw, db, count } = openDb()
  raw.exec("insert into pages (id, name, owned_by_id, workspace_id) values (1, 'P', 1, 1), (2, 'Q', 1, 1)")
  const insert = raw.prepare('insert into page_versions (page_id, owned_by_id, workspace_id, created_at) values (?, 1, 1, ?)')
  for (let i = 0; i < 23; i++) insert.run(1, 1000 + i)
  for (let i = 0; i < 5; i++) insert.run(2, 1000 + i)
  const result = await processCleanupTask(db, 'page_versions')
  assert.equal(result.deleted, 3)
  assert.equal(count('page_versions', 'page_id = 1'), 20)
  assert.equal(count('page_versions', 'page_id = 1 and created_at < 1003'), 0)
  assert.equal(count('page_versions', 'page_id = 2'), 5)
})

test('soft delete cascades through child tables, sets null, and leaves other rows alone', async () => {
  const { raw, db, count } = openDb()
  raw.exec(`insert into labels (id, name, project_id, workspace_id) values (1, 'a', 1, 1), (2, 'b', 2, 1);
    insert into issues (id, name, project_id, workspace_id, sequence_id) values (1, 'i1', 1, 1, 1), (2, 'i2', 1, 1, 2), (3, 'i3', 2, 1, 1);
    insert into issues (id, name, project_id, workspace_id, sequence_id, parent_id) values (4, 'sub', 1, 1, 3, 1);
    insert into issue_labels (issue_id, label_id, project_id, workspace_id) values (1, 1, 1, 1), (3, 2, 2, 1);`)
  const graph = cascadeGraph()
  assert.ok(graph.edges.some(e => e.child === 'issues' && e.parent === 'projects' && e.onDelete === 'cascade'))
  assert.equal(graph.tables.get('user')?.softDelete, false)
  const result = await softDeleteRelatedObjects(db, 'projects', 1, new Date(5000))
  assert.ok(result.rows >= 5)
  assert.equal(count('projects', 'id = 1 and deleted_at = 5000'), 1)
  assert.equal(count('issues', 'project_id = 1 and deleted_at = 5000'), 3)
  assert.equal(count('labels', 'id = 1 and deleted_at = 5000'), 1)
  assert.equal(count('issue_labels', 'issue_id = 1 and deleted_at = 5000'), 1)
  assert.equal(count('issues', 'project_id = 2 and deleted_at is null'), 1)
  assert.equal(count('issue_labels', 'issue_id = 3 and deleted_at is null'), 1)
  // Rerunning keeps the first stamp (rows that are already deleted are not visited again).
  await softDeleteRelatedObjects(db, 'projects', 1, new Date(9000))
  assert.equal(count('issues', 'deleted_at = 9000'), 0)
  assert.deepEqual(await softDeleteRelatedObjects(db, 'user', 1), { levels: 0, rows: 0 })
})

test('cascade resumes a failed second level with its original stamp and all branches', async () => {
  const { raw, db, count } = openDb()
  raw.exec(`insert into issues (id, name, project_id, workspace_id, sequence_id) values (1, 'root', 1, 1, 1);
    insert into issues (id, name, project_id, workspace_id, sequence_id, parent_id)
      values (2, 'child', 1, 1, 2, 1), (3, 'sibling', 1, 1, 3, 1), (4, 'grandchild', 1, 1, 4, 2);
    insert into issue_comments (issue_id, project_id, workspace_id, comment_html, comment_stripped)
      values (2, 1, 1, '<p>child</p>', 'child'), (3, 1, 1, '<p>sibling</p>', 'sibling');
    create trigger fail_cascade before update of deleted_at on issue_comments
      when old.issue_id = 2 begin select raise(abort, 'forced level two failure'); end;`)
  await assert.rejects(softDeleteRelatedObjects(db, 'issues', 1, new Date(5000), 'retry-test'), /forced level two failure/)
  assert.equal(count('issues', 'id in (1, 2, 3) and deleted_at = 5000'), 3)
  assert.equal(count('issue_comments', 'deleted_at is null'), 2)
  raw.exec('drop trigger fail_cascade')
  await softDeleteRelatedObjects(db, 'issues', 1, new Date(9000), 'retry-test')
  assert.equal(count('issues', 'deleted_at = 5000'), 4)
  assert.equal(count('issue_comments', 'deleted_at = 5000'), 2)
  assert.equal(count('cascade_nodes', 'processed = 0'), 0)
  await softDeleteRelatedObjects(db, 'issues', 1, new Date(12000), 'retry-test')
  assert.equal(count('issues', 'deleted_at != 5000'), 0)
})

test('large cascade continues via an outbox job with the original job key and timestamp', async () => {
  const { raw, count } = openDb()
  raw.exec("insert into issues (id, name, project_id, workspace_id, sequence_id, deleted_at) values (1, 'root', 1, 1, 1, 5000)")
  const insert = raw.prepare("insert into issues (id, name, project_id, workspace_id, sequence_id, parent_id) values (?, 'child', 1, 1, ?, 1)")
  for (let i = 2; i <= 1601; i++) insert.run(i, i)
  const messages: unknown[] = []
  const env = { DB: createLocalD1(raw), JOBS_QUEUE: { send: async (message: unknown) => { messages.push(message) } } } as unknown as InfraEnv
  registerMaintenance()
  await dispatchJob(env, { type: MAINTENANCE_JOB.softDeleteRelated, payload: { model: 'issues', id: 1 }, id: 'large-cascade' })
  assert.ok(count('cascade_nodes', 'processed = 0') > 0)
  const continuation = raw.prepare("select event_key, payload from job_outbox where type = ?").get(MAINTENANCE_JOB.softDeleteRelated) as { event_key: string; payload: string }
  assert.match(continuation.event_key, /^large-cascade:continue:/)
  assert.equal(JSON.parse(continuation.payload).jobKey, 'large-cascade')
  assert.equal(messages.length, 1)
  await dispatchJob(env, { type: MAINTENANCE_JOB.softDeleteRelated, payload: JSON.parse(continuation.payload), id: 'new-delivery-id' })
  assert.equal(count('cascade_nodes', 'processed = 0'), 0)
  assert.equal(count('issues', 'deleted_at = 5000'), 1601)
  assert.equal(count('cascade_jobs'), 1)
})

test('hard delete removes rows soft deleted before the cutoff and keeps newer ones', async () => {
  const { raw, db, count } = openDb()
  const now = Date.UTC(2026, 5, 1)
  raw.prepare("insert into labels (id, name, project_id, workspace_id, deleted_at) values (1, 'old', 1, 1, ?), (2, 'new', 1, 1, ?), (3, 'live', 1, 1, NULL)").run(
    now - 61 * DAY,
    now - 10 * DAY
  )
  const result = await hardDelete(db, { days: 60, now })
  assert.equal(result.deleted.labels, 1)
  assert.equal(result.next, null)
  assert.deepEqual(
    (raw.prepare('select id from labels order by id').all() as { id: number }[]).map(r => r.id),
    [2, 3]
  )
  assert.equal(count('workspaces'), 2)
  const tables = hardDeleteTables()
  assert.equal(tables[0], 'workspaces')
  assert.ok(!tables.includes('user'))
  assert.equal(new Set(tables).size, tables.length)
})

test('hard delete can stop on its statement budget and resume', async () => {
  const { db } = openDb()
  const first = await hardDelete(db, { budget: 3 })
  assert.ok(first.next !== null && first.next > 0)
  const rest = await hardDelete(db, { from: first.next })
  assert.equal(rest.next, null)
})

test('process_logs stores a valid log and drops an invalid one', async () => {
  const { db, count } = openDb()
  const ok = await processLogs(db, {
    token_identifier: 'abc',
    path: '/api/v1/x',
    method: 'POST',
    response_code: 201,
    body: '{}',
    mongo_log: 'ignored'
  })
  assert.equal(ok, true)
  assert.equal(count('api_activity_logs', "token_identifier = 'abc' and response_code = 201"), 1)
  assert.equal(await processLogs(db, { path: '/x' }), false)
})

test('seed files are bundled and parsed like the Plane seed', () => {
  assert.equal(readSeedFile('projects.json')?.length, 1)
  assert.equal(readSeedFile('issues.json')?.length, 7)
  assert.equal(readSeedFile('states.json')?.length, 5)
  assert.equal(readSeedFile('missing.json'), null)
  const pages = readSeedFile<Record<string, unknown>>('pages.json') ?? []
  assert.equal(pages.length, 2)
  for (const page of pages) {
    assert.equal(typeof parseLooseJson(page.logo_props), 'object')
    assert.equal((parseLooseJson(page.logo_props).emoji as { value: string }).value.length > 0, true)
    assert.equal(parseLooseJson(page.description).type, 'doc')
  }
  assert.deepEqual(parseLooseJson("{'a': True, 'b': None}"), { a: true, b: null })
  assert.deepEqual(parseLooseJson('nope'), {})
  assert.deepEqual(seedProjectNames('My Team & Co. 2026'), { name: 'My Team  Co 2026', identifier: 'MyTea' })
  assert.deepEqual(seedProjectNames('日本語'), { name: '日本語', identifier: 'PROJ' })
})

test('dummy data creates a project with the requested amount of linked rows', async () => {
  const { db, count } = openDb()
  const input = dummyDataSchema.parse({
    slug: 'ws',
    email: 'admin@example.com',
    issueCount: 8,
    cycleCount: 1,
    moduleCount: 2,
    pagesCount: 2,
    intakeIssueCount: 3
  })
  const result = await createDummyData(db, input, { rng: createRng(7), now: Date.UTC(2026, 5, 1) })
  const where = `project_id = ${result.projectId}`
  assert.equal(count('projects', `id = ${result.projectId}`), 1)
  assert.equal(count('states', where), 5)
  assert.equal(count('labels', where), 50)
  assert.equal(count('cycles', where), 2) // Plane creates cycle_count + 1
  assert.equal(count('modules', where), 2)
  assert.equal(count('project_pages', where), 2)
  assert.equal(count('issues', where), 11)
  assert.equal(count('issue_sequences', where), 11)
  assert.equal(count('issue_activities', where), 11)
  assert.equal(count('intake_issues', where), 3)
  assert.equal(count('project_issue_counters', `${where} and last_sequence = 11`), 1)
  await assert.rejects(createDummyData(db, { ...input, slug: 'nope' }), /does not exist/)
})

test('maintenance operations on accounts, cache and workspaces', async () => {
  const { raw, db, count } = openDb()
  await activateUser(db, 'ADMIN@example.com')
  assert.equal(count('user_security', 'user_id = 1 and is_active = 1'), 1)
  await assert.rejects(activateUser(db, 'nobody@example.com'), /does not exist/)

  raw.exec("insert into cache_entries (key, value, expires_at) values ('a', '1', 1), ('b', '2', 1)")
  await clearCache(db, 'a')
  assert.equal(count('cache_entries'), 1)
  await clearCache(db)
  assert.equal(count('cache_entries'), 0)

  assert.equal((await updateDeletedWorkspaceSlug(db, { slug: 'ws' })).status, 'not_deleted')
  assert.equal((await updateDeletedWorkspaceSlug(db, { slug: 'zzz' })).status, 'not_found')
  raw.exec('update workspaces set deleted_at = 1700000000000 where id = 2')
  const dry = await updateDeletedWorkspaceSlug(db, { slug: 'other', dryRun: true })
  assert.deepEqual([dry.status, dry.slug], ['dry_run', 'other__1700000000'])
  assert.equal(count('workspaces', "slug = 'other'"), 1)
  assert.equal((await updateDeletedWorkspaceSlug(db, { slug: 'other' })).status, 'updated')
  assert.equal(count('workspaces', "slug = 'other__1700000000'"), 1)
  assert.equal((await updateDeletedWorkspaceSlug(db, { slug: 'other__1700000000' })).status, 'already_updated')

  assert.equal(strictStrToInt('-12'), -12)
  assert.throws(() => strictStrToInt('1.5'), /Invalid integer string/)
})

test('configure_instance fills missing rows once and register_instance is idempotent', async () => {
  const { db, count } = openDb()
  await assert.rejects(configureInstance(db, {}, async v => v), /BETTER_AUTH_SECRET/)
  const first = await configureInstance(db, { BETTER_AUTH_SECRET: 's', ENABLE_SIGNUP: '0', GOOGLE_CLIENT_SECRET: 'shh' }, async v => `enc:${v}`)
  assert.equal(first.created.length, INSTANCE_CONFIG_VARIABLES.length)
  assert.equal(count('instance_configurations', "key = 'ENABLE_SIGNUP' and value = '0'"), 1)
  assert.equal(count('instance_configurations', "key = 'GOOGLE_CLIENT_SECRET' and value = 'enc:shh' and is_encrypted = 1"), 1)
  const second = await configureInstance(db, { BETTER_AUTH_SECRET: 's' }, async v => v)
  assert.deepEqual(second.created, [])

  const failing = (async () => {
    throw new Error('offline')
  }) as unknown as typeof fetch
  const created = await registerInstance(db, { env: { APP_VERSION: 'v1.2.3' }, fetcher: failing })
  assert.deepEqual([created.registered, created.currentVersion, created.latestVersion], [true, 'v1.2.3', 'v1.2.3'])
  const again = await registerInstance(db, { env: {}, fetcher: failing })
  assert.deepEqual([again.registered, again.instanceId], [false, created.instanceId])
  assert.equal(count('instances'), 1)
  assert.equal(checkForCurrentVersion({}), 'v0.1.0')
})

test('maintenance inputs are validated', () => {
  assert.throws(() => dummyDataSchema.parse({ slug: 'ws', email: 'x' }))
  assert.throws(() => dummyDataSchema.parse({ slug: 'ws', email: 'a@b.co', issueCount: 100000 }))
  assert.equal(dummyDataSchema.parse({ slug: 'ws', email: 'A@B.co' }).email, 'a@b.co')
  assert.ok(fixDuplicateSequencesSchema.safeParse({ workspaceSlug: 'ws', issueIdentifier: 'PROJ-12' }).success)
  assert.ok(!fixDuplicateSequencesSchema.safeParse({ workspaceSlug: 'ws', issueIdentifier: 'PROJ12' }).success)
})
