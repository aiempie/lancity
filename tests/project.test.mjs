import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../src/db/schema.ts'
import { joinProject, leaveProject } from '../src/server/project/member.ts'

function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  for (const migration of ['drizzle/0000_auth.sql', 'drizzle/0001_plane_domain.sql'])
    sqlite.exec(readFileSync(migration, 'utf8'))
  sqlite.exec(`PRAGMA foreign_keys = ON;
    INSERT INTO user(id,name,email,created_at,updated_at) VALUES(1,'Owner','owner@example.com',1,1),(2,'Member','member@example.com',1,1),(3,'Admin','admin@example.com',1,1),(4,'Guest','guest@example.com',1,1);
    INSERT INTO workspaces(id,name,slug,owner_id) VALUES(1,'Workspace','ws',1),(2,'Other','other',1);
    INSERT INTO workspace_members(workspace_id,member_id,role) VALUES(1,1,20),(1,2,15),(1,3,20),(1,4,5),(2,1,20);
    INSERT INTO projects(id,name,identifier,workspace_id) VALUES(1,'Project','P',1),(2,'Secret','S',1),(3,'Other','O',2); UPDATE projects SET network=0 WHERE id=2;
    INSERT INTO project_members(project_id,workspace_id,member_id,role) VALUES(1,1,1,20),(1,1,3,20),(3,2,1,20);
    INSERT INTO pages(id,name,workspace_id,owned_by_id,access,description_stripped) VALUES(1,'Page',1,1,0,'old');
    INSERT INTO project_pages(project_id,workspace_id,page_id) VALUES(1,1,1);`)
  let beforeMutation
  function prepare(query) {
    return {
      bind(...params) {
        function runInterleave() {
          if (
            (/^update "project_members"/i.test(query) || /^insert into project_members/i.test(query)) &&
            beforeMutation
          ) {
            const change = beforeMutation
            beforeMutation = undefined
            change(sqlite)
          }
        }
        function execute() {
          runInterleave()
          const stmt = sqlite.prepare(query)
          return { results: stmt.columns().length ? stmt.all(...params) : (stmt.run(...params), []) }
        }
        return {
          async raw() {
            runInterleave()
            const stmt = sqlite.prepare(query)
            stmt.setReturnArrays(true)
            return stmt.all(...params)
          },
          async all() {
            return execute()
          },
          async run() {
            return execute()
          },
          execute
        }
      }
    }
  }
  const d1 = {
    prepare,
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const result = statements.map(statement => statement.execute())
        sqlite.exec('COMMIT')
        return result
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    }
  }
  return {
    sqlite,
    db: drizzle(d1, { schema }),
    interleave(fn) {
      beforeMutation = fn
    }
  }
}

test('joining uses current workspace role, reactivates safely and is idempotent', async () => {
  const { sqlite, db } = fixture()
  sqlite.exec('INSERT INTO project_members(project_id,workspace_id,member_id,role,is_active) VALUES(1,1,2,20,0)')
  const member = await joinProject(db, { userId: 2 }, 'ws', 1)
  assert.equal(member.role, 15)
  assert.equal((await joinProject(db, { userId: 2 }, 'ws', 1)).id, member.id)
  assert.equal(
    sqlite.prepare('SELECT count(*) AS n FROM project_user_properties WHERE project_id=1 AND user_id=2').get().n,
    1
  )
  sqlite.close()
})

test('join denies guests, secret project members and cross-workspace IDs; admins may join secret projects', async () => {
  const { sqlite, db } = fixture()
  await assert.rejects(joinProject(db, { userId: 4 }, 'ws', 1), error => error.status === 403)
  await assert.rejects(joinProject(db, { userId: 2 }, 'ws', 2), error => error.status === 403)
  await assert.rejects(joinProject(db, { userId: 2 }, 'ws', 3), error => error.status === 404)
  assert.equal((await joinProject(db, { userId: 3 }, 'ws', 2)).role, 20)
  assert.equal(
    sqlite.prepare('SELECT count(*) AS n FROM project_members WHERE project_id=1 AND member_id=4').get().n,
    0
  )
  sqlite.close()
})

test('leave preserves the last active admin and allows non-admin departure', async () => {
  const { sqlite, db } = fixture()
  await leaveProject(db, { userId: 3 }, 'ws', 1)
  await assert.rejects(leaveProject(db, { userId: 1 }, 'ws', 1), error => error.status === 409)
  await joinProject(db, { userId: 2 }, 'ws', 1)
  await leaveProject(db, { userId: 2 }, 'ws', 1)
  assert.equal(
    sqlite.prepare('SELECT is_active FROM project_members WHERE project_id=1 AND member_id=2').get().is_active,
    0
  )
  sqlite.close()
})

test('join and leave recheck membership at the write boundary', async () => {
  for (const operation of [
    db => joinProject(db, { userId: 2 }, 'ws', 1),
    db => leaveProject(db, { userId: 3 }, 'ws', 1)
  ]) {
    const { sqlite, db, interleave } = fixture()
    interleave(db => db.exec('UPDATE workspace_members SET is_active=0 WHERE member_id IN (2,3)'))
    await assert.rejects(operation(db))
    assert.equal(
      sqlite.prepare('SELECT count(*) AS n FROM project_members WHERE project_id=1 AND member_id=2').get().n,
      0
    )
    assert.equal(
      sqlite.prepare('SELECT is_active FROM project_members WHERE project_id=1 AND member_id=3').get().is_active,
      1
    )
    sqlite.close()
  }
})

test('a failed preference insert rolls back the join', async () => {
  const { sqlite, db } = fixture()
  sqlite.exec(`CREATE TRIGGER reject_project_preferences BEFORE INSERT ON project_user_properties
    BEGIN SELECT RAISE(ABORT, 'forced failure'); END`)
  await assert.rejects(joinProject(db, { userId: 2 }, 'ws', 1))
  assert.equal(
    sqlite.prepare('SELECT count(*) AS n FROM project_members WHERE project_id=1 AND member_id=2').get().n,
    0
  )
  sqlite.close()
})

test('two administrators cannot concurrently leave a project without an administrator', async () => {
  const { sqlite, db } = fixture()
  const results = await Promise.allSettled([
    leaveProject(db, { userId: 1 }, 'ws', 1),
    leaveProject(db, { userId: 3 }, 'ws', 1)
  ])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter(result => result.status === 'rejected').length, 1)
  assert.equal(
    sqlite.prepare('SELECT count(*) AS n FROM project_members WHERE project_id=1 AND is_active=1 AND role=20').get().n,
    1
  )
  sqlite.close()
})
