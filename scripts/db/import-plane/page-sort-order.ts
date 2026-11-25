import type { DatabaseSync } from 'node:sqlite'

/** Backfill alphabetical page order, including historical soft deletions. */
export function backfillPageSortOrder(db: DatabaseSync) {
  db.exec(`
    WITH ordered_pages AS (
      SELECT id, row_number() OVER (ORDER BY name, id) * 100 AS new_sort_order FROM pages
    )
    UPDATE pages SET sort_order = ordered_pages.new_sort_order FROM ordered_pages
    WHERE pages.id = ordered_pages.id;
  `)
}

export function resetPageSortOrder(db: DatabaseSync) {
  db.exec('UPDATE pages SET sort_order = 65535')
}
