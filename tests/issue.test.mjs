import assert from 'node:assert/strict'
import { test } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'
import { openTargetDatabase } from '../scripts/plane-import/target-schema.ts'
import * as schema from '../src/db/schema.ts'
import {
  createIssue,
  listIssues,
  getIssue,
  createState,
  createLabel,
  createComment,
  updateComment,
  deleteComment,
  changeIssueRelation,
  listComments,
  updateIssue,
  deleteIssue,
  listIssueActivities,
  listIssueVersions
} from '../src/server/issue/service.ts'

// A local SQLite-backed D1 adapter exercises the actual Drizzle queries and atomic batches.
function createDatabase() {
  const sqlite = openTargetDatabase('drizzle')
  sqlite.exec(`PRAGMA foreign_keys = ON;
    INSERT INTO user(id,name,email,created_at,updated_at) VALUES(1,'Owner','owner@example.com',1,1),(2,'Guest','guest@example.com',1,1);
    INSERT INTO workspaces(id,name,slug,owner_id) VALUES(1,'Workspace','ws',1),(2,'Other','other',1);
    INSERT INTO workspace_members(workspace_id,member_id,role) VALUES(1,1,20),(1,2,5),(2,1,20);
    INSERT INTO projects(id,name,identifier,workspace_id) VALUES(1,'Project','PRJ',1),(2,'Other','OTHER',2);
    INSERT INTO project_members(project_id,workspace_id,member_id,role) VALUES(1,1,1,20),(1,1,2,5),(2,2,1,20);`)
  function prepare(sql) {
    return {
      bind(...params) {
        return {
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
        }
      }
    }
  }
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
  return { sqlite, d1, db: drizzle(d1, { schema }) }
}

test('issue sequences include historical reservations and concurrent creations are unique', async () => {
  const { sqlite, db } = createDatabase()
  sqlite.exec(`INSERT INTO issues(name,sequence_id,project_id,workspace_id) VALUES('Imported',42,1,1);
    INSERT INTO issue_sequences(sequence,deleted,project_id,workspace_id) VALUES(50,1,1,1);
    INSERT INTO project_issue_counters(project_id,last_sequence) VALUES(1,2);`)
  const created = await Promise.all(
    Array.from({ length: 12 }, (_, i) => createIssue(db, { userId: 1 }, 'ws', 1, { name: `Issue ${i}` }))
  )
  assert.deepEqual(
    created.map(issue => issue.sequenceId).sort((a, b) => a - b),
    Array.from({ length: 12 }, (_, i) => i + 51)
  )
  assert.equal(
    sqlite.prepare('select count(*) as count from issue_sequences where issue_id is not null').get().count,
    12
  )
  assert.equal(
    sqlite.prepare('select last_sequence from project_issue_counters where project_id=1').get().last_sequence,
    62
  )
})

test('failed writes roll back counter and enforce project isolation', async () => {
  const { sqlite, db } = createDatabase()
  sqlite.exec(
    `CREATE TRIGGER reject_issue_sequence BEFORE INSERT ON issue_sequences BEGIN SELECT RAISE(ABORT, 'test failure'); END;`
  )
  await assert.rejects(createIssue(db, { userId: 1 }, 'ws', 1, { name: 'Will roll back' }))
  assert.equal(sqlite.prepare('select count(*) as count from issues').get().count, 0)
  assert.equal(sqlite.prepare('select count(*) as count from project_issue_counters').get().count, 0)
  sqlite.exec('DROP TRIGGER reject_issue_sequence')
  const issue = await createIssue(db, { userId: 1 }, 'ws', 1, { name: 'Allowed' })
  await assert.rejects(getIssue(db, { userId: 1 }, 'other', 2, issue.id), e => e.status === 404)
  await assert.rejects(createIssue(db, { userId: 2 }, 'ws', 1, { name: 'Guest' }), e => e.status === 403)
  await assert.rejects(createIssue(db, { userId: 1 }, 'other', 1, { name: 'Wrong workspace' }), e => e.status === 404)
})

