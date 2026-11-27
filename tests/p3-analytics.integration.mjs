import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../src/db/schema.ts'
import {
  addMonth,
  getAdvanceAnalytics,
  getAdvanceAnalyticsChart,
  getAdvanceAnalyticsStats,
  titleCase
} from '../src/server/analytics/advance.ts'
import {
  annotateWithMonthlyDimension,
  buildGraphPlot,
  burndownPlot,
  sortData
} from '../src/server/analytics/analytics-plot.ts'
import { buildAnalyticsChart, getYAxisFilter, processGroupedData } from '../src/server/analytics/build-chart.ts'
import { analyticExportTask, exportAnalyticsToCsvEmail, generateCsvFromRows } from '../src/server/analytics/export.ts'
import { register } from '../src/server/analytics/jobs.ts'
import { formatAnalytic } from '../src/server/analytics/presenters.ts'
import { issuesWhere } from '../src/server/analytics/queries.ts'
import {
  getProjectAdvanceAnalytics,
  getProjectAdvanceAnalyticsChart,
  getProjectAdvanceAnalyticsStats
} from '../src/server/analytics/project-analytics.ts'
import {
  createAnalyticView,
  deleteAnalyticView,
  exportAnalytics,
  getAnalyticExport,
  getAnalytics,
  getDefaultAnalytics,
  getProjectStats,
  getSavedAnalytic,
  listAnalyticViews,
  projectIssueMetrics,
  updateAnalyticView
} from '../src/server/analytics/service.ts'
import { dispatchJob } from '../src/server/common/jobs.ts'

const DAY = 86_400_000
const dayOf = ms => new Date(ms).toISOString().slice(0, 10)
const owner = { userId: 1 }
const member = { userId: 2 }
const guest = { userId: 3 }
const outsider = { userId: 4 }
const status = code => error => error.status === code

