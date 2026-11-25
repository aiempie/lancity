import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { getDb } from '../src/db/client'
import { createLocalD1 } from '../scripts/maintenance/d1-shim'
import { bulkDeleteIssues } from '../src/server/issue/archive'
import type { InfraEnv } from '../src/server/common/env'

test('bulk delete commits its activity and cascade outboxes with the mutation', async () => {
  const raw = new DatabaseSync(':memory:')
  for (const name of readdirSync('drizzle').filter(name => /^\d+.*\.sql$/.test(name)).sort())
    raw.exec(readFileSync(`drizzle/${name}`, 'utf8'))
  raw.exec(`pragma foreign_keys = on;
    insert into user(id, name, email, email_verified, created_at, updated_at) values (1, 'Admin', 'admin@example.com', 1, 1, 1);
    insert into workspaces(id, name, slug, owner_id) values (1, 'Workspace', 'ws', 1);
    insert into workspace_members(workspace_id, member_id, role) values (1, 1, 20);
    insert into projects(id, name, identifier, workspace_id) values (1, 'Project', 'PRJ', 1);
    insert into project_members(project_id, workspace_id, member_id, role) values (1, 1, 1, 20);
    insert into issues(id, name, project_id, workspace_id, sequence_id) values (1, 'Issue', 1, 1, 1);
    create trigger reject_cascade_outbox before insert on job_outbox
      when new.type = 'maintenance.soft_delete_related' begin select raise(abort, 'outbox failed'); end;`)
  const d1 = createLocalD1(raw)
  const db = getDb(d1)
  const env = { DB: d1, JOBS_QUEUE: { send: async () => { throw new Error('queue unavailable') } } } as unknown as InfraEnv
  const count = (query: string) => (raw.prepare(query).get() as { n: number }).n
  await assert.rejects(bulkDeleteIssues(db, { userId: 1 }, 'ws', 1, { issueIds: [1] }, env), /outbox failed/)
  assert.equal(count('select count(*) n from issues where deleted_at is null'), 1)
  assert.equal(count('select count(*) n from issue_activities'), 0)
  assert.equal(count('select count(*) n from job_outbox'), 0)
  raw.exec('drop trigger reject_cascade_outbox')
  await bulkDeleteIssues(db, { userId: 1 }, 'ws', 1, { issueIds: [1] }, env)
  assert.equal(count('select count(*) n from issues where deleted_at is not null'), 1)
  assert.equal(count("select count(*) n from issue_activities a join job_outbox o on a.mutation_id = o.event_key where o.type = 'issue.activity'"), 1)
  assert.equal(count("select count(*) n from job_outbox where type = 'maintenance.soft_delete_related' and published_at is null"), 1)
})