test('state, label and comment operations enforce roles and escape comment HTML', async () => {
  const { db } = createDatabase()
  const state = await createState(db, { userId: 1 }, 'ws', 1, { name: 'Todo', color: '#fff', slug: 'todo' })
  const label = await createLabel(db, { userId: 1 }, 'ws', 1, { name: 'Bug' })
  assert.equal(state.projectId, 1)
  assert.equal(label.projectId, 1)
  await assert.rejects(createLabel(db, { userId: 2 }, 'ws', 1, { name: 'No' }), e => e.status === 403)
  const issue = await createIssue(db, { userId: 1 }, 'ws', 1, { name: 'Test', stateId: state.id })
  const comment = await createComment(db, { userId: 1 }, 'ws', 1, issue.id, { text: '<script>x</script>' })
  assert.equal(comment.commentHtml, '<p>&lt;script&gt;x&lt;/script&gt;</p>')
  assert.equal((await listComments(db, { userId: 1 }, 'ws', 1, issue.id)).length, 1)
  await assert.rejects(createComment(db, { userId: 1 }, 'other', 2, issue.id, { text: 'No' }), e => e.status === 404)
})

test('default state, date validation, guest issue visibility and overflow', async () => {
  const { sqlite, db } = createDatabase()
  sqlite.exec(`INSERT INTO states(id,name,color,slug,project_id,workspace_id,"default") VALUES(1,'Default','#fff','default',1,1,1);
    INSERT INTO issues(name,sequence_id,project_id,workspace_id,created_by_id) VALUES('Guest issue', 1, 1, 1, 2);`)
  const own = await getIssue(db, { userId: 2 }, 'ws', 1, 1)
  assert.equal(own.name, 'Guest issue')
  const issue = await createIssue(db, { userId: 1 }, 'ws', 1, { name: 'Default', stateId: null })
  assert.equal(issue.stateId, 1)
  await assert.rejects(getIssue(db, { userId: 2 }, 'ws', 1, issue.id), e => e.status === 404)
  sqlite.exec('UPDATE projects SET guest_view_all_features=1 WHERE id=1')
  assert.equal((await getIssue(db, { userId: 2 }, 'ws', 1, issue.id)).id, issue.id)
  await assert.rejects(
    createIssue(db, { userId: 1 }, 'ws', 1, { name: 'Bad', startDate: '2026-02-02', targetDate: '2026-02-01' }),
    e => e.status === 400
  )
  sqlite.exec('UPDATE project_issue_counters SET last_sequence=9007199254740991 WHERE project_id=1')
  await assert.rejects(createIssue(db, { userId: 1 }, 'ws', 1, { name: 'Overflow' }))
  assert.equal(sqlite.prepare('select count(*) as count from issues').get().count, 2)
})

test('rejects cross-project and triage state and parent references', async () => {
  const { sqlite, db } = createDatabase()
  sqlite.exec(`INSERT INTO states(id,name,color,slug,project_id,workspace_id,is_triage) VALUES(1,'Other','#fff','other',2,2,0),(2,'Triage','#fff','triage',1,1,1);
    INSERT INTO issues(id,name,sequence_id,project_id,workspace_id) VALUES(1,'Other',1,2,2);`)
  for (const input of [
    { name: 'Bad', stateId: 1 },
    { name: 'Bad', stateId: 2 },
    { name: 'Bad', parentId: 1 }
  ]) {
    await assert.rejects(createIssue(db, { userId: 1 }, 'ws', 1, input), e => e.status === 400)
  }
  assert.equal(sqlite.prepare('select count(*) as count from project_issue_counters').get().count, 0)
})