// A SQLite-backed D1 adapter runs the real Drizzle queries and raw SQL (same approach as p2-cycle.integration.mjs).
function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  for (const migration of [
    'drizzle/0000_auth.sql',
    'drizzle/0001_plane_domain.sql',
    'drizzle/0002_issue_relation_workspace_scope.sql',
    'drizzle/0003_backend_extensions.sql',
    'drizzle/0004_job_claims.sql'
  ])
    sqlite.exec(readFileSync(migration, 'utf8'))
  const now = Date.now()
  sqlite.exec(`PRAGMA foreign_keys = ON;
    INSERT INTO user(id,name,email,username,created_at,updated_at) VALUES(1,'Owner','o@example.com','owner',1,1),(2,'Member','m@example.com','member',1,1),(3,'Guest','g@example.com','guest',1,1),(4,'Outside','x@example.com','outside',1,1);
    INSERT INTO workspaces(id,name,slug,owner_id) VALUES(1,'Workspace','ws',1);
    INSERT INTO workspace_members(workspace_id,member_id,role) VALUES(1,1,20),(1,2,15),(1,3,5),(1,4,15);
    INSERT INTO projects(id,name,identifier,workspace_id,created_by_id,estimate_id) VALUES(1,'Project','PRJ',1,1,NULL);
    INSERT INTO project_members(project_id,workspace_id,member_id,role) VALUES(1,1,1,20),(1,1,2,15),(1,1,3,5);
    INSERT INTO states(id,name,color,slug,project_id,workspace_id,"group") VALUES(1,'Todo','#000','todo',1,1,'unstarted'),(2,'Done','#111','done',1,1,'completed'),(3,'Cancelled','#222','cancelled',1,1,'cancelled'),(4,'Doing','#333','doing',1,1,'started'),(5,'Later','#444','later',1,1,'backlog');
    INSERT INTO estimates(id,name,project_id,workspace_id,type) VALUES(1,'Points',1,1,'points');
    UPDATE projects SET estimate_id = 1 WHERE id = 1;
    INSERT INTO estimate_points(id,key,value,estimate_id,project_id,workspace_id) VALUES(1,0,'2',1,1,1),(2,1,'3',1,1,1);
    INSERT INTO issues(id,name,sequence_id,state_id,project_id,workspace_id,created_by_id,priority,estimate_point_id,completed_at) VALUES
      (1,'A',1,1,1,1,1,'urgent',1,NULL),(2,'B',2,2,1,1,1,'high',2,${now}),(3,'C',3,3,1,1,1,'low',NULL,NULL),
      (4,'D',4,1,1,1,1,'high',1,NULL),(5,'E',5,2,1,1,1,'none',NULL,${now}),(6,'F',6,4,1,1,1,'medium',NULL,NULL);
    INSERT INTO issue_assignees(assignee_id,issue_id,project_id,workspace_id) VALUES (2,1,1,1),(2,2,1,1),(3,2,1,1);
    INSERT INTO labels(id,name,color,project_id,workspace_id) VALUES(1,'Bug','#f00',1,1);
    INSERT INTO issue_labels(label_id,issue_id,project_id,workspace_id) VALUES (1,1,1,1),(1,3,1,1);
    INSERT INTO cycles(id,name,owned_by_id,project_id,workspace_id,start_date,end_date) VALUES(1,'Sprint',1,1,1,${now - DAY},${now + DAY});
    INSERT INTO cycle_issues(cycle_id,issue_id,project_id,workspace_id) VALUES (1,1,1,1),(1,2,1,1);
    INSERT INTO modules(id,name,project_id,workspace_id,start_date,target_date) VALUES(1,'Mod',1,1,'${dayOf(now - DAY)}','${dayOf(now + DAY)}');
    INSERT INTO module_issues(module_id,issue_id,project_id,workspace_id) VALUES (1,1,1,1),(1,3,1,1);`)
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
  const stored = new Map()
  return {
    sqlite,
    d1,
    db: drizzle(d1, { schema }),
    sent,
    stored,
    now,
    env: { DB: d1, JOBS_QUEUE: { send: async body => void sent.push(body) }, BETTER_AUTH_URL: 'http://localhost:4198' },
    // R2 stand-in for the export file.
    bucketEnv() {
      return {
        DB: d1,
        BETTER_AUTH_URL: 'http://localhost:4198',
        ASSET_BUCKET: { put: async (key, value) => void stored.set(key, value) }
      }
    }
  }
}

const scope = { workspaceId: 1, userId: 1 }
const mails = () => {
  const mailbox = []
  return { mailbox, deps: { send: async mail => (mailbox.push(mail), { sent: true }) } }
}

test('pure helpers: sort, grouping, titles, months and CSV', () => {
  const plot = new Map([
    ['none', [{ dimension: 'none' }]],
    ['b', [{ dimension: 'b' }]],
    ['a', [{ dimension: 'a' }]]
  ])
  assert.deepEqual(Object.keys(sortData(plot, 'state__group')), ['a', 'b', 'none'])
  const priorities = new Map([
    ['none', []],
    ['urgent', []],
    ['low', []],
    ['bogus', []]
  ])
  assert.deepEqual(Object.keys(sortData(priorities, 'priority')), ['low', 'urgent', 'none'])
  const grouped = processGroupedData([
    { key: 1, group_key: 'x', group_name: 'X', display_name: 'One', count: 2 },
    { key: 1, group_key: null, group_name: null, display_name: 'One', count: 1 },
    { key: null, group_key: 'x', group_name: 'X', display_name: null, count: 4 }
  ])
  assert.deepEqual(grouped.schema, { x: 'X', none: 'None' })
  assert.deepEqual(grouped.data, [
    { key: 1, name: 'One', count: 3, x: 2, none: 1 },
    { key: 'none', name: 'None', count: 4, x: 4 }
  ])
  assert.equal(titleCase('work_items'), 'Work Items')
  assert.equal(addMonth(new Date('2024-01-31T00:00:00Z')).toISOString().slice(0, 10), '2024-02-29')
  assert.equal(addMonth(new Date('2024-12-15T00:00:00Z')).toISOString().slice(0, 10), '2025-01-15')
  assert.equal(getYAxisFilter('NOPE'), undefined)
  assert.ok(getYAxisFilter('WORK_ITEM_COUNT'))
  assert.ok(annotateWithMonthlyDimension('start_date'))
  assert.equal(generateCsvFromRows([['a"b', '=SUM(1)', null, 3]]), '"a""b","\'=SUM(1)","","3"\r\n')
  assert.equal(formatAnalytic({ name: 'View' }, { name: 'Space' }), 'View <Space>')
})

