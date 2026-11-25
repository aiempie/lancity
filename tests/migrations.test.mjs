import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { resetProjectDeployBoardIdentity } from '../scripts/db/import-plane/0125-reset-project-deploy-board-identity.ts'
import { completeLegacyTour } from '../scripts/db/import-plane/complete-legacy-tour.ts'
import { normalizeIssueHistory } from '../scripts/db/import-plane/normalize-history.ts'
import { normalizeLegacyPlanning } from '../scripts/db/import-plane/normalize-planning.ts'
import { backfillPageSortOrder, resetPageSortOrder } from '../scripts/db/import-plane/page-sort-order.ts'
import { createInstanceAdmin } from '../scripts/plane/create-instance-admin.ts'

function openMigratedDatabase() {
  const db = new DatabaseSync(':memory:')
  for (const name of ['0000_auth.sql', '0001_plane_domain.sql']) db.exec(readFileSync(`drizzle/${name}`, 'utf8'))
  db.exec(`PRAGMA foreign_keys = ON;
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
    VALUES (1, 'Admin', 'admin@example.com', 1, 1, 1), (2, 'User', 'user@example.com', 0, 1, 1);
    INSERT INTO workspaces (id, name, slug, owner_id) VALUES (1, 'Workspace', 'ws', 1);
    INSERT INTO projects (id, name, identifier, workspace_id) VALUES (1, 'First', 'FIRST', 1), (2, 'Second', 'SECOND', 1);`)
  return db
}

test('legacy issue history is normalized idempotently in the current schema', () => {
  const db = openMigratedDatabase()
  try {
    db.exec(`INSERT INTO issues (id, name, project_id, workspace_id, sequence_id) VALUES (1, 'Issue', 1, 1, 1);
      INSERT INTO issue_activities (verb, field, old_value, new_value, comment, issue_id, project_id, workspace_id, epoch)
      VALUES ('updated', 'assignee', 'A', 'B', 'assignee changed', 1, 1, 1, 1),
        ('updated', 'name', 'A', 'B', 'updated the start date', 1, 1, 1, 1),
        ('updated', 'priority', NULL, '', 'priority changed', 1, 1, 1, 1),
        ('updated', 'blocks', NULL, NULL, 'dependency changed', 1, 1, 1, 1);`)
    normalizeIssueHistory(db)
    normalizeIssueHistory(db)
    const rows = db.prepare('SELECT field, old_value, new_value, comment FROM issue_activities ORDER BY id').all()
    assert.deepEqual(
      rows.map(row => row.field),
      ['assignees', 'name', 'priority', 'blocked_by']
    )
    assert.equal(rows[1].comment, 'updated the name')
    assert.equal(rows[2].old_value, 'none')
    assert.equal(rows[2].new_value, 'none')
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally {
    db.close()
  }
})

test('project board repair preserves one live anchor and handles soft-deleted boards', () => {
  const db = openMigratedDatabase()
  try {
    db.exec(`INSERT INTO deploy_boards (anchor, entity_name, entity_identifier, project_id, workspace_id, deleted_at, created_at)
      VALUES ('current', 'project', 1, 1, 1, NULL, 1), ('duplicate', 'project', 19, 1, 1, NULL, 2),
        ('repaired', 'project', 23, 2, 1, NULL, 3), ('historical', 'project', 23, 1, 1, 10, 4);`)
    resetProjectDeployBoardIdentity(db, 20)
    const rows = db.prepare('SELECT anchor, entity_identifier, deleted_at FROM deploy_boards ORDER BY id').all()
    assert.deepEqual(
      rows.map(row => [row.anchor, row.entity_identifier, row.deleted_at]),
      [
        ['current', 1, null],
        ['duplicate', null, 20],
        ['repaired', 2, null],
        ['historical', 1, 10]
      ]
    )
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally {
    db.close()
  }
})

test('local admin bootstrap requires verified identity and is safe to retry', () => {
  const db = openMigratedDatabase()
  try {
    assert.throws(() => createInstanceAdmin(db, 'user@example.com', 'Local'), /verified/)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM instances').get().count, 0)
    createInstanceAdmin(db, 'admin@example.com', 'Local')
    createInstanceAdmin(db, 'admin@example.com', 'Local')
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM instances').get().count, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM instance_admins').get().count, 1)
  } finally {
    db.close()
  }
})