test('issue creation and changes record atomic activities and snapshots', async () => {
  const { sqlite, db } = createDatabase()
  const actor = { userId: 1 }
  const issue = await createIssue(db, actor, 'ws', 1, { name: 'Initial' })
  let history = await listIssueActivities(db, actor, 'ws', 1, issue.id)
  let versions = await listIssueVersions(db, actor, 'ws', 1, issue.id)
  assert.equal(history.length, 1)
  assert.equal(history[0].verb, 'created')
  assert.equal(versions.length, 1)
  assert.equal(versions[0].name, 'Initial')
  assert.equal(versions[0].activityId, history[0].id)
  await updateIssue(db, actor, 'ws', 1, issue.id, { name: 'Changed', priority: 'high' })
  history = await listIssueActivities(db, actor, 'ws', 1, issue.id)
  versions = await listIssueVersions(db, actor, 'ws', 1, issue.id)
  assert.equal(history.length, 3)
  assert.deepEqual(
    history
      .slice(0, 2)
      .map(x => x.field)
      .sort(),
    ['name', 'priority']
  )
  assert.equal(versions[0].name, 'Changed')
  assert.equal(versions[0].priority, 'high')
  await updateIssue(db, actor, 'ws', 1, issue.id, { name: 'Changed' })
  assert.equal((await listIssueVersions(db, actor, 'ws', 1, issue.id)).length, 2)
  sqlite.exec(
    `CREATE TRIGGER reject_version BEFORE INSERT ON issue_versions BEGIN SELECT RAISE(ABORT, 'version failure'); END;`
  )
  await assert.rejects(updateIssue(db, actor, 'ws', 1, issue.id, { name: 'Rollback' }))
  assert.equal((await getIssue(db, actor, 'ws', 1, issue.id)).name, 'Changed')
  assert.equal((await listIssueActivities(db, actor, 'ws', 1, issue.id)).length, 3)
  await assert.rejects(createIssue(db, actor, 'ws', 1, { name: 'Rollback create' }))
  assert.equal(sqlite.prepare('select count(*) as count from issues').get().count, 1)
})

test('competing updates retain one snapshot and return a conflict', async () => {
  const { db } = createDatabase()
  const actor = { userId: 1 }
  const issue = await createIssue(db, actor, 'ws', 1, { name: 'Initial' })
  const results = await Promise.allSettled([
    updateIssue(db, actor, 'ws', 1, issue.id, { name: 'First' }),
    updateIssue(db, actor, 'ws', 1, issue.id, { name: 'Second' })
  ])
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1)
  assert.equal(results.find(x => x.status === 'rejected').reason.status, 409)
  assert.equal((await listIssueActivities(db, actor, 'ws', 1, issue.id)).length, 2)
  assert.equal((await listIssueVersions(db, actor, 'ws', 1, issue.id)).length, 2)
})

test('ordinary issue reads exclude imported drafts and archived records', async () => {
  const { sqlite, db } = createDatabase()
  sqlite.exec(`INSERT INTO issues(id,name,sequence_id,project_id,workspace_id,is_draft,archived_at,created_by_id) VALUES
    (1,'Visible',1,1,1,0,null,1),(2,'Draft',2,1,1,1,null,1),(3,'Archived',3,1,1,0,'2026-01-01',1);`)
  const actor = { userId: 1 }
  assert.deepEqual(
    (await listIssues(db, actor, 'ws', 1)).map(x => x.name),
    ['Visible']
  )
  for (const id of [2, 3]) await assert.rejects(getIssue(db, actor, 'ws', 1, id), e => e.status === 404)
})

test('creation rechecks revoked membership and deleted state atomically', async () => {
  for (const mutation of [
    'UPDATE project_members SET is_active=0 WHERE project_id=1 AND member_id=1',
    'UPDATE workspace_members SET is_active=0 WHERE workspace_id=1 AND member_id=1',
    'UPDATE states SET deleted_at=1 WHERE id=1'
  ]) {
    const { sqlite, db, d1 } = createDatabase()
    sqlite.exec("INSERT INTO states(id,name,color,slug,project_id,workspace_id) VALUES(1,'Todo','#fff','todo',1,1)")
    const batch = d1.batch
    d1.batch = async statements => {
      sqlite.exec(mutation)
      return batch(statements)
    }
    await assert.rejects(createIssue(db, { userId: 1 }, 'ws', 1, { name: 'Denied', stateId: 1 }), e =>
      [400, 404].includes(e.status)
    )
    assert.equal(sqlite.prepare('select count(*) as n from issues').get().n, 0)
    assert.equal(sqlite.prepare('select count(*) as n from project_issue_counters').get().n, 0)
    assert.equal(sqlite.prepare('select count(*) as n from issue_activities').get().n, 0)
  }
})

