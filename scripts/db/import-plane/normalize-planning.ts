import type { DatabaseSync } from 'node:sqlite'

/** Apply the historical planning transforms to rows in an isolated Plane import database. */
export function normalizeLegacyPlanning(db: DatabaseSync) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`
      UPDATE states SET is_triage = 1, "group" = 'triage'
        WHERE "group" = 'backlog' AND name = 'Triage';
      UPDATE estimates SET last_used = 1 WHERE id IN (SELECT estimate_id FROM projects WHERE estimate_id IS NOT NULL);
      UPDATE intake_issues SET source = 'IN_APP' WHERE source = 'in-app' COLLATE NOCASE;
    `)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