test('buildGraphPlot groups by axis, segment and estimate', async () => {
  const { db } = fixture()
  const where = issuesWhere(scope)
  const byPriority = await buildGraphPlot(db, where, 'priority', 'issue_count')
  assert.deepEqual(
    Object.entries(byPriority).map(([key, rows]) => [key, rows[0].count]),
    [
      ['low', 1],
      ['medium', 1],
      ['high', 2],
      ['urgent', 1],
      ['none', 1]
    ]
  )
  const byGroup = await buildGraphPlot(db, where, 'state__group', 'issue_count')
  assert.deepEqual(Object.keys(byGroup), ['cancelled', 'completed', 'started', 'unstarted'])
  const segmented = await buildGraphPlot(db, where, 'priority', 'issue_count', 'state__group')
  assert.deepEqual(
    segmented.high.map(row => [row.segment, row.count]),
    [
      ['completed', 1],
      ['unstarted', 1]
    ]
  )
  const byAssignee = await buildGraphPlot(db, where, 'assignees__id', 'issue_count')
  assert.deepEqual([byAssignee['2'][0].count, byAssignee['3'][0].count], [2, 1])
  const estimates = await buildGraphPlot(db, where, 'state__group', 'estimate')
  assert.deepEqual([estimates.unstarted[0].estimate, estimates.completed[0].estimate], [4, 3])
  const now = new Date()
  const monthly = await buildGraphPlot(db, where, 'created_at', 'issue_count')
  assert.deepEqual(Object.keys(monthly), [`${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`])
  await assert.rejects(buildGraphPlot(db, where, 'bogus', 'issue_count'), /Invalid x_axis/)
  await assert.rejects(buildGraphPlot(db, where, 'priority', 'bogus'), /Invalid y_axis/)
  await assert.rejects(buildGraphPlot(db, where, 'priority', 'issue_count', 'bogus'), /Invalid segment/)
})

test('analytics endpoint validates axes, applies filters and the caller project scope', async () => {
  const { db } = fixture()
  const params = { x_axis: 'state__group', y_axis: 'issue_count' }
  const result = await getAnalytics(db, member, 'ws', params)
  assert.equal(result.total, 6)
  assert.deepEqual(result.extras.state_details, {})
  const withState = await getAnalytics(db, member, 'ws', { x_axis: 'state_id', y_axis: 'issue_count' })
  assert.equal(withState.extras.state_details.length, 5 - 1) // no issue is in the "Later" state
  assert.equal((await getAnalytics(db, member, 'ws', { ...params, priority: 'high' })).total, 2)
  assert.equal((await getAnalytics(db, outsider, 'ws', params)).total, 0)
  await assert.rejects(getAnalytics(db, member, 'ws', { x_axis: 'priority' }), status(400))
  await assert.rejects(
    getAnalytics(db, member, 'ws', { x_axis: 'priority', y_axis: 'issue_count', segment: 'priority' }),
    status(400)
  )
  await assert.rejects(getAnalytics(db, guest, 'ws', params), status(403))
})