test('updates recheck revoked membership and deleted state atomically', async () => {
  for (const mutation of [
    'UPDATE project_members SET is_active=0 WHERE project_id=1 AND member_id=1',
    'UPDATE states SET deleted_at=1 WHERE id=1'
  ]) {
    const { sqlite, db, d1 } = createDatabase()
    sqlite.exec("INSERT INTO states(id,name,color,slug,project_id,workspace_id) VALUES(1,'Todo','#fff','todo',1,1)")
    const issue = await createIssue(db, { userId: 1 }, 'ws', 1, { name: 'Before' })
    const batch = d1.batch
    d1.batch = async statements => {
      sqlite.exec(mutation)
      return batch(statements)
    }
    await assert.rejects(updateIssue(db, { userId: 1 }, 'ws', 1, issue.id, { name: 'After', stateId: 1 }), e =>
      [400, 404, 409].includes(e.status)
    )
    assert.equal(sqlite.prepare('select name from issues where id=?').get(issue.id).name, 'Before')
    assert.equal(sqlite.prepare('select count(*) as n from issue_activities').get().n, 1)
    assert.equal(sqlite.prepare('select count(*) as n from issue_versions').get().n, 1)
  }
})

test('issue deletion reserves sequence and records audit, including imported rows', async () => {
  const { sqlite, db } = createDatabase()
  sqlite.exec("INSERT INTO issues(id,name,sequence_id,project_id,workspace_id) VALUES(1,'Imported',10,1,1)")
  await deleteIssue(db, { userId: 1 }, 'ws', 1, 1)
  assert.equal(sqlite.prepare('select deleted from issue_sequences where issue_id=1').get().deleted, 1)
  assert.equal(
    sqlite.prepare("select count(*) as n from issue_activities where issue_id=1 and verb='deleted'").get().n,
    1
  )
  assert.equal((await createIssue(db, { userId: 1 }, 'ws', 1, { name: 'Next' })).sequenceId, 11)
  await assert.rejects(getIssue(db, { userId: 1 }, 'ws', 1, 1), e => e.status === 404)
})

test('deletion rolls back its issue and audit when sequence reservation fails', async () => {
  const { sqlite, db } = createDatabase()
  const issue = await createIssue(db, { userId: 1 }, 'ws', 1, { name: 'Keep' })
  sqlite.exec(
    "CREATE TRIGGER reject_delete_reservation BEFORE INSERT ON issue_sequences BEGIN SELECT RAISE(ABORT,'blocked'); END"
  )
  await assert.rejects(deleteIssue(db, { userId: 1 }, 'ws', 1, issue.id))
  assert.equal((await getIssue(db, { userId: 1 }, 'ws', 1, issue.id)).name, 'Keep')
  assert.equal(sqlite.prepare("select count(*) as n from issue_activities where verb='deleted'").get().n, 0)
  assert.equal(sqlite.prepare('select deleted from issue_sequences where issue_id=?').get(issue.id).deleted, 0)
})

test('comment edits enforce author or admin and record atomic activity', async () => {
  const { sqlite, db } = createDatabase()
  sqlite.exec(
    "INSERT INTO user(id,name,email,created_at,updated_at) VALUES(3,'Member','member@example.com',1,1); INSERT INTO workspace_members(workspace_id,member_id,role) VALUES(1,3,15); INSERT INTO project_members(project_id,workspace_id,member_id,role) VALUES(1,1,3,15)"
  )
  const issue = await createIssue(db, { userId: 1 }, 'ws', 1, { name: 'Issue' })
  const comment = await createComment(db, { userId: 3 }, 'ws', 1, issue.id, { text: 'Original' })
  await assert.rejects(updateComment(db, { userId: 2 }, 'ws', 1, issue.id, comment.id, { text: 'Bad' }), e =>
    [403, 404].includes(e.status)
  )
  const edited = await updateComment(db, { userId: 3 }, 'ws', 1, issue.id, comment.id, { text: '<edited>' })
  assert.equal(edited.commentHtml, '<p>&lt;edited&gt;</p>')
  assert.ok(edited.editedAt)
  assert.equal(
    sqlite.prepare("select count(*) as n from issue_activities where field='comment' and verb='updated'").get().n,
    1
  )
  sqlite.exec(
    "CREATE TRIGGER reject_comment_activity BEFORE INSERT ON issue_activities WHEN new.field='comment' BEGIN SELECT RAISE(ABORT,'blocked'); END"
  )
  await assert.rejects(deleteComment(db, { userId: 1 }, 'ws', 1, issue.id, comment.id))
  assert.equal((await listComments(db, { userId: 1 }, 'ws', 1, issue.id)).length, 1)
  sqlite.exec('DROP TRIGGER reject_comment_activity')
  await deleteComment(db, { userId: 1 }, 'ws', 1, issue.id, comment.id)
  assert.equal((await listComments(db, { userId: 1 }, 'ws', 1, issue.id)).length, 0)
  assert.equal(
    sqlite.prepare("select count(*) as n from issue_activities where field='comment' and verb='deleted'").get().n,
    1
  )
})

