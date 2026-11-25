import assert from 'node:assert/strict'
import test from 'node:test'
import { drizzle } from 'drizzle-orm/d1'
import { openTargetDatabase } from '../scripts/plane-import/target-schema.ts'
import * as schema from '../src/db/schema.ts'
import { listArchivedCycles, setCycleArchived } from '../src/server/cycle/archive.ts'
import { listArchivedModules, setModuleArchived } from '../src/server/module/archive.ts'
import { transferCycleIssues } from '../src/server/cycle/cycle-transfer-issues.ts'

function fixture() {
  const sqlite = openTargetDatabase('drizzle')
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
            (/^update "cycles"/i.test(query) || /^update "modules"/i.test(query) || /^update cycles/i.test(query)) &&
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

test('archive enforces status, scopes records and removes favorites', async () => {
  const { sqlite, db } = fixture()
  sqlite.exec(`INSERT INTO cycles(id,name,owned_by_id,project_id,workspace_id,end_date) VALUES(1,'Old',1,1,1,1),(2,'Future',1,1,1,4102444800000),(3,'Other',1,3,2,1);
    INSERT INTO modules(id,name,status,project_id,workspace_id) VALUES(1,'Done','completed',1,1),(2,'Planned','planned',1,1);
    INSERT INTO user_favorites(entity_type,entity_identifier,project_id,user_id,workspace_id) VALUES('cycle',1,1,1,1),('module',1,1,1,1);`)
  await assert.rejects(setCycleArchived(db, { userId: 1 }, 'ws', 1, 2, true), error => error.status === 400)
  await assert.rejects(setCycleArchived(db, { userId: 1 }, 'ws', 1, 3, true), error => error.status === 404)
  await assert.rejects(setModuleArchived(db, { userId: 1 }, 'ws', 1, 2, true), error => error.status === 400)
  await setCycleArchived(db, { userId: 1 }, 'ws', 1, 1, true)
  await setModuleArchived(db, { userId: 1 }, 'ws', 1, 1, true)
  assert.equal((await listArchivedCycles(db, { userId: 1 }, 'ws', 1)).length, 1)
  assert.equal((await listArchivedModules(db, { userId: 1 }, 'ws', 1)).length, 1)
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM user_favorites').get().n, 0)
  await setCycleArchived(db, { userId: 1 }, 'ws', 1, 1, false)
  await setModuleArchived(db, { userId: 1 }, 'ws', 1, 1, false)
  assert.equal((await listArchivedCycles(db, { userId: 1 }, 'ws', 1)).length, 0)
  sqlite.close()
})

test('archive rechecks authorization and rolls back if favorite cleanup fails', async () => {
  const { sqlite, db, interleave } = fixture()
  sqlite.exec(`INSERT INTO cycles(id,name,owned_by_id,project_id,workspace_id,end_date) VALUES(1,'Old',1,1,1,1);
    INSERT INTO user_favorites(entity_type,entity_identifier,project_id,user_id,workspace_id) VALUES('cycle',1,1,1,1);`)
  interleave(db => db.exec('UPDATE project_members SET is_active=0 WHERE member_id=3 AND project_id=1'))
  await assert.rejects(setCycleArchived(db, { userId: 3 }, 'ws', 1, 1, true), error => error.status === 409)
  sqlite.exec(
    `CREATE TRIGGER reject_favorite_delete BEFORE DELETE ON user_favorites BEGIN SELECT RAISE(ABORT, 'forced'); END`
  )
  await assert.rejects(setCycleArchived(db, { userId: 1 }, 'ws', 1, 1, true))
  assert.equal(sqlite.prepare('SELECT archived_at FROM cycles WHERE id=1').get().archived_at, null)
  sqlite.close()
})

test('transfer moves only open issues, records activities and snapshot atomically', async () => {
  const { sqlite, db } = fixture()
  sqlite.exec(`INSERT INTO cycles(id,name,owned_by_id,project_id,workspace_id,end_date) VALUES(1,'Old',1,1,1,1),(2,'New',1,1,1,4102444800000);
    INSERT INTO states(id,name,color,slug,project_id,workspace_id,"group") VALUES(1,'Started','#fff','started',1,1,'started'),(2,'Done','#fff','done',1,1,'completed');
    INSERT INTO issues(id,name,sequence_id,state_id,project_id,workspace_id) VALUES(1,'Open',1,1,1,1),(2,'Done',2,2,1,1);
    INSERT INTO cycle_issues(cycle_id,issue_id,project_id,workspace_id) VALUES(1,1,1,1),(1,2,1,1);`)
  await transferCycleIssues(db, { userId: 1 }, 'ws', 1, 1, 2)
  assert.equal(sqlite.prepare('SELECT cycle_id FROM cycle_issues WHERE issue_id=1').get().cycle_id, 2)
  assert.equal(sqlite.prepare('SELECT cycle_id FROM cycle_issues WHERE issue_id=2').get().cycle_id, 1)
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM issue_activities WHERE field = ?').get('cycles').n, 1)
  const snapshot = JSON.parse(sqlite.prepare('SELECT progress_snapshot FROM cycles WHERE id=1').get().progress_snapshot)
  assert.equal(snapshot.total_issues, 2)
  assert.equal(snapshot.started_issues, 1)
  assert.equal(snapshot.completed_issues, 1)
  sqlite.close()
})

test('transfer rolls back snapshot and activity when a move fails', async () => {
  const { sqlite, db } = fixture()
  sqlite.exec(`INSERT INTO cycles(id,name,owned_by_id,project_id,workspace_id) VALUES(1,'Old',1,1,1),(2,'New',1,1,1);
    INSERT INTO states(id,name,color,slug,project_id,workspace_id,"group") VALUES(1,'Started','#fff','started',1,1,'started');
    INSERT INTO issues(id,name,sequence_id,state_id,project_id,workspace_id) VALUES(1,'Open',1,1,1,1);
    INSERT INTO cycle_issues(cycle_id,issue_id,project_id,workspace_id) VALUES(1,1,1,1);
    CREATE TRIGGER fail_move BEFORE UPDATE ON cycle_issues BEGIN SELECT RAISE(ABORT, 'forced'); END;`)
  await assert.rejects(transferCycleIssues(db, { userId: 1 }, 'ws', 1, 1, 2))
  assert.equal(sqlite.prepare('SELECT cycle_id FROM cycle_issues').get().cycle_id, 1)
  assert.equal(sqlite.prepare('SELECT progress_snapshot FROM cycles WHERE id=1').get().progress_snapshot, '{}')
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM issue_activities').get().n, 0)
  sqlite.close()
})

test('transfer rejects future sources, guests, cross-project destinations and revoked permissions', async () => {
  const { sqlite, db, interleave } = fixture()
  sqlite.exec(`INSERT INTO cycles(id,name,owned_by_id,project_id,workspace_id,end_date) VALUES
    (1,'Old',1,1,1,4102444800000),(2,'New',1,1,1,4102444800000),(3,'Other',1,3,2,NULL);
    INSERT INTO project_members(project_id,workspace_id,member_id,role) VALUES(1,1,4,5);`)
  await assert.rejects(transferCycleIssues(db, { userId: 1 }, 'ws', 1, 1, 2), error => error.status === 400)
  await assert.rejects(transferCycleIssues(db, { userId: 4 }, 'ws', 1, 1, 2), error => error.status === 403)
  sqlite.exec('UPDATE cycles SET end_date=1 WHERE id=1')
  await assert.rejects(transferCycleIssues(db, { userId: 1 }, 'ws', 1, 1, 3), error => error.status === 404)
  interleave(db => db.exec('UPDATE project_members SET is_active=0 WHERE member_id=3 AND project_id=1'))
  await assert.rejects(transferCycleIssues(db, { userId: 3 }, 'ws', 1, 1, 2), error => error.status === 409)
  assert.equal(sqlite.prepare('SELECT progress_snapshot FROM cycles WHERE id=1').get().progress_snapshot, '{}')
  sqlite.close()
})
