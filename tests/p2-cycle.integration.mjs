import assert from 'node:assert/strict'
import { openTargetDatabase } from '../scripts/plane-import/target-schema.ts'
import { test } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../src/db/schema.ts'
import { listArchivedCycles, setCycleArchived } from '../src/server/cycle/archive.ts'
import { transferCycleIssues } from '../src/server/cycle/cycle-transfer-issues.ts'
import { register } from '../src/server/cycle/jobs.ts'
import { cycleStatus, getDefaultDisplayFilters } from '../src/server/cycle/model-rules.ts'
import { burndownPlot } from '../src/server/cycle/progress.ts'
import {
  assignCycleIssues,
  checkCycleDates,
  createCycle,
  createCycleFavorite,
  deleteCycle,
  deleteCycleFavorite,
  getCycleAnalytics,
  getCycleProgress,
  getCycleUserProperties,
  getWorkspaceCycles,
  listCycleFavorites,
  listCycles,
  listCyclesLite,
  listCyclesPaginated,
  removeCycleIssue,
  retrieveCycle,
  updateCycle,
  updateCycleUserProperties
} from '../src/server/cycle/service.ts'
import { listCycleSnapshots, snapshotActiveCycles } from '../src/server/cycle/snapshot.ts'
import { notifyTransferredIssues } from '../src/server/cycle/jobs.ts'
import { dispatchJob } from '../src/server/common/jobs.ts'
import { registerOutbox } from '../src/server/common/outbox.ts'

const DAY = 86_400_000
const dayOf = ms => new Date(ms).toISOString().slice(0, 10)
const owner = { userId: 1 }
const member = { userId: 2 }
const guest = { userId: 3 }
const status = code => error => error.status === code