test('comment writes recheck membership when access changes before commit', async () => {
  const { sqlite, db, d1 } = createDatabase()
  const issue = await createIssue(db, { userId: 1 }, 'ws', 1, { name: 'Issue' })
  const comment = await createComment(db, { userId: 1 }, 'ws', 1, issue.id, { text: 'Original' })
  const batch = d1.batch
  d1.batch = async statements => {
    sqlite.exec('UPDATE project_members SET is_active=0 WHERE project_id=1 AND member_id=1')
    return batch(statements)
  }
  await assert.rejects(
    updateComment(db, { userId: 1 }, 'ws', 1, issue.id, comment.id, { text: 'Denied' }),
    e => e.status === 409
  )
  assert.equal(
    sqlite.prepare('select comment_stripped from issue_comments where id=?').get(comment.id).comment_stripped,
    'Original'
  )
})

test('label and assignee changes are project scoped, audited, versioned and atomic', async () => {
  const { sqlite, db } = createDatabase()
  sqlite.exec(
    "INSERT INTO user(id,name,email,created_at,updated_at) VALUES(3,'Member','member@example.com',1,1); INSERT INTO workspace_members(workspace_id,member_id,role) VALUES(1,3,15); INSERT INTO project_members(project_id,workspace_id,member_id,role) VALUES(1,1,3,15); INSERT INTO labels(id,name,project_id,workspace_id) VALUES(1,'Bug',1,1),(2,'Other',2,2)"
  )
  const actor = { userId: 1 }
  const issue = await createIssue(db, actor, 'ws', 1, { name: 'Issue' })
  await assert.rejects(changeIssueRelation(db, actor, 'ws', 1, issue.id, 'labels', 2, true), e => e.status === 400)
  await assert.rejects(changeIssueRelation(db, actor, 'ws', 1, issue.id, 'assignees', 2, true), e => e.status === 400)
  await changeIssueRelation(db, actor, 'ws', 1, issue.id, 'labels', 1, true)
  await assert.rejects(changeIssueRelation(db, actor, 'ws', 1, issue.id, 'labels', 1, true), e => e.status === 409)
  await changeIssueRelation(db, actor, 'ws', 1, issue.id, 'assignees', 3, true)
  assert.equal(
    sqlite
      .prepare(
        'select count(*) as n from issue_subscribers where issue_id=? and subscriber_id=3 and deleted_at is null'
      )
      .get(issue.id).n,
    1
  )
  const version = (await listIssueVersions(db, actor, 'ws', 1, issue.id))[0]
  assert.deepEqual(version.labels, [1])
  assert.deepEqual(version.assignees, [3])
  await changeIssueRelation(db, actor, 'ws', 1, issue.id, 'labels', 1, false)
  assert.equal(
    sqlite.prepare('select count(*) as n from issue_labels where issue_id=? and deleted_at is null').get(issue.id).n,
    0
  )
  sqlite.exec(
    "CREATE TRIGGER reject_relation_history BEFORE INSERT ON issue_activities WHEN new.field='assignees' BEGIN SELECT RAISE(ABORT,'blocked'); END"
  )
  await assert.rejects(changeIssueRelation(db, actor, 'ws', 1, issue.id, 'assignees', 3, false))
  assert.equal(
    sqlite.prepare('select count(*) as n from issue_assignees where issue_id=? and deleted_at is null').get(issue.id).n,
    1
  )
})

