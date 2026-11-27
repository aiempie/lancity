import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'vitest'
import { getDb } from '../src/db/client'
import { createLocalD1 } from '../scripts/maintenance/d1-shim'
import { getCycleProgress } from '../src/server/cycle/progress'
import {
  estimateToNumber,
  isNumericEstimate,
  NON_NUMERIC_ESTIMATE_ERROR,
  numericEstimateExpr
} from '../src/server/estimate/numeric'
import {
  bulkCreateEstimate,
  bulkUpdateEstimate,
  createEstimate,
  createEstimatePoints,
  updateEstimatePoint
} from '../src/server/estimate/service'

// Plane #9939: a points estimate holds numbers only, and totals skip any value that is not one.
const NUMERIC = ['0', '5', '12', '3.5', '.5', '5.', ' 8 ', '007', '1000000']
const NOT_NUMERIC = ['', ' ', '.', '..', '1.2.3', 'M = 2', 'one', '2 pts', '-1', '+1', '1e3', 'nan', 'inf', '0x10', '1_0', '٣', '1,5']

function openDb() {
  const raw = new DatabaseSync(':memory:')
  for (const name of ['0000_auth.sql', '0001_plane_domain.sql', '0002_issue_relation_workspace_scope.sql', '0003_backend_extensions.sql'])
    raw.exec(readFileSync(`drizzle/${name}`, 'utf8'))
  raw.exec(`PRAGMA foreign_keys = ON;
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (1, 'Owner', 'owner@example.com', 1, 1, 1);
    INSERT INTO user_security (user_id, is_bot) VALUES (1, 0) ON CONFLICT (user_id) DO UPDATE SET is_bot = excluded.is_bot;
    INSERT INTO workspaces (id, name, slug, owner_id) VALUES (1, 'Workspace', 'ws', 1);
    INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (1, 1, 20);
    INSERT INTO projects (id, name, identifier, workspace_id, network) VALUES (1, 'First', 'FIRST', 1, 2);
    INSERT INTO project_members (workspace_id, project_id, member_id, role) VALUES (1, 1, 1, 20);`)
  return { raw, db: getDb(createLocalD1(raw)) }
}
const owner = { userId: 1 }
const count = (raw: DatabaseSync, table: string) =>
  (raw.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n
const invalid = async (promise: Promise<unknown>) =>
  assert.rejects(promise, (error: Error & { status?: number; code?: string }) => {
    assert.equal(error.status, 400)
    assert.equal(error.code, 'VALIDATION_ERROR')
    assert.equal(error.message, NON_NUMERIC_ESTIMATE_ERROR)
    return true
  })

test('isNumericEstimate accepts plain non-negative decimals only', () => {
  for (const value of NUMERIC) assert.equal(isNumericEstimate(value), true, JSON.stringify(value))
  for (const value of NOT_NUMERIC) assert.equal(isNumericEstimate(value), false, JSON.stringify(value))
  assert.equal(isNumericEstimate(5), true)
  assert.equal(isNumericEstimate(null), false)
  assert.equal(isNumericEstimate('5\n'), false)
})

test('estimateToNumber counts a non-numeric value as 0', () => {
  assert.equal(estimateToNumber(' 3.5 '), 3.5)
  assert.equal(estimateToNumber('.5'), 0.5)
  assert.equal(estimateToNumber('M = 2'), 0)
  assert.equal(estimateToNumber('1e3'), 0)
})

test('the SQL expression accepts exactly the strings isNumericEstimate accepts', () => {
  const raw = new DatabaseSync(':memory:')
  const expr = numericEstimateExpr('v')
  for (const value of [...NUMERIC, ...NOT_NUMERIC, '5\n', ' 5\t']) {
    const { r } = raw.prepare(`select ${expr} as r from (select ? as v)`).get(value) as { r: number | null }
    assert.equal(r, isNumericEstimate(value) ? Number(value.trim()) : null, JSON.stringify(value))
  }
  const { total } = raw
    .prepare(`select sum(${expr}) as total from (select '2' as v union all select 'M = 2' union all select '1.5')`)
    .get() as { total: number }
  assert.equal(total, 3.5)
})

test('createEstimate rejects a non-numeric point of a points estimate and writes nothing', async () => {
  const { db, raw } = openDb()
  const estimate = (type: 'points' | 'categories', value: string) => ({
    estimate: { name: `E-${type}`, description: '', type, last_used: false },
    estimate_points: [{ key: 1, value: '1', description: '' }, { key: 2, value, description: '' }]
  })
  await invalid(createEstimate(db, owner, 'ws', 1, estimate('points', 'M = 2')))
  assert.equal(count(raw, 'estimates'), 0)
  assert.equal(count(raw, 'estimate_points'), 0)
  await createEstimate(db, owner, 'ws', 1, estimate('points', '2.5'))
  await createEstimate(db, owner, 'ws', 1, estimate('categories', 'M = 2'))
  assert.equal(count(raw, 'estimates'), 2)
  assert.equal(count(raw, 'estimate_points'), 4)
  await invalid(bulkCreateEstimate(db, owner, 'ws', 1, { estimate: { description: '', type: 'points', last_used: false }, estimate_points: [{ key: 1, value: 'one', description: '' }] }))
  assert.equal(count(raw, 'estimates'), 2)
})

test('estimate points are checked against the type of their estimate', async () => {
  const { db, raw } = openDb()
  const points = await createEstimate(db, owner, 'ws', 1, {
    estimate: { name: 'Points', description: '', type: 'points', last_used: false },
    estimate_points: [{ key: 1, value: '1', description: '' }]
  })
  const categories = await createEstimate(db, owner, 'ws', 1, {
    estimate: { name: 'Sizes', description: '', type: 'categories', last_used: false },
    estimate_points: [{ key: 1, value: 'S', description: '' }]
  })
  await invalid(createEstimatePoints(db, owner, 'ws', 1, points.id, [{ key: 2, value: 'M', description: '' }]))
  assert.equal(count(raw, 'estimate_points'), 2)
  await createEstimatePoints(db, owner, 'ws', 1, points.id, [{ key: 2, value: '2', description: '' }])
  await createEstimatePoints(db, owner, 'ws', 1, categories.id, [{ key: 2, value: 'M', description: '' }])

  const [first] = raw.prepare('select id from estimate_points where estimate_id = ? order by id').all(points.id) as { id: number }[]
  await invalid(updateEstimatePoint(db, owner, 'ws', 1, points.id, first.id, { value: 'M = 2' }))
  await updateEstimatePoint(db, owner, 'ws', 1, points.id, first.id, { description: 'no value change' })
  await updateEstimatePoint(db, owner, 'ws', 1, points.id, first.id, { value: '8' })
  const [size] = raw.prepare('select id from estimate_points where estimate_id = ? order by id').all(categories.id) as { id: number }[]
  await updateEstimatePoint(db, owner, 'ws', 1, categories.id, size.id, { value: 'XL' })
  assert.equal((raw.prepare('select value from estimate_points where id = ?').get(first.id) as { value: string }).value, '8')
})

test('bulk update checks every point of the estimate and saves nothing when it fails', async () => {
  const { db, raw } = openDb()
  const sizes = await createEstimate(db, owner, 'ws', 1, {
    estimate: { name: 'Sizes', description: '', type: 'categories', last_used: false },
    estimate_points: [{ key: 1, value: 'S', description: '' }, { key: 2, value: '3', description: '' }]
  })
  const [small, three] = raw.prepare('select id from estimate_points where estimate_id = ? order by id').all(sizes.id) as { id: number }[]
  const value = (id: number) => (raw.prepare('select value from estimate_points where id = ?').get(id) as { value: string }).value
  const type = () => (raw.prepare('select type from estimates where id = ?').get(sizes.id) as { type: string }).type

  // The type change makes the untouched point "S" invalid, so the rename and the new value are not saved either.
  await invalid(
    bulkUpdateEstimate(db, owner, 'ws', 1, sizes.id, {
      estimate: { name: 'Renamed', type: 'points' },
      estimate_points: [{ id: three.id, value: '5' }]
    })
  )
  assert.equal(type(), 'categories')
  assert.equal(value(three.id), '3')
  assert.equal((raw.prepare('select name from estimates where id = ?').get(sizes.id) as { name: string }).name, 'Sizes')

  // Fixing the other point in the same request makes it valid.
  const updated = await bulkUpdateEstimate(db, owner, 'ws', 1, sizes.id, {
    estimate: { type: 'points' },
    estimate_points: [{ id: small.id, value: '1' }, { id: three.id, value: '5' }]
  })
  assert.equal(type(), 'points')
  assert.deepEqual(updated.points.map(point => point.value), ['1', '5'])

  // An id of another estimate is ignored, and a non-numeric value is rejected for a points estimate.
  await bulkUpdateEstimate(db, owner, 'ws', 1, sizes.id, { estimate_points: [{ id: 999_999, value: 'ghost' }] })
  await invalid(bulkUpdateEstimate(db, owner, 'ws', 1, sizes.id, { estimate_points: [{ id: small.id, value: 'one' }] }))
  assert.equal(value(small.id), '1')
  // Going back to categories accepts any text.
  await bulkUpdateEstimate(db, owner, 'ws', 1, sizes.id, {
    estimate: { type: 'categories' },
    estimate_points: [{ id: small.id, value: 'one' }]
  })
  assert.equal(value(small.id), 'one')
})

test('cycle progress sums numeric points and skips values that are not numbers', async () => {
  const { db, raw } = openDb()
  raw.exec(`INSERT INTO states (id, name, color, slug, "group", project_id, workspace_id) VALUES (1, 'Todo', '#000', 'todo', 'unstarted', 1, 1), (2, 'Done', '#000', 'done', 'completed', 1, 1);
    INSERT INTO estimates (id, name, type, project_id, workspace_id) VALUES (1, 'Points', 'points', 1, 1);
    INSERT INTO estimate_points (id, key, value, estimate_id, project_id, workspace_id) VALUES
      (1, 1, '3', 1, 1, 1), (2, 2, '2.5', 1, 1, 1), (3, 3, 'M = 2', 1, 1, 1), (4, 4, '2 pts', 1, 1, 1);
    INSERT INTO cycles (id, name, owned_by_id, project_id, workspace_id) VALUES (1, 'Cycle', 1, 1, 1);
    INSERT INTO issues (id, name, sequence_id, state_id, estimate_point_id, project_id, workspace_id) VALUES
      (1, 'a', 1, 1, 1, 1, 1), (2, 'b', 2, 2, 2, 1, 1), (3, 'c', 3, 1, 3, 1, 1), (4, 'd', 4, 2, 4, 1, 1);
    INSERT INTO cycle_issues (cycle_id, issue_id, project_id, workspace_id) VALUES (1, 1, 1, 1), (1, 2, 1, 1), (1, 3, 1, 1), (1, 4, 1, 1);`)
  const progress = await getCycleProgress(db, owner, 'ws', 1, 1)
  assert.equal(progress.total_estimate_points, 5.5)
  assert.equal(progress.unstarted_estimate_points, 3)
  assert.equal(progress.completed_estimate_points, 2.5)
})