test('chart builder: simple, grouped and invalid axes', async () => {
  const { db } = fixture()
  const where = issuesWhere(scope)
  const simple = await buildAnalyticsChart(db, where, 'PRIORITY')
  assert.deepEqual(
    simple.data.map(item => [item.key, item.count]),
    [
      ['high', 2],
      ['low', 1],
      ['medium', 1],
      ['none', 1],
      ['urgent', 1]
    ]
  )
  const assignees = await buildAnalyticsChart(db, where, 'ASSIGNEES')
  assert.deepEqual(
    assignees.data.map(item => [item.key, item.name, item.count]),
    [
      [2, 'member', 2],
      [3, 'guest', 1],
      ['None', 'None', 4]
    ]
  )
  const grouped = await buildAnalyticsChart(db, where, 'PRIORITY', 'STATE_GROUPS')
  const high = grouped.data.find(item => item.key === 'high')
  assert.deepEqual([high.count, high.completed, high.unstarted], [2, 1, 1])
  assert.deepEqual(grouped.schema, {
    cancelled: 'cancelled',
    completed: 'completed',
    started: 'started',
    unstarted: 'unstarted'
  })
  await assert.rejects(buildAnalyticsChart(db, where, 'BOGUS'), status(400))
  await assert.rejects(buildAnalyticsChart(db, where, 'PRIORITY', 'BOGUS'), status(400))
})

test('workspace advance analytics: overview, work items, stats and charts', async () => {
  const { db } = fixture()
  const overview = await getAdvanceAnalytics(db, owner, 'ws', {})
  assert.deepEqual(
    Object.values(overview).map(item => item.count),
    [4, 1, 2, 1, 1, 6, 1, 0]
  )
  assert.equal((await getAdvanceAnalytics(db, owner, 'ws', { project_ids: '1' })).total_users.count, 3)
  const items = await getAdvanceAnalytics(db, owner, 'ws', { tab: 'work-items' })
  assert.deepEqual(
    [
      items.total_work_items,
      items.started_work_items,
      items.backlog_work_items,
      items.un_started_work_items,
      items.completed_work_items
    ].map(item => item.count),
    [6, 1, 0, 2, 2]
  )
  assert.equal(
    (await getAdvanceAnalytics(db, owner, 'ws', { tab: 'work-items', date_filter: 'last_7_days' })).total_work_items
      .count,
    6
  )
  assert.equal(
    (await getAdvanceAnalytics(db, owner, 'ws', { tab: 'work-items', date_filter: 'yesterday' })).total_work_items
      .count,
    0
  )
  await assert.rejects(getAdvanceAnalytics(db, owner, 'ws', { tab: 'bogus' }), status(400))
  await assert.rejects(getAdvanceAnalytics(db, guest, 'ws', {}), status(403))

  const stats = await getAdvanceAnalyticsStats(db, owner, 'ws', {})
  // node:sqlite rows have a null prototype; compare plain objects.
  assert.deepEqual(stats.map(row => ({ ...row })), [
    {
      project_id: 1,
      project__name: 'Project',
      cancelled_work_items: 1,
      completed_work_items: 2,
      backlog_work_items: 0,
      un_started_work_items: 2,
      started_work_items: 1
    }
  ])
  await assert.rejects(getAdvanceAnalyticsStats(db, owner, 'ws', { type: 'bogus' }), status(400))

  const projects = await getAdvanceAnalyticsChart(db, owner, 'ws', {})
  assert.deepEqual(
    projects.map(item => [item.key, item.name, item.count]),
    [
      ['work_items', 'Work Items', 6],
      ['cycles', 'Cycles', 1],
      ['modules', 'Modules', 1],
      ['intake', 'Intake', 0],
      ['members', 'Members', 4],
      ['pages', 'Pages', 0],
      ['views', 'Views', 0]
    ]
  )
  const custom = await getAdvanceAnalyticsChart(db, owner, 'ws', { type: 'custom-work-items', x_axis: 'STATE_GROUPS' })
  assert.equal(custom.data.length, 4)
  const completion = await getAdvanceAnalyticsChart(db, owner, 'ws', { type: 'work-items' })
  assert.equal(completion.data.at(-1).created_issues, 6)
  assert.equal(completion.data.at(-1).completed_issues, 2)
  assert.deepEqual(completion.schema, { completed_issues: 'completed_issues', created_issues: 'created_issues' })
})