test('concurrent relation additions cannot duplicate labels and revoked members cannot write', async () => {
  const { sqlite, db, d1 } = createDatabase()
  sqlite.exec("INSERT INTO labels(id,name,project_id,workspace_id) VALUES(1,'Bug',1,1),(2,'Other',1,1)")
  const actor = { userId: 1 }
  const issue = await createIssue(db, actor, 'ws', 1, { name: 'Issue' })
  const results = await Promise.allSettled([
    changeIssueRelation(db, actor, 'ws', 1, issue.id, 'labels', 1, true),
    changeIssueRelation(db, actor, 'ws', 1, issue.id, 'labels', 1, true)
  ])
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1)
  assert.equal(
    sqlite.prepare('select count(*) as n from issue_labels where issue_id=? and deleted_at is null').get(issue.id).n,
    1
  )
  const batch = d1.batch
  d1.batch = async statements => {
    sqlite.exec('UPDATE project_members SET is_active=0 WHERE project_id=1 and member_id=1')
    return batch(statements)
  }
  await assert.rejects(changeIssueRelation(db, actor, 'ws', 1, issue.id, 'labels', 2, true), e => e.status === 409)
  assert.equal(
    sqlite.prepare('select count(*) as n from issue_labels where issue_id=? and deleted_at is null').get(issue.id).n,
    1
  )
})

test('comment creation audits and rolls back on activity failure or access revocation', async () => {
  const { sqlite, db, d1 } = createDatabase()
  const actor = { userId: 1 }
  const issue = await createIssue(db, actor, 'ws', 1, { name: 'Issue' })
  const comment = await createComment(db, actor, 'ws', 1, issue.id, { text: 'Hello' })
  const activity = sqlite
    .prepare(
      "select issue_comment_id, new_identifier, new_value from issue_activities where field='comment' and verb='created'"
    )
    .get()
  assert.equal(activity.issue_comment_id, comment.id)
  assert.equal(activity.new_identifier, comment.id)
  assert.equal(activity.new_value, '<p>Hello</p>')
  sqlite.exec(
    "CREATE TRIGGER reject_comment_creation BEFORE INSERT ON issue_activities WHEN new.field='comment' BEGIN SELECT RAISE(ABORT,'blocked'); END"
  )
  await assert.rejects(createComment(db, actor, 'ws', 1, issue.id, { text: 'Fail' }))
  assert.equal(sqlite.prepare('select count(*) as n from issue_comments').get().n, 1)
  sqlite.exec('DROP TRIGGER reject_comment_creation')
  const batch = d1.batch
  d1.batch = async statements => {
    sqlite.exec('UPDATE project_members SET is_active=0 WHERE project_id=1 and member_id=1')
    return batch(statements)
  }
  await assert.rejects(createComment(db, actor, 'ws', 1, issue.id, { text: 'Denied' }), e => e.status === 404)
  assert.equal(sqlite.prepare('select count(*) as n from issue_comments').get().n, 1)
})

test('an assignee removed from a project can still be unassigned', async () => {
  const { sqlite, db } = createDatabase()
  sqlite.exec(
    "INSERT INTO user(id,name,email,created_at,updated_at) VALUES(3,'Member','member@example.com',1,1); INSERT INTO workspace_members(workspace_id,member_id,role) VALUES(1,3,15); INSERT INTO project_members(project_id,workspace_id,member_id,role) VALUES(1,1,3,15)"
  )
  const actor = { userId: 1 }
  const issue = await createIssue(db, actor, 'ws', 1, { name: 'Issue' })
  await changeIssueRelation(db, actor, 'ws', 1, issue.id, 'assignees', 3, true)
  sqlite.exec('UPDATE project_members SET deleted_at=1 WHERE project_id=1 AND member_id=3')
  await changeIssueRelation(db, actor, 'ws', 1, issue.id, 'assignees', 3, false)
  assert.equal(
    sqlite.prepare('select count(*) as n from issue_assignees where issue_id=? and deleted_at is null').get(issue.id).n,
    0
  )
})