// A SQLite-backed D1 adapter runs the real Drizzle queries and atomic batches (same approach as planning-archive.test.mjs).
function fixture() {
  const sqlite = openTargetDatabase('drizzle')
  sqlite.exec(`PRAGMA foreign_keys = ON;
    INSERT INTO user(id,name,email,username,created_at,updated_at) VALUES(1,'Owner','o@example.com','owner',1,1),(2,'Member','m@example.com','member',1,1),(3,'Guest','g@example.com','guest',1,1),(4,'Outside','x@example.com','outside',1,1);
    INSERT INTO workspaces(id,name,slug,owner_id) VALUES(1,'Workspace','ws',1);
    INSERT INTO workspace_members(workspace_id,member_id,role) VALUES(1,1,20),(1,2,15),(1,3,5),(1,4,15);
    INSERT INTO projects(id,name,identifier,workspace_id,created_by_id,cycle_view) VALUES(1,'Project','PRJ',1,1,1);
    INSERT INTO project_members(project_id,workspace_id,member_id,role) VALUES(1,1,1,20),(1,1,2,15),(1,1,3,5);
    INSERT INTO states(id,name,color,slug,project_id,workspace_id,"group") VALUES(1,'Todo','#000','todo',1,1,'unstarted'),(2,'Done','#111','done',1,1,'completed'),(3,'Cancelled','#222','cancelled',1,1,'cancelled'),(4,'Doing','#333','doing',1,1,'started'),(5,'Later','#444','later',1,1,'backlog');
    INSERT INTO issues(id,name,sequence_id,state_id,project_id,workspace_id,created_by_id) VALUES
      (1,'A',1,1,1,1,1),(2,'B',2,2,1,1,1),(3,'C',3,3,1,1,1),(4,'D',4,1,1,1,1),(5,'E',5,2,1,1,1),(6,'F',6,4,1,1,1);`)
  const prepare = query => ({
    bind(...params) {
      const execute = () => {
        const stmt = sqlite.prepare(query)
        return { results: stmt.columns().length ? stmt.all(...params) : (stmt.run(...params), []) }
      }
      return {
        async raw() {
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
  })
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
  const sent = []
  return {
    sqlite,
    d1,
    db: drizzle(d1, { schema }),
    sent,
    env: { DB: d1, JOBS_QUEUE: { send: async body => void sent.push(body) } }
  }
}

/** Four cycles (current, upcoming, completed, draft) and cycle issues spread over the state groups. */
function seedCycles(sqlite, now = Date.now()) {
  sqlite.exec(`INSERT INTO cycles(id,name,owned_by_id,project_id,workspace_id,start_date,end_date,created_by_id) VALUES
      (1,'Current',1,1,1,${now - DAY},${now + DAY},1),(2,'Upcoming',1,1,1,${now + 5 * DAY},${now + 9 * DAY},1),
      (3,'Done',1,1,1,${now - 9 * DAY},${now - 5 * DAY},1),(4,'Draft',1,1,1,NULL,NULL,1);
    INSERT INTO cycle_issues(cycle_id,issue_id,project_id,workspace_id) VALUES (1,1,1,1),(1,2,1,1),(1,3,1,1),(3,4,1,1),(3,5,1,1);
    INSERT INTO issue_assignees(assignee_id,issue_id,project_id,workspace_id) VALUES (2,1,1,1);`)
}

const rows = (sqlite, query, ...params) => sqlite.prepare(query).all(...params)

test('model rules: status and defaults', () => {
  const now = 1_000_000
  assert.equal(cycleStatus(now - 1, now + 1, now), 'CURRENT')
  assert.equal(cycleStatus(now + 1, now + 2, now), 'UPCOMING')
  assert.equal(cycleStatus(now - 2, now - 1, now), 'COMPLETED')
  assert.equal(cycleStatus(null, null, now), 'DRAFT')
  assert.equal(getDefaultDisplayFilters().layout, 'list')
})

test('lists filter by cycle_view, count state groups and paginate', async () => {
  const { sqlite, db } = fixture()
  seedCycles(sqlite)
  const all = await listCycles(db, owner, 'ws', 1)
  assert.equal(all.length, 4)
  const current = all.find(cycle => cycle.id === 1)
  assert.equal(current.status, 'CURRENT')
  assert.deepEqual(
    [current.totalIssues, current.completedIssues, current.cancelledIssues, current.unstartedIssues],
    [3, 1, 1, 1]
  )
  assert.deepEqual(current.assigneeIds, [2])
  for (const [view, expected] of [
    ['current', [1]],
    ['upcoming', [2]],
    ['completed', [3]],
    ['draft', [4]]
  ])
    assert.deepEqual(
      (await listCycles(db, owner, 'ws', 1, { cycle_view: view })).map(cycle => cycle.id),
      expected,
      view
    )
  assert.deepEqual(
    (await listCycles(db, owner, 'ws', 1, { cycle_view: 'incomplete' })).map(cycle => cycle.id).sort(),
    [1, 2, 4]
  )
  // `current` with no running cycle falls back to the whole list, like the app endpoint.
  sqlite.exec('UPDATE cycles SET end_date = 1 WHERE id = 1')
  assert.equal((await listCycles(db, owner, 'ws', 1, { cycle_view: 'current' })).length, 4)

  const page = await listCyclesPaginated(db, owner, 'ws', 1, new URLSearchParams('per_page=3'))
  assert.equal(page.results.length, 3)
  assert.equal(page.total_count, 4)
  assert.equal(page.next_page_results, true)
  const lite = await listCyclesLite(db, guest, 'ws', 1, new URLSearchParams('per_page=10'))
  assert.equal(lite.results.length, 4)
  assert.equal('totalIssues' in lite.results[0], false)
  assert.deepEqual(
    await listCyclesPaginated(db, owner, 'ws', 1, new URLSearchParams('cycle_view=draft&per_page=5')).then(r =>
      r.results.map(c => c.id)
    ),
    [4]
  )
  sqlite.close()
})

test('create converts dates, sorts first, rejects bad input and external id clashes', async () => {
  const { sqlite, db } = fixture()
  seedCycles(sqlite)
  const created = await createCycle(db, owner, 'ws', 1, {
    name: 'New',
    start_date: '2031-01-10',
    end_date: '2031-01-20'
  })
  assert.equal(created.startDate.getTime(), Date.UTC(2031, 0, 10, 0, 0, 1))
  assert.equal(created.endDate.getTime(), Date.UTC(2031, 0, 20, 23, 59, 0))
  assert.equal(created.sortOrder, 55535)
  assert.equal(created.ownedById, 1)
  await assert.rejects(createCycle(db, owner, 'ws', 1, { name: 'Half', start_date: '2031-01-01' }), status(400))
  await assert.rejects(
    createCycle(db, owner, 'ws', 1, { name: 'Backwards', start_date: '2031-02-01', end_date: '2031-01-01' }),
    status(400)
  )
  await assert.rejects(createCycle(db, guest, 'ws', 1, { name: 'Guest' }), status(403))
  await assert.rejects(createCycle(db, owner, 'ws', 1, { name: 'Owner', owned_by: 4 }), status(400))
  const external = await createCycle(db, owner, 'ws', 1, { name: 'Ext', external_source: 'gh', external_id: '7' })
  await assert.rejects(
    createCycle(db, owner, 'ws', 1, { name: 'Ext2', external_source: 'gh', external_id: '7' }),
    error => error.status === 409 && error.details.id === external.id
  )
  // Project timezone: the day boundaries follow it and the DTO prints it.
  sqlite.exec(`UPDATE projects SET timezone = 'Asia/Ho_Chi_Minh' WHERE id = 1`)
  const local = await createCycle(db, owner, 'ws', 1, {
    name: 'Local',
    start_date: '2031-03-01',
    end_date: '2031-03-05'
  })
  assert.equal(local.startDate.getTime(), Date.UTC(2031, 1, 28, 17, 0, 1))
  const dto = await retrieveCycle(db, owner, 'ws', 1, local.id)
  assert.ok(dto.startDate.startsWith('2031-03-01T00:00:01+07:00'), dto.startDate)
  assert.equal(dto.status, 'UPCOMING')
  assert.equal(dto.subIssues, 0)
  sqlite.close()
})

test('date check finds overlapping cycles and ignores the cycle being edited', async () => {
  const { sqlite, db } = fixture()
  const created = await createCycle(db, owner, 'ws', 1, {
    name: 'Span',
    start_date: '2031-01-10',
    end_date: '2031-01-20'
  })
  assert.deepEqual(
    (await checkCycleDates(db, owner, 'ws', 1, { start_date: '2031-01-15', end_date: '2031-01-25' })).status,
    false
  )
  assert.equal(
    (await checkCycleDates(db, owner, 'ws', 1, { start_date: '2031-01-01', end_date: '2031-02-01' })).status,
    false
  )
  assert.equal(
    (
      await checkCycleDates(db, owner, 'ws', 1, {
        start_date: '2031-01-15',
        end_date: '2031-01-25',
        cycle_id: created.id
      })
    ).status,
    true
  )
  assert.equal(
    (await checkCycleDates(db, owner, 'ws', 1, { start_date: '2032-01-01', end_date: '2032-01-05' })).status,
    true
  )
  await assert.rejects(
    checkCycleDates(db, guest, 'ws', 1, { start_date: '2032-01-01', end_date: '2032-01-05' }),
    status(403)
  )
  sqlite.close()
})

test('update locks completed and archived cycles; delete needs admin or creator', async () => {
  const { sqlite, db } = fixture()
  seedCycles(sqlite)
  await assert.rejects(updateCycle(db, owner, 'ws', 1, 3, { name: 'Late' }), status(400))
  await updateCycle(db, owner, 'ws', 1, 3, { sort_order: 7 })
  assert.equal(rows(sqlite, 'SELECT sort_order FROM cycles WHERE id = 3')[0].sort_order, 7)
  const renamed = await updateCycle(db, member, 'ws', 1, 1, {
    name: 'Renamed',
    start_date: '2031-01-01',
    end_date: '2031-01-31'
  })
  assert.equal(renamed.name, 'Renamed')
  await assert.rejects(updateCycle(db, member, 'ws', 1, 1, { end_date: null }), status(400))
  sqlite.exec('UPDATE cycles SET archived_at = 1 WHERE id = 4')
  await assert.rejects(updateCycle(db, owner, 'ws', 1, 4, { name: 'Nope' }), status(400))

  sqlite.exec(
    `INSERT INTO user_favorites(entity_type,entity_identifier,project_id,user_id,workspace_id) VALUES('cycle',2,1,1,1),('cycle',2,1,2,1)`
  )
  await assert.rejects(deleteCycle(db, member, 'ws', 1, 2), status(403))
  await deleteCycle(db, owner, 'ws', 1, 2)
  assert.ok(rows(sqlite, 'SELECT deleted_at FROM cycles WHERE id = 2')[0].deleted_at)
  assert.equal(rows(sqlite, `SELECT count(*) AS n FROM user_favorites WHERE entity_type = 'cycle'`)[0].n, 0)
  await assert.rejects(retrieveCycle(db, owner, 'ws', 1, 2), status(404))

  const own = await createCycle(db, member, 'ws', 1, { name: 'Mine' })
  sqlite.exec(`INSERT INTO cycle_issues(cycle_id,issue_id,project_id,workspace_id) VALUES(${own.id},6,1,1)`)
  await deleteCycle(db, member, 'ws', 1, own.id)
  assert.ok(rows(sqlite, 'SELECT deleted_at FROM cycle_issues WHERE cycle_id = ?', own.id)[0].deleted_at)
  sqlite.close()
})

test('assign moves, adds and removes issues', async () => {
  const { sqlite, db } = fixture()
  seedCycles(sqlite)
  for (let id = 100; id < 140; id++)
    sqlite.exec(
      `INSERT INTO issues(id,name,sequence_id,state_id,project_id,workspace_id,created_by_id) VALUES(${id},'I${id}',${id},1,1,1,1)`
    )
  const ids = [1, ...Array.from({ length: 39 }, (_, i) => 100 + i)]
  await assignCycleIssues(db, owner, 'ws', 1, 2, ids)
  const live = cycleId =>
    rows(sqlite, 'SELECT issue_id FROM cycle_issues WHERE cycle_id = ? AND deleted_at IS NULL', cycleId)
  assert.equal(live(2).length, 40)
  assert.equal(
    live(1).some(row => row.issue_id === 1),
    false
  )
  await assignCycleIssues(db, owner, 'ws', 1, 2, [1, 100]) // already there: no-op
  assert.equal(live(2).length, 40)
  await assert.rejects(assignCycleIssues(db, owner, 'ws', 1, 2, [1, 999_999]), status(404))
  await assert.rejects(assignCycleIssues(db, owner, 'ws', 1, 3, [6]), status(400)) // completed cycle
  await assert.rejects(assignCycleIssues(db, guest, 'ws', 1, 2, [6]), status(403))
  await removeCycleIssue(db, owner, 'ws', 1, 2, 100)
  assert.ok(rows(sqlite, 'SELECT deleted_at FROM cycle_issues WHERE cycle_id = 2 AND issue_id = 100')[0].deleted_at)
  await assert.rejects(removeCycleIssue(db, owner, 'ws', 1, 2, 100), status(404))
  await assignCycleIssues(db, owner, 'ws', 1, 2, [100]) // can be added again after a soft delete
  assert.equal(live(2).length, 40)
  sqlite.close()
})

test('progress, analytics and the burndown chart', async () => {
  const { sqlite, db } = fixture()
  const now = Date.now()
  seedCycles(sqlite, now)
  sqlite.exec(`INSERT INTO estimates(id,name,type,project_id,workspace_id) VALUES(1,'Points','points',1,1);
    INSERT INTO estimate_points(id,key,value,estimate_id,project_id,workspace_id) VALUES(1,0,'3',1,1,1),(2,1,'5',1,1,1);
    UPDATE projects SET estimate_id = 1 WHERE id = 1;
    UPDATE issues SET estimate_point_id = 1 WHERE id = 1; UPDATE issues SET estimate_point_id = 2, completed_at = ${now - DAY} WHERE id = 2;`)
  const progress = await getCycleProgress(db, owner, 'ws', 1, 1)
  assert.equal(progress.total_issues, 3)
  assert.equal(progress.completed_issues, 1)
  assert.equal(progress.total_estimate_points, 8)
  assert.equal(progress.completed_estimate_points, 5)
  assert.equal(progress.unstarted_estimate_points, 3)

  const analytics = await getCycleAnalytics(db, guest, 'ws', 1, 1, 'issues')
  const days = [dayOf(now - DAY), dayOf(now), dayOf(now + DAY)]
  assert.deepEqual(analytics.completion_chart, { [days[0]]: 2, [days[1]]: 2, [days[2]]: null })
  const assignee = analytics.assignees.find(row => row.assignee_id === 2)
  assert.deepEqual([assignee.total_issues, assignee.pending_issues, assignee.completed_issues], [1, 1, 0])
  const points = await getCycleAnalytics(db, owner, 'ws', 1, 1, 'points')
  assert.deepEqual(points.completion_chart, { [days[0]]: 3, [days[1]]: 3, [days[2]]: null })
  assert.equal(points.assignees.find(row => row.assignee_id === 2).total_estimates, 3)

  const cycle = rows(sqlite, 'SELECT start_date, end_date FROM cycles WHERE id = 1')[0]
  const direct = await burndownPlot(
    db,
    { cycleId: 1, projectId: 1, workspaceId: 1 },
    { startDate: cycle.start_date, endDate: cycle.end_date },
    'issues',
    now
  )
  assert.deepEqual(direct, analytics.completion_chart)
  await assert.rejects(getCycleAnalytics(db, owner, 'ws', 1, 4, 'issues'), status(400)) // draft: no dates
  sqlite.close()
})

test('transfer stores the snapshot, analytics reads it and the notify job fans out', async () => {
  const { sqlite, db, env, sent } = fixture()
  seedCycles(sqlite)
  sqlite.exec(`UPDATE issues SET completed_at = ${Date.now() - 6 * DAY} WHERE id = 5`)
  const since = Date.now() - 1000
  await assert.rejects(transferCycleIssues(db, owner, 'ws', 1, 3, 3), status(400))
  await transferCycleIssues(db, owner, 'ws', 1, 3, 2)
  assert.equal(rows(sqlite, 'SELECT cycle_id FROM cycle_issues WHERE issue_id = 4')[0].cycle_id, 2)
  assert.equal(rows(sqlite, 'SELECT cycle_id FROM cycle_issues WHERE issue_id = 5')[0].cycle_id, 3)
  const snapshot = JSON.parse(rows(sqlite, 'SELECT progress_snapshot FROM cycles WHERE id = 3')[0].progress_snapshot)
  assert.equal(snapshot.total_issues, 2)
  assert.equal(snapshot.completed_issues, 1)
  assert.ok(Array.isArray(snapshot.distribution.assignees))
  assert.ok(Array.isArray(snapshot.distribution.labels))
  assert.deepEqual(snapshot.estimate_distribution, {})
  assert.equal(Object.keys(snapshot.distribution.completion_chart).length, 5)

  const analytics = await getCycleAnalytics(db, owner, 'ws', 1, 3)
  assert.deepEqual(analytics.completion_chart, snapshot.distribution.completion_chart)
  // New issues in the cycle do not change the frozen counts.
  sqlite.exec('INSERT INTO cycle_issues(cycle_id,issue_id,project_id,workspace_id) VALUES(3,6,1,1)')
  assert.equal((await getCycleProgress(db, owner, 'ws', 1, 3)).total_issues, 2)

  const [outbox] = rows(sqlite, "SELECT id, event_key FROM job_outbox WHERE type = 'cycle.transfer.notify'")
  assert.equal(rows(sqlite, 'SELECT mutation_id FROM issue_activities WHERE issue_id = 4')[0].mutation_id, outbox.event_key)
  register()
  registerOutbox()
  const message = { type: 'outbox.dispatch', payload: { outboxId: outbox.id } }
  await dispatchJob(env, message)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].type, 'notification.issue')
  assert.match(sent[0].id, /^cycle-transfer:/)
  assert.equal(sent[0].payload.issueId, 4)
  assert.equal(sent[0].payload.issueActivitiesCreated[0].newIdentifier, 2)

  await dispatchJob(env, message)
  await notifyTransferredIssues(env, { projectId: 1, workspaceId: 1, actorId: 1, fromCycleId: 3, toCycleId: 2, since })
  assert.equal(sent.length, 1, 'A replay or a legacy job must not notify the new transfer again')
  sqlite.close()
})

test('archived cycles carry counts and a distribution detail', async () => {
  const { sqlite, db } = fixture()
  seedCycles(sqlite)
  await setCycleArchived(db, owner, 'ws', 1, 3, true)
  const list = await listArchivedCycles(db, owner, 'ws', 1)
  assert.equal(list.length, 1)
  assert.equal(list[0].totalIssues, 2)
  assert.equal(list[0].totalEstimatePoints, 0)
  const detail = await listArchivedCycles(db, owner, 'ws', 1, 3)
  assert.ok(detail.distribution.assignees)
  assert.deepEqual(detail.estimateDistribution, {})
  assert.equal(detail.subIssues, 0)
  await assert.rejects(listArchivedCycles(db, owner, 'ws', 1, 1), status(404))
  await assert.rejects(retrieveCycle(db, owner, 'ws', 1, 3), status(404))
  sqlite.close()
})

test('favorites and user properties', async () => {
  const { sqlite, db } = fixture()
  seedCycles(sqlite)
  await createCycleFavorite(db, member, 'ws', 1, 1)
  await createCycleFavorite(db, member, 'ws', 1, 1) // idempotent
  assert.equal(rows(sqlite, `SELECT count(*) AS n FROM user_favorites WHERE entity_type = 'cycle'`)[0].n, 1)
  assert.deepEqual(
    (await listCycleFavorites(db, member, 'ws', 1)).map(cycle => cycle.id),
    [1]
  )
  assert.equal((await listCycles(db, member, 'ws', 1)).find(cycle => cycle.id === 1).isFavorite, true)
  assert.equal((await listCycles(db, owner, 'ws', 1)).find(cycle => cycle.id === 1).isFavorite, false)
  await assert.rejects(createCycleFavorite(db, member, 'ws', 1, 999), status(404))
  await deleteCycleFavorite(db, member, 'ws', 1, 1)
  await assert.rejects(deleteCycleFavorite(db, member, 'ws', 1, 1), status(404))

  const defaults = await getCycleUserProperties(db, guest, 'ws', 1, 1)
  assert.equal(defaults.displayFilters.layout, 'list')
  assert.equal(defaults.filters.priority, null)
  const updated = await updateCycleUserProperties(db, guest, 'ws', 1, 1, { display_filters: { layout: 'kanban' } })
  assert.equal(updated.displayFilters.layout, 'kanban')
  assert.equal(updated.displayProperties.assignee, true)
  assert.equal(rows(sqlite, 'SELECT count(*) AS n FROM cycle_user_properties')[0].n, 1)
  sqlite.close()
})

test('workspace cycles only show projects the actor belongs to', async () => {
  const { sqlite, db } = fixture()
  seedCycles(sqlite)
  assert.equal((await getWorkspaceCycles(db, owner, 'ws')).length, 4)
  assert.equal((await getWorkspaceCycles(db, { userId: 4 }, 'ws')).length, 0)
  sqlite.close()
})

test('the snapshot cron upserts one row per active cycle and day', async () => {
  const { sqlite, db, env } = fixture()
  const now = Date.now()
  seedCycles(sqlite, now)
  await snapshotActiveCycles(env, now)
  let list = rows(sqlite, 'SELECT * FROM cycle_progress_snapshots')
  assert.equal(list.length, 1)
  assert.equal(list[0].cycle_id, 1)
  assert.equal(list[0].snapshot_date, dayOf(now))
  assert.equal(list[0].total_issues, 3)
  assert.equal(list[0].completed_issues, 1)
  sqlite.exec('INSERT INTO cycle_issues(cycle_id,issue_id,project_id,workspace_id) VALUES(1,6,1,1)')
  await snapshotActiveCycles(env, now)
  list = rows(sqlite, 'SELECT * FROM cycle_progress_snapshots')
  assert.equal(list.length, 1)
  assert.equal(list[0].total_issues, 4)
  const history = await listCycleSnapshots(db, guest, 'ws', 1, 1)
  assert.equal(history.length, 1)
  assert.equal(history[0].remainingIssues, 3)
  sqlite.exec('UPDATE projects SET archived_at = 1 WHERE id = 1')
  await snapshotActiveCycles(env, now + DAY)
  assert.equal(rows(sqlite, 'SELECT * FROM cycle_progress_snapshots').length, 1)
  sqlite.close()
})


test('cycle assignments and removals persist their activity events in the mutation batch', async () => {
  const { sqlite, db } = fixture()
  seedCycles(sqlite)
  await assignCycleIssues(db, owner, 'ws', 1, 2, [6])
  let events = rows(sqlite, "select payload from job_outbox where type = 'issue.activity' order by id")
  assert.equal(events.length, 1)
  assert.equal(JSON.parse(events[0].payload).type, 'cycle.activity.created')
  await removeCycleIssue(db, owner, 'ws', 1, 2, 6)
  events = rows(sqlite, "select payload from job_outbox where type = 'issue.activity' order by id")
  assert.equal(events.length, 2)
  assert.equal(JSON.parse(events[1].payload).type, 'cycle.activity.deleted')
  await assert.rejects(removeCycleIssue(db, owner, 'ws', 1, 2, 6), status(404))
  assert.equal(rows(sqlite, "select id from job_outbox where type = 'issue.activity'").length, 2)
  sqlite.close()
})

test('outbox failure rolls back cycle assignment', async () => {
  const { sqlite, db } = fixture()
  seedCycles(sqlite)
  sqlite.exec("create trigger fail_cycle_outbox before insert on job_outbox begin select raise(abort, 'outbox failure'); end")
  await assert.rejects(assignCycleIssues(db, owner, 'ws', 1, 2, [6]))
  assert.equal(rows(sqlite, 'select id from cycle_issues where cycle_id = 2 and issue_id = 6').length, 0)
  sqlite.close()
})