test('project advance analytics: counts, assignees, cycle and module scope', async () => {
  const { db, now } = fixture()
  const all = await getProjectAdvanceAnalytics(db, owner, 'ws', 1, {})
  assert.equal(all.total_work_items.count, 6)
  assert.equal((await getProjectAdvanceAnalytics(db, owner, 'ws', 1, { cycle_id: 1 })).total_work_items.count, 2)
  assert.equal((await getProjectAdvanceAnalytics(db, owner, 'ws', 1, { module_id: 1 })).total_work_items.count, 2)
  await assert.rejects(getProjectAdvanceAnalytics(db, guest, 'ws', 1, {}), status(403))

  const stats = await getProjectAdvanceAnalyticsStats(db, owner, 'ws', 1, {})
  const memberRow = stats.find(row => row.assignee_id === 2)
  assert.deepEqual(
    [memberRow.display_name, memberRow.completed_work_items, memberRow.un_started_work_items],
    ['member', 1, 1]
  )
  assert.equal(stats.find(row => row.assignee_id === null).cancelled_work_items, 1)
  assert.equal((await getProjectAdvanceAnalyticsStats(db, owner, 'ws', 1, { cycle_id: 1 })).length, 2)

  // A guest may read the charts.
  const monthly = await getProjectAdvanceAnalyticsChart(db, guest, 'ws', 1, { type: 'work-items' })
  assert.equal(monthly.data.at(-1).created_issues, 6)
  const cycle = await getProjectAdvanceAnalyticsChart(db, guest, 'ws', 1, { type: 'work-items', cycle_id: 1 })
  assert.equal(cycle.data.length, 3)
  const today = cycle.data.find(item => item.key === dayOf(now))
  assert.deepEqual([today.count, today.created_issues, today.completed_issues], [3, 2, 1])
  const moduleChart = await getProjectAdvanceAnalyticsChart(db, guest, 'ws', 1, { type: 'work-items', module_id: 1 })
  assert.equal(moduleChart.data.length, 3)
  const custom = await getProjectAdvanceAnalyticsChart(db, guest, 'ws', 1, {
    type: 'custom-work-items',
    x_axis: 'PRIORITY',
    cycle_id: 1
  })
  assert.deepEqual(
    custom.data.map(item => item.key),
    ['high', 'urgent']
  )
  await assert.rejects(getProjectAdvanceAnalyticsChart(db, guest, 'ws', 1, {}), status(400))
})

test('module burndown counts down to today and is null afterwards', async () => {
  const { db, now } = fixture()
  const chart = await burndownPlot(
    db,
    { projectId: 1, workspaceId: 1, moduleId: 1 },
    { startDate: dayOf(now - DAY), endDate: dayOf(now + DAY) },
    'issues',
    now
  )
  assert.deepEqual(chart, { [dayOf(now - DAY)]: 2, [dayOf(now)]: 2, [dayOf(now + DAY)]: null })
  const points = await burndownPlot(
    db,
    { projectId: 1, workspaceId: 1, moduleId: 1 },
    { startDate: dayOf(now), endDate: dayOf(now) },
    'points',
    now
  )
  assert.deepEqual(points, { [dayOf(now)]: 2 })
  const cycle = await burndownPlot(
    db,
    { projectId: 1, workspaceId: 1, cycleId: 1 },
    { startDate: now - DAY, endDate: now + DAY },
    'issues',
    now
  )
  assert.deepEqual(Object.values(cycle), [2, 1, null])
  assert.deepEqual(
    await burndownPlot(db, { projectId: 1, workspaceId: 1, moduleId: 1 }, { startDate: null, endDate: null }, 'issues'),
    {}
  )
})