test('links validate, scope, audit and reject duplicate URLs', async () => {
  const { listIssueLinks, createIssueLink, updateIssueLink, deleteIssueLink } =
    await import('../src/server/issue/link.ts')
  const { sqlite, db } = createDatabase()
  const actor = { userId: 1 }
  const issue = await createIssue(db, actor, 'ws', 1, { name: 'Issue' })
  const link = await createIssueLink(db, actor, 'ws', 1, issue.id, { url: 'example.com', title: 'Example' })
  assert.equal(link.url, 'http://example.com')
  assert.equal((await listIssueLinks(db, actor, 'ws', 1, issue.id)).length, 1)
  assert.equal(
    sqlite.prepare("select new_identifier from issue_activities where field='link' and verb='created'").get()
      .new_identifier,
    link.id
  )
  await assert.rejects(createIssueLink(db, actor, 'ws', 1, issue.id, { url: 'example.com' }), e => e.status === 409)
  await assert.rejects(
    createIssueLink(db, actor, 'ws', 1, issue.id, { url: 'http://user:pass@example.com' }),
    e => e.status === 400
  )
  await assert.rejects(
    updateIssueLink(db, actor, 'other', 2, issue.id, link.id, { title: 'Denied' }),
    e => e.status === 404
  )
  const updated = await updateIssueLink(db, actor, 'ws', 1, issue.id, link.id, { url: 'https://example.org' })
  assert.equal(updated.url, 'https://example.org')
  sqlite.exec(
    "CREATE TRIGGER reject_link_activity BEFORE INSERT ON issue_activities WHEN new.field='link' BEGIN SELECT RAISE(ABORT,'blocked'); END"
  )
  await assert.rejects(deleteIssueLink(db, actor, 'ws', 1, issue.id, link.id))
  assert.equal((await listIssueLinks(db, actor, 'ws', 1, issue.id)).length, 1)
  sqlite.exec('DROP TRIGGER reject_link_activity')
  await deleteIssueLink(db, actor, 'ws', 1, issue.id, link.id)
  assert.equal((await listIssueLinks(db, actor, 'ws', 1, issue.id)).length, 0)
})

test('issue relations enforce project isolation and directional mapping', async () => {
  const { listIssueRelations, createIssueRelations, removeIssueRelation } =
    await import('../src/server/issue/relation.ts')
  const { sqlite, db } = createDatabase()
  const actor = { userId: 1 }
  const a = await createIssue(db, actor, 'ws', 1, { name: 'A' })
  const b = await createIssue(db, actor, 'ws', 1, { name: 'B' })
  const foreign = await createIssue(db, actor, 'other', 2, { name: 'Other' })
  await assert.rejects(
    createIssueRelations(db, actor, 'ws', 1, a.id, { relation_type: 'blocking', issues: [foreign.id] }),
    e => e.status === 404
  )
  await createIssueRelations(db, actor, 'ws', 1, a.id, { relation_type: 'blocking', issues: [b.id] })
  assert.equal((await listIssueRelations(db, actor, 'ws', 1, a.id)).blocking[0].id, b.id)
  assert.equal((await listIssueRelations(db, actor, 'ws', 1, b.id)).blocked_by[0].id, a.id)
  await createIssueRelations(db, actor, 'ws', 1, a.id, { relation_type: 'blocking', issues: [b.id] })
  assert.equal(sqlite.prepare('select count(*) as n from issue_relations where deleted_at is null').get().n, 1)
  await removeIssueRelation(db, actor, 'ws', 1, a.id, b.id)
  assert.equal((await listIssueRelations(db, actor, 'ws', 1, a.id)).blocking.length, 0)
})

