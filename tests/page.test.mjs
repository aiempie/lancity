import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../src/db/schema.ts'
import { createPage, deletePage, setPageArchived, setPageLocked, updatePage } from '../src/server/page/service.ts'

function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  for (const migration of ['drizzle/0000_auth.sql', 'drizzle/0001_plane_domain.sql'])
    sqlite.exec(readFileSync(migration, 'utf8'))
  sqlite.exec(`PRAGMA foreign_keys = ON;
    INSERT INTO user(id,name,email,created_at,updated_at) VALUES(1,'Owner','owner@example.com',1,1),(2,'Member','member@example.com',1,1),(3,'Admin','admin@example.com',1,1);
    INSERT INTO workspaces(id,name,slug,owner_id) VALUES(1,'Workspace','ws',1);
    INSERT INTO workspace_members(workspace_id,member_id,role) VALUES(1,1,20),(1,2,15),(1,3,20);
    INSERT INTO projects(id,name,identifier,workspace_id) VALUES(1,'Project','P',1);
    INSERT INTO project_members(project_id,workspace_id,member_id,role) VALUES(1,1,1,20),(1,1,2,15),(1,1,3,20);
    INSERT INTO pages(id,name,workspace_id,owned_by_id,access,description_stripped) VALUES(1,'Page',1,1,0,'old');
    INSERT INTO project_pages(project_id,workspace_id,page_id) VALUES(1,1,1);`)
  let beforeMutation
  function prepare(query) {
    return {
      bind(...params) {
        function runInterleave() {
          if ((/^update "pages"/i.test(query) || /^insert into pages/i.test(query)) && beforeMutation) {
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

test('page updates recheck visibility and active membership at mutation', async () => {
  const { sqlite, db, interleave } = fixture()
  interleave(db => db.exec('UPDATE pages SET access = 1 WHERE id = 1'))
  await assert.rejects(
    updatePage(db, { userId: 2 }, 'ws', 1, 1, { descriptionText: 'changed' }),
    error => error.status === 409
  )
  assert.equal(sqlite.prepare('SELECT description_stripped FROM pages WHERE id = 1').get().description_stripped, 'old')
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM page_versions').get().count, 0)
  sqlite.exec('UPDATE pages SET access = 0 WHERE id = 1')
  interleave(db => db.exec('UPDATE project_members SET is_active = 0 WHERE member_id = 2'))
  await assert.rejects(updatePage(db, { userId: 2 }, 'ws', 1, 1, { name: 'changed' }), error => error.status === 409)
  assert.equal(sqlite.prepare('SELECT name FROM pages WHERE id = 1').get().name, 'Page')
  sqlite.close()
})

test('page deletion rechecks membership, project link and visibility at mutation', async () => {
  for (const change of [
    'UPDATE workspace_members SET is_active = 0 WHERE member_id = 3',
    'UPDATE project_pages SET deleted_at = 1 WHERE page_id = 1',
    'UPDATE pages SET access = 1 WHERE id = 1'
  ]) {
    const { sqlite, db, interleave } = fixture()
    interleave(db => db.exec(change))
    await assert.rejects(deletePage(db, { userId: 3 }, 'ws', 1, 1), error => error.status === 409)
    assert.equal(sqlite.prepare('SELECT deleted_at FROM pages WHERE id = 1').get().deleted_at, null)
    sqlite.close()
  }
})

test('authorized owner changes still succeed; versions are written by the page.version job', async () => {
  const { sqlite, db } = fixture()
  await updatePage(db, { userId: 1 }, 'ws', 1, 1, { descriptionText: '<script>' })
  assert.equal(
    sqlite.prepare('SELECT description_html FROM pages WHERE id = 1').get().description_html,
    '<p>&lt;script&gt;</p>'
  )
  // Versions go through the page.version job (10-minute merge window, 20-version cap), not inline.
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM page_versions').get().count, 0)
  await deletePage(db, { userId: 1 }, 'ws', 1, 1)
  assert.notEqual(sqlite.prepare('SELECT deleted_at FROM pages WHERE id = 1').get().deleted_at, null)
  sqlite.close()
})

test('page creation rechecks membership in the insertion transaction', async () => {
  const { sqlite, db, interleave } = fixture()
  interleave(db => db.exec('UPDATE project_members SET is_active = 0 WHERE member_id = 2'))
  await assert.rejects(
    createPage(db, { userId: 2 }, 'ws', 1, { name: 'Denied', access: 0, descriptionText: '' }),
    error => error.status === 409
  )
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM pages').get().count, 1)
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM project_pages').get().count, 1)
  sqlite.close()
})

test('lock and archive obey roles, scope, descendant updates and favorites', async () => {
  const { sqlite, db } = fixture()
  sqlite.exec(`INSERT INTO pages(id,name,workspace_id,owned_by_id,parent_id) VALUES(2,'Child',1,1,1);
    INSERT INTO project_pages(project_id,workspace_id,page_id) VALUES(1,1,2);
    INSERT INTO user_favorites(entity_type,entity_identifier,project_id,user_id,workspace_id) VALUES('page',1,1,2,1);`)
  await setPageLocked(db, { userId: 2 }, 'ws', 1, 1, true)
  assert.equal(sqlite.prepare('SELECT is_locked FROM pages WHERE id=1').get().is_locked, 1)
  await assert.rejects(setPageLocked(db, { userId: 2 }, 'ws', 1, 1, false), error => error.status === 403)
  await setPageLocked(db, { userId: 1 }, 'ws', 1, 1, false)
  await assert.rejects(setPageArchived(db, { userId: 2 }, 'ws', 1, 1, true), error => error.status === 403)
  const archived = await setPageArchived(db, { userId: 3 }, 'ws', 1, 1, true)
  assert.match(archived.archivedAt, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM pages WHERE archived_at IS NOT NULL').get().count, 2)
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM user_favorites').get().count, 0)
  await setPageArchived(db, { userId: 1 }, 'ws', 1, 2, false)
  const child = sqlite.prepare('SELECT archived_at, parent_id FROM pages WHERE id=2').get()
  assert.equal(child.archived_at, null)
  assert.equal(child.parent_id, null)
  sqlite.close()
})

test('archive and lock reject authorization revoked after read', async () => {
  for (const operation of [
    db => setPageLocked(db, { userId: 3 }, 'ws', 1, 1, true),
    db => setPageArchived(db, { userId: 3 }, 'ws', 1, 1, true)
  ]) {
    const { sqlite, db, interleave } = fixture()
    interleave(db => db.exec('UPDATE project_members SET is_active = 0 WHERE member_id = 3'))
    await assert.rejects(operation(db), error => error.status === 409)
    assert.equal(sqlite.prepare('SELECT is_locked, archived_at FROM pages WHERE id=1').get().is_locked, 0)
    assert.equal(sqlite.prepare('SELECT archived_at FROM pages WHERE id=1').get().archived_at, null)
    sqlite.close()
  }
})