test('default analytics and project stats', async () => {
  const { db } = fixture()
  const result = await getDefaultAnalytics(db, guest, 'ws', {})
  assert.equal(result.total_issues, 6)
  assert.equal(result.open_issues, 3)
  assert.deepEqual(
    result.total_issues_classified.map(item => [item.state_group, item.state_count]),
    [
      ['cancelled', 1],
      ['completed', 2],
      ['started', 1],
      ['unstarted', 2]
    ]
  )
  assert.deepEqual(
    result.issue_completed_month_wise.map(item => item.count),
    [2]
  )
  assert.deepEqual(
    result.most_issue_created_user.map(item => [item.created_by__id, item.count]),
    [[1, 6]]
  )
  assert.equal(result.most_issue_closed_user.length, 2)
  assert.equal(result.pending_issue_user[0].count, 3)
  assert.equal(result.total_estimate_sum, null)
  assert.equal((await getDefaultAnalytics(db, member, 'ws', { priority: 'high' })).total_issues, 2)

  const [stats] = await getProjectStats(db, owner, 'ws', {})
  assert.deepEqual({ ...stats }, {
    id: 1,
    total_issues: 6,
    completed_issues: 3,
    total_members: 3,
    total_cycles: 1,
    total_modules: 1
  })
  assert.deepEqual((await getProjectStats(db, guest, 'ws', { fields: 'total_issues,bogus' })).map(row => ({ ...row })), [
    { id: 1, total_issues: 6 }
  ])
  assert.deepEqual(await getProjectStats(db, owner, 'ws', { project_ids: '99' }), [])
  // A workspace member outside the project still sees it because the project is public (network 2).
  assert.equal((await getProjectStats(db, outsider, 'ws', {})).length, 1)
  assert.equal((await projectIssueMetrics(db, owner, 'ws', 1)).total, 6)
})

test('saved analytic views: CRUD derives the query and drives the saved distribution', async () => {
  const { db } = fixture()
  const view = await createAnalyticView(db, member, 'ws', {
    name: 'By priority',
    query_dict: { x_axis: 'priority', y_axis: 'issue_count', priority: ['high', 'low'] }
  })
  assert.deepEqual(view.query, { priority: ['high', 'low'] })
  assert.equal(view.workspaceId, 1)
  const saved = await getSavedAnalytic(db, owner, 'ws', view.id, {})
  assert.equal(saved.total, 3)
  assert.deepEqual(Object.keys(saved.distribution), ['low', 'high'])
  const segmented = await getSavedAnalytic(db, owner, 'ws', view.id, { segment: 'state__group' })
  assert.equal(segmented.distribution.high.length, 2)
  await assert.rejects(getSavedAnalytic(db, owner, 'ws', view.id, { segment: 'priority' }), status(400))
  await assert.rejects(getSavedAnalytic(db, owner, 'ws', 999, {}), status(404))
  await assert.rejects(getSavedAnalytic(db, guest, 'ws', view.id, {}), status(403))

  const renamed = await updateAnalyticView(db, owner, 'ws', view.id, { name: 'Renamed' })
  assert.deepEqual([renamed.name, renamed.query], ['Renamed', { priority: ['high', 'low'] }])
  const changed = await updateAnalyticView(db, owner, 'ws', view.id, {
    query_dict: { x_axis: 'state__group', y_axis: 'issue_count' }
  })
  assert.deepEqual(changed.query, {})
  const empty = await createAnalyticView(db, owner, 'ws', { name: 'No axes' })
  await assert.rejects(getSavedAnalytic(db, owner, 'ws', empty.id, {}), status(400))
  assert.equal((await listAnalyticViews(db, owner, 'ws')).length, 2)
  await deleteAnalyticView(db, owner, 'ws', view.id)
  assert.deepEqual(
    (await listAnalyticViews(db, owner, 'ws')).map(item => item.name),
    ['No axes']
  )
  await assert.rejects(deleteAnalyticView(db, owner, 'ws', view.id), status(404))
  await assert.rejects(createAnalyticView(db, guest, 'ws', { name: 'Nope' }), status(403))
})