test('legacy planning normalization maps triage, assigned estimates, and case-insensitive intake sources', () => {
  const db = openMigratedDatabase()
  try {
    db.exec(`INSERT INTO states (id, name, slug, color, "group", project_id, workspace_id)
      VALUES (1, 'Triage', 'triage', '#888', 'backlog', 1, 1), (2, 'Backlog', 'backlog', '#aaa', 'backlog', 1, 1);
      INSERT INTO estimates (id, name, project_id, workspace_id) VALUES (1, 'Used', 1, 1), (2, 'Unused', 1, 1);
      UPDATE projects SET estimate_id = 1 WHERE id = 1;
      INSERT INTO intakes (id, name, project_id, workspace_id) VALUES (1, 'Inbox', 1, 1);
      INSERT INTO issues (id, name, sequence_id, project_id, workspace_id) VALUES (1, 'Old issue', 1, 1, 1), (2, 'Other', 2, 1, 1);
      INSERT INTO intake_issues (source, issue_id, project_id, workspace_id, intake_id)
        VALUES ('In-App', 1, 1, 1, 1), ('EXTERNAL', 2, 1, 1, 1);
      CREATE TRIGGER reject_source BEFORE UPDATE OF source ON intake_issues BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;`)
    assert.throws(() => normalizeLegacyPlanning(db), /fixture failure/)
    assert.equal(db.prepare('SELECT "group" AS state_group FROM states WHERE id = 1').get().state_group, 'backlog')
    assert.equal(db.prepare('SELECT last_used FROM estimates WHERE id = 1').get().last_used, 0)
    db.exec('DROP TRIGGER reject_source')
    normalizeLegacyPlanning(db)
    normalizeLegacyPlanning(db)
    assert.deepEqual(
      db
        .prepare('SELECT "group" AS state_group, is_triage FROM states ORDER BY id')
        .all()
        .map(row => [row.state_group, row.is_triage]),
      [
        ['triage', 1],
        ['backlog', 0]
      ]
    )
    assert.deepEqual(
      db
        .prepare('SELECT last_used FROM estimates ORDER BY id')
        .all()
        .map(row => row.last_used),
      [1, 0]
    )
    assert.deepEqual(
      db
        .prepare('SELECT source FROM intake_issues ORDER BY issue_id')
        .all()
        .map(row => row.source),
      ['IN_APP', 'EXTERNAL']
    )
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally {
    db.close()
  }
})

test('legacy page sort assigns increments of 100 and reverse resets the default', () => {
  const db = openMigratedDatabase()
  try {
    db.exec(`INSERT INTO pages (id, name, owned_by_id, workspace_id, deleted_at)
      VALUES (1, 'Zebra', 1, 1, NULL), (2, 'Alpha', 1, 1, 1), (3, 'Alpha', 1, 1, NULL);`)
    const orders = () =>
      db
        .prepare('SELECT sort_order FROM pages ORDER BY id')
        .all()
        .map(row => row.sort_order)
    backfillPageSortOrder(db)
    assert.deepEqual(orders(), [300, 100, 200])
    backfillPageSortOrder(db)
    assert.deepEqual(orders(), [300, 100, 200])
    resetPageSortOrder(db)
    assert.deepEqual(orders(), [65535, 65535, 65535])
  } finally {
    db.close()
  }
})

test('legacy tour backfills exact profile and workspace-member values', () => {
  const db = openMigratedDatabase()
  try {
    db.exec(`INSERT INTO profiles (user_id) VALUES (1), (2);
      INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (1, 1, 20), (1, 2, 5);`)
    completeLegacyTour(db)
    completeLegacyTour(db)
    const profiles = db.prepare('SELECT is_navigation_tour_completed, product_tour FROM profiles').all()
    assert.equal(profiles.length, 2)
    for (const profile of profiles) {
      assert.equal(profile.is_navigation_tour_completed, 1)
      assert.deepEqual(JSON.parse(profile.product_tour), {
        work_items: true,
        cycles: true,
        modules: true,
        intake: true,
        pages: true
      })
    }
    const memberships = db
      .prepare('SELECT getting_started_checklist, tips, explored_features, role FROM workspace_members ORDER BY id')
      .all()
    assert.deepEqual(
      memberships.map(row => row.role),
      [20, 5]
    )
    for (const member of memberships) {
      assert.deepEqual(JSON.parse(member.getting_started_checklist), {
        project_created: true,
        project_joined: true,
        work_item_created: true,
        team_members_invited: true,
        page_created: true,
        ai_chat_tried: true,
        integration_linked: true,
        view_created: true,
        sticky_created: true
      })
      assert.deepEqual(JSON.parse(member.tips), { mobile_app_download: true })
      assert.deepEqual(JSON.parse(member.explored_features), {
        github_integrated: true,
        slack_integrated: true,
        ai_chat_tried: true
      })
    }
  } finally {
    db.close()
  }
})

test('issue relation migration preserves old rows and enforces the workspace foreign key', () => {
  const db = openMigratedDatabase()
  try {
    db.exec(`INSERT INTO workspaces (id, name, slug, owner_id) VALUES (2, 'Other', 'other', 1);
      INSERT INTO projects (id, name, identifier, workspace_id) VALUES (3, 'Third', 'THIRD', 2);
      INSERT INTO issues (id, name, project_id, workspace_id, sequence_id) VALUES
        (1, 'First', 1, 1, 1), (2, 'Second', 1, 1, 2), (3, 'Sibling', 2, 1, 1), (4, 'Foreign', 3, 2, 1);
      INSERT INTO issue_relations (id, issue_id, related_issue_id, project_id, workspace_id) VALUES (10, 1, 2, 1, 1);`)
    db.exec(readFileSync('drizzle/0002_issue_relation_workspace_scope.sql', 'utf8'))
    assert.equal(db.prepare('SELECT id FROM issue_relations WHERE issue_id = 1 AND related_issue_id = 2').get().id, 10)
    const insert = db.prepare(
      'INSERT INTO issue_relations (issue_id, related_issue_id, project_id, workspace_id) VALUES (1, ?, 1, 1)'
    )
    assert.ok(insert.run(3).lastInsertRowid > 10)
    assert.throws(() => insert.run(4), /FOREIGN KEY/)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally {
    db.close()
  }
})

test('review migration upgrades a populated 0004 database', () => {
  const db = openMigratedDatabase()
  try {
    for (const migration of ['0002_issue_relation_workspace_scope.sql', '0003_backend_extensions.sql', '0004_job_claims.sql'])
      db.exec(readFileSync(`drizzle/${migration}`, 'utf8'))
    db.exec(`INSERT INTO api_tokens (id, token, label, user_id, workspace_id, is_active) VALUES
        (1, 'old-unscoped', 'Old unscoped key', 1, NULL, 1),
        (2, 'scoped', 'Scoped key', 1, 1, 1),
        (3, 'revoked', 'Already revoked', 1, NULL, 0);
      INSERT INTO job_claims (id, key, owner) VALUES (1, 'old-job', 'old-worker');
      INSERT INTO issues (id, name, project_id, workspace_id, sequence_id)
        VALUES (1, 'ĐĂNG KÝ TIẾNG VIỆT', 1, 1, 1);
      INSERT INTO issue_activities (id, verb, issue_id, project_id, workspace_id)
        VALUES (1, 'created', 1, 1, 1);`)
    const stickyText = 'ĐĂNG KÝ TIẾNG VIỆT '.repeat(8_000)
    db.prepare('INSERT INTO stickies (id, owner_id, workspace_id, description_stripped) VALUES (1, 1, 1, ?)').run(stickyText)

    db.exec(readFileSync('drizzle/0005_review_reliability.sql', 'utf8'))

    assert.deepEqual(
      db.prepare('SELECT id, workspace_id, is_active FROM api_tokens ORDER BY id').all().map(Object.values),
      [[1, null, 0], [2, 1, 1], [3, null, 0]]
    )
    assert.equal(db.prepare('SELECT owner FROM job_claims WHERE key = ?').get('old-job').owner, 'old-worker')
    assert.equal(db.prepare('SELECT mutation_id FROM issue_activities WHERE id = 1').get().mutation_id, null)
    const searchName = db.prepare("SELECT value FROM search_values WHERE source_table = 'issues' AND row_id = 1 AND field = 'name'")
    assert.equal(searchName.get().value, 'đăng ký tiếng việt')
    db.exec("UPDATE issues SET name = 'CHUYỂN ĐỔI' WHERE id = 1")
    assert.equal(searchName.get().value, 'chuyển đổi')
    const sticky = db.prepare("SELECT value FROM search_values WHERE source_table = 'stickies' AND row_id = 1 AND field = 'description_stripped'").get()
    assert.equal(sticky.value, stickyText.toLowerCase())
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally {
    db.close()
  }
})
