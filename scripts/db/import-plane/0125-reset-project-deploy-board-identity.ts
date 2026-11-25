import type { DatabaseSync } from 'node:sqlite'

/** Run after mapping Plane project UUIDs to Lancity project IDs. */
export function resetProjectDeployBoardIdentity(db: DatabaseSync, deletedAt = Date.now()) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const mismatched = db
      .prepare(
        `SELECT id, project_id, deleted_at FROM deploy_boards
      WHERE entity_name = 'project' AND project_id IS NOT NULL AND entity_identifier IS NOT project_id
      ORDER BY created_at DESC, id DESC`
      )
      .all()
    db.prepare(
      `UPDATE deploy_boards SET entity_identifier = NULL WHERE entity_name = 'project'
      AND project_id IS NOT NULL AND entity_identifier IS NOT project_id`
    ).run()
    const other = db.prepare(`SELECT id FROM deploy_boards WHERE entity_name = 'project'
      AND entity_identifier = ? AND deleted_at IS ? LIMIT 1`)
    const restore = db.prepare('UPDATE deploy_boards SET entity_identifier = ? WHERE id = ?')
    const unpublish = db.prepare('UPDATE deploy_boards SET deleted_at = ?, is_disabled = 1 WHERE id = ?')
    for (const board of mismatched) {
      if (!other.get(board.project_id, board.deleted_at)) {
        restore.run(board.project_id, board.id)
      } else if (board.deleted_at === null) {
        unpublish.run(deletedAt, board.id)
      }
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