test('export queues a job; the job writes the CSV, emails once and keeps the file private', async () => {
  const { db, env, sent, sqlite, bucketEnv, stored } = fixture()
  const body = { x_axis: 'priority', y_axis: 'issue_count' }
  await assert.rejects(exportAnalytics(db, member, 'ws', { x_axis: 'bogus', y_axis: 'issue_count' }, env), status(400))
  await assert.rejects(exportAnalytics(db, guest, 'ws', body, env), status(403))
  const response = await exportAnalytics(db, member, 'ws', body, env)
  assert.match(response.message, /m@example\.com/)
  // Every job message carries an id (the job_claims idempotency key).
  assert.deepEqual(
    sent.map(({ id, ...message }) => ({ ...message, hasId: typeof id === 'string' })),
    [{ type: 'analytics.export_plot', payload: { exportId: response.exportId }, hasId: true }]
  )

  // Without storage the CSV travels inside the email.
  const { mailbox, deps } = mails()
  await analyticExportTask(env, sent[0].payload, deps)
  assert.equal(mailbox.length, 1)
  assert.equal(mailbox[0].to, 'm@example.com')
  assert.equal(mailbox[0].subject, 'Your Export is ready')
  assert.ok(
    mailbox[0].text.includes(
      '"Priority","Issue Count"\r\n"low","1"\r\n"medium","1"\r\n"high","2"\r\n"urgent","1"\r\n"none","1"\r\n'
    )
  )
  await analyticExportTask(env, sent[0].payload, deps)
  assert.equal(mailbox.length, 1)
  assert.equal(
    sqlite.prepare('select status from analytic_exports where id = ?').get(response.exportId).status,
    'completed'
  )

  // With a bucket the file is stored and the email links to the download route.
  const second = await exportAnalytics(
    db,
    owner,
    'ws',
    { x_axis: 'state_id', y_axis: 'issue_count', segment: 'priority' },
    env
  )
  const bucket = mails()
  await analyticExportTask(bucketEnv(), { exportId: second.exportId }, bucket.deps)
  const key = `analytics-exports/1/1/${second.exportId}.csv`
  assert.ok(stored.get(key).includes('"Done","2"'))
  assert.ok(
    bucket.mailbox[0].text.includes(
      `http://localhost:4198/api/v1/workspaces/ws/export-analytics/${second.exportId}/download`
    )
  )
  assert.ok(!bucket.mailbox[0].text.includes('"Done"'))
  assert.equal((await getAnalyticExport(db, owner, 'ws', second.exportId)).objectKey, key)
  await assert.rejects(getAnalyticExport(db, member, 'ws', second.exportId), status(404))
  await assert.rejects(getAnalyticExport(db, owner, 'ws', response.exportId), status(404))

  // A bad request is recorded as failed and sends nothing.
  sqlite.exec(
    `INSERT INTO analytic_exports(workspace_id,user_id,email,params) VALUES(1,1,'o@example.com','{"x_axis":"bogus","y_axis":"issue_count"}')`
  )
  const failed = sqlite.prepare('select id from analytic_exports order by id desc').get().id
  const quiet = mails()
  await analyticExportTask(env, { exportId: failed }, quiet.deps)
  assert.equal(quiet.mailbox.length, 0)
  assert.equal(sqlite.prepare('select status from analytic_exports where id = ?').get(failed).status, 'failed')
})

test('csv email job and job registration', async () => {
  const { env, db, sqlite } = fixture()
  const { mailbox, deps } = mails()
  await exportAnalyticsToCsvEmail(
    env,
    {
      data: [{ a: 1, b: '=x' }, { a: 2 }],
      headers: ['A', 'B'],
      keys: ['a', 'b'],
      email: 'o@example.com',
      slug: 'ws',
      userId: 1,
      workspaceId: 1
    },
    deps
  )
  assert.ok(mailbox[0].text.includes('"A","B"\r\n"1","\'=x"\r\n"2",""\r\n'))
  assert.equal(sqlite.prepare('select count(*) as n from analytic_exports').get().n, 1)
  assert.equal((await listAnalyticViews(db, owner, 'ws')).length, 0)
  // The registered handler is found; an unknown export id is a no-op, so no mail module is loaded.
  register()
  await dispatchJob(env, { type: 'analytics.export_plot', payload: { exportId: 9999 } })
})
