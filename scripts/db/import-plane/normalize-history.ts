import type { DatabaseSync } from 'node:sqlite'

/** Normalize legacy issue audit rows after their issue and user IDs have been mapped. */
export function normalizeIssueHistory(db: DatabaseSync) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`
      UPDATE issue_activities SET field = 'assignees' WHERE field = 'assignee';
      UPDATE issue_activities SET comment = replace(comment, 'start date', 'name') WHERE field = 'name';
      UPDATE issue_activities SET old_value = coalesce(nullif(old_value, ''), 'none'),
        new_value = coalesce(nullif(new_value, ''), 'none') WHERE field = 'priority';
      UPDATE issue_activities SET field = 'blocked_by' WHERE field = 'blocks';
    `)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