test('cross-project relations bind both ends to a visible issue in the same workspace', async () => {
  const { listIssueRelations, createIssueRelations, removeIssueRelation } =
    await import('../src/server/issue/relation.ts')
  const { sqlite, db } = createDatabase()
  const actor = { userId: 1 }
  sqlite.exec(`INSERT INTO projects (id, name, identifier, workspace_id) VALUES (3, 'Private', 'PRIV', 1);
    INSERT INTO project_members (project_id, workspace_id, member_id, role) VALUES (3, 1, 1, 20);
    UPDATE workspace_members SET role = 15 WHERE member_id = 2;
    UPDATE project_members SET role = 15 WHERE member_id = 2;`)
  const source = await createIssue(db, actor, 'ws', 1, { name: 'First project' })
  const reference = await createIssue(db, actor, 'ws', 3, { name: 'Private project' })
  const foreign = await createIssue(db, actor, 'other', 2, { name: 'Foreign workspace' })
  await assert.rejects(
    createIssueRelations(db, actor, 'ws', 1, source.id, {
      relation_type: 'blocking',
      issues: [reference.id, foreign.id]
    }),
    e => e.status === 404
  )
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM issue_relations').get().count, 0)
  await createIssueRelations(db, actor, 'ws', 1, source.id, { relation_type: 'blocking', issues: [reference.id] })
  assert.equal((await listIssueRelations(db, actor, 'ws', 1, source.id)).blocking[0].project_id, 3)
  assert.equal((await listIssueRelations(db, actor, 'ws', 3, reference.id)).blocked_by[0].project_id, 1)
  const member = { userId: 2 }
  assert.deepEqual((await listIssueRelations(db, member, 'ws', 1, source.id)).blocking, [])
  await assert.rejects(removeIssueRelation(db, member, 'ws', 1, source.id, reference.id), e => e.status === 404)
  await removeIssueRelation(db, actor, 'ws', 3, reference.id, source.id)
  assert.deepEqual((await listIssueRelations(db, actor, 'ws', 1, source.id)).blocking, [])
})

test('subscriptions are issue scoped and require active project membership', async () => {
  const { addIssueSubscriber, removeIssueSubscriber, issueSubscriptionStatus, listIssueSubscribers } =
    await import('../src/server/issue/subscriber.ts')
  const { sqlite, db } = createDatabase()
  const actor = { userId: 1 }
  const issue = await createIssue(db, actor, 'ws', 1, { name: 'Issue' })
  assert.equal((await issueSubscriptionStatus(db, actor, 'ws', 1, issue.id)).subscribed, false)
  await addIssueSubscriber(db, actor, 'ws', 1, issue.id, actor.userId)
  assert.equal((await issueSubscriptionStatus(db, actor, 'ws', 1, issue.id)).subscribed, true)
  await assert.rejects(addIssueSubscriber(db, actor, 'ws', 1, issue.id, actor.userId), e => e.status === 409)
  assert.equal((await listIssueSubscribers(db, actor, 'ws', 1, issue.id)).length, 2)
  await removeIssueSubscriber(db, actor, 'ws', 1, issue.id, actor.userId)
  assert.equal((await issueSubscriptionStatus(db, actor, 'ws', 1, issue.id)).subscribed, false)
  sqlite.exec('UPDATE project_members SET is_active=0 WHERE project_id=1 AND member_id=2')
  await assert.rejects(addIssueSubscriber(db, actor, 'ws', 1, issue.id, 2), e => e.status === 409)
  await assert.rejects(addIssueSubscriber(db, actor, 'other', 2, issue.id, actor.userId), e => e.status === 404)
})

test('restricted guests cannot access other users’ issue links or subscriptions', async () => {
  const { createIssueLink, listIssueLinks } = await import('../src/server/issue/link.ts')
  const { addIssueSubscriber, issueSubscriptionStatus } = await import('../src/server/issue/subscriber.ts')
  const { sqlite, db } = createDatabase()
  const issue = await createIssue(db, { userId: 1 }, 'ws', 1, { name: 'Private to guest' })
  await createIssueLink(db, { userId: 1 }, 'ws', 1, issue.id, { url: 'example.com' })
  await assert.rejects(listIssueLinks(db, { userId: 2 }, 'ws', 1, issue.id), e => e.status === 404)
  await assert.rejects(addIssueSubscriber(db, { userId: 2 }, 'ws', 1, issue.id, 2), e => e.status === 404)
  sqlite.exec('UPDATE projects SET guest_view_all_features=1 WHERE id=1')
  await addIssueSubscriber(db, { userId: 2 }, 'ws', 1, issue.id, 2)
  assert.equal((await issueSubscriptionStatus(db, { userId: 2 }, 'ws', 1, issue.id)).subscribed, true)
  await assert.rejects(
    createIssueLink(db, { userId: 2 }, 'ws', 1, issue.id, { url: 'example.org' }),
    e => e.status === 403
  )
})
