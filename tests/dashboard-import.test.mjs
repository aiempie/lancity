import assert from 'node:assert/strict'
import test from 'node:test'
import { convertDump } from '../scripts/plane-import/convert.ts'
import { renderSql } from '../scripts/plane-import/cli.ts'
import { IdMap } from '../scripts/plane-import/id-map.ts'
import { openTargetDatabase, readTargetSchema } from '../scripts/plane-import/target-schema.ts'
import { planeImportOptionsSchema } from '../src/types/database/p4-migrations-schema.ts'

function run(dump, sourceMigration) {
  const db = openTargetDatabase('drizzle')
  const schema = readTargetSchema(db)
  const result = convertDump({
    dump,
    schema,
    idMap: new IdMap(),
    options: planeImportOptionsSchema.parse({ sourceMigration, now: 1800000000000 })
  })
  db.exec('PRAGMA foreign_keys = ON; BEGIN; PRAGMA defer_foreign_keys = ON')
  for (const group of renderSql(result, schema.order)) for (const statement of group.statements) db.exec(statement)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  db.exec('COMMIT')
  return { db, result }
}
const users = [
  { id: 'user-a', email: 'a@example.com' },
  { id: 'user-b', email: 'b@example.com' }
]

test('0055 seeds eight widgets and a dashboard for each user; 0059 updates filters', () => {
  const { db } = run({ users }, 54)
  assert.equal(db.prepare('select count(*) n from widgets').get().n, 8)
  assert.equal(db.prepare('select count(*) n from dashboards').get().n, 2)
  assert.equal(db.prepare('select count(*) n from dashboard_widgets').get().n, 16)
  assert.deepEqual(JSON.parse(db.prepare("select filters from widgets where key = 'assigned_issues'").get().filters), {
    duration: 'none',
    tab: 'pending'
  })
  db.close()
})

test('historical renamed tables retain data and migrate filters only before 0059', () => {
  const dump = {
    users,
    deprecated_widgets: [
      { id: 'widget-a', key: 'assigned_issues', filters: { custom: true }, logo_props: { icon: 'test' } }
    ],
    deprecated_dashboards: [
      {
        id: 'dashboard-a',
        name: 'Custom',
        owned_by_id: 'user-a',
        identifier: 'legacy-uuid',
        logo_props: { color: 'red' },
        deleted_at: '2024-01-01T00:00:00Z'
      }
    ],
    deprecated_dashboard_widgets: [
      { id: 'link-a', dashboard_id: 'dashboard-a', widget_id: 'widget-a', filters: { local: true }, is_visible: false },
      { id: 'link-deleted', dashboard_id: 'dashboard-a', widget_id: 'widget-a', deleted_at: '2024-01-02T00:00:00Z' }
    ]
  }
  for (const migration of [58, 59, 91]) {
    const { db, result } = run(dump, migration)
    const widget = db.prepare('select * from widgets').get()
    assert.deepEqual(
      JSON.parse(widget.filters),
      migration < 59 ? { duration: 'none', tab: 'pending' } : { custom: true }
    )
    assert.deepEqual(JSON.parse(widget.logo_props), { icon: 'test' })
    const dashboard = db.prepare('select * from dashboards').get()
    assert.equal(dashboard.identifier, 'legacy-uuid')
    assert.deepEqual(JSON.parse(dashboard.logo_props), { color: 'red' })
    assert.equal(dashboard.deleted_at, Date.parse('2024-01-01T00:00:00Z'))
    assert.equal(db.prepare('select count(*) n from dashboard_widgets').get().n, 2)
    assert.equal(db.prepare('select count(*) n from dashboard_widgets where deleted_at is not null').get().n, 1)
    const link = db.prepare('select * from dashboard_widgets where deleted_at is null').get()
    assert.equal(link.widget_id, widget.id)
    assert.equal(link.is_visible, 0)
    assert.deepEqual(JSON.parse(link.filters), { local: true })
    assert.equal(
      result.report.skippedTables.some(row => row.table.startsWith('deprecated_')),
      false
    )
    db.close()
  }
})

test('canonical table takes precedence over renamed alias, and post-deletion dumps stay empty', () => {
  const { db } = run({ users, widgets: [], deprecated_widgets: [{ id: 'old', key: 'recent_activity' }] }, 91)
  assert.equal(db.prepare('select count(*) n from widgets').get().n, 0)
  db.close()
  const modern = run({ users }, 125)
  for (const table of ['widgets', 'dashboards', 'dashboard_widgets'])
    assert.equal(modern.db.prepare(`select count(*) n from ${table}`).get().n, 0)
  modern.db.close()
})
