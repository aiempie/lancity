import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { renderSql, run, validateSql } from '../scripts/plane-import/cli.ts'
import { COVERAGE } from '../scripts/plane-import/coverage.ts'
import { coerceValue, convertDump, toEpochMs } from '../scripts/plane-import/convert.ts'
import { IdMap } from '../scripts/plane-import/id-map.ts'
import { parseCsv } from '../scripts/plane-import/read-dump.ts'
import { insertStatement, sqlLiteral } from '../scripts/plane-import/sql.ts'
import { openTargetDatabase, readTargetSchema } from '../scripts/plane-import/target-schema.ts'
import * as accounts from '../scripts/plane-import/transforms-accounts.ts'
import * as content from '../scripts/plane-import/transforms-content.ts'
import * as history from '../scripts/plane-import/transforms-history.ts'
import * as props from '../scripts/plane-import/transforms-props.ts'
import { planeImportOptionsSchema } from '../src/types/database/p4-migrations-schema.ts'

const modules = { accounts, content, history, props }

function loadSchema() {
  const db = openTargetDatabase('drizzle')
  const schema = readTargetSchema(db)
  db.close()
  return schema
}

function counter(prefix) {
  let n = 0
  return () => `${prefix}${++n}`
}

function importDump(dump, sourceMigration = 125, idMap = new IdMap()) {
  const options = planeImportOptionsSchema.parse({ sourceMigration, now: 1_800_000_000_000 })
  const schema = loadSchema()
  const result = convertDump({ dump, schema, idMap, options, anchor: counter('anchor'), transaction: counter('t') })
  return { ...result, schema, idMap }
}

function loadInto(result) {
  const db = openTargetDatabase('drizzle')
  db.exec('PRAGMA foreign_keys = ON; BEGIN; PRAGMA defer_foreign_keys = on')
  for (const { statements } of renderSql(result, result.schema.order)) for (const statement of statements) db.exec(statement)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  db.exec('COMMIT')
  return db
}

test('every data migration of group 16 maps to an exported pure function', () => {
  assert.equal(COVERAGE.length, 67)
  assert.deepEqual(
    COVERAGE.map(entry => entry.pd),
    Array.from({ length: 67 }, (_, index) => `PD-${1290 + index}`)
  )
  for (const entry of COVERAGE) assert.equal(typeof modules[entry.module][entry.name], 'function', `${entry.pd} ${entry.name}`)
})

test('account and workspace rules', () => {
  assert.equal(accounts.updateCompanyOrganizationSize({ company_size: 10 }), '10')
  assert.equal(accounts.onboardingDefaultSteps({ is_onboarded: true }).is_tour_completed, true)
  assert.equal(accounts.onboardingDefaultSteps({ is_onboarded: false }), null)
  assert.equal(accounts.restructureTheming({}), null)
  const theme = accounts.restructureTheming({ accent: '#a', bgBase: '#b', sidebar: '#c', textBase: '#d' })
  assert.equal(theme.primary, '#a')
  assert.equal(theme.palette, '#b,#d,#a,#c,#d')
  assert.equal(accounts.generateDisplayName({ email: 'jo@example.com', display_name: '' }), 'jo')
  assert.equal(accounts.generateDisplayName({ email: 'jo@example.com', display_name: 'Joe' }), 'Joe')
  assert.equal(accounts.updateUserTimezone(null), 'UTC')
  assert.equal(accounts.updateUserTimezone('Asia/Ho_Chi_Minh'), 'Asia/Ho_Chi_Minh')
  assert.equal(accounts.updateUserTimezone('Nowhere/Land'), 'UTC')
  assert.equal(accounts.userPasswordAutoset({ password: 'pbkdf2_sha256$1$a$b' }).password, null)
  const logo = accounts.updateProjectLogoProps({ emoji: '128512', icon_prop: { name: 'star', color: '#fff' } })
  assert.equal(logo.in_use, 'emoji')
  assert.deepEqual(logo.icon, { name: 'star', color: '#fff' })
  assert.equal(accounts.updateProjectLogoProps({ icon_prop: null }).in_use, 'icon')
  assert.deepEqual(
    accounts.createNotificationPreferences([{ id: 'a' }, { id: 'a' }, { id: 'b', is_bot: true }]).map(row => row.user_id),
    ['a']
  )
  assert.equal(accounts.migrateUserProfile({ id: 'u', user_timezone: 'Bad' }).user_timezone, 'UTC')
  assert.equal(accounts.setDefaultProductTourToFalse().cycles, false)
  assert.equal(accounts.getDefaultProductTour().pages, true)
  assert.deepEqual(accounts.populateProductTour({ pages: false }), { pages: false })
  assert.equal(accounts.populateProductTour({}).pages, true)
  const token = accounts.migrateExistingApiTokens({ id: 't', workspace_id: 'w', is_service: false }, { is_bot: false })
  assert.equal(token.workspace_id, null)
  assert.equal(token.is_active, false)
  assert.equal(accounts.migrateExistingApiTokens({ workspace_id: 'w', is_service: true }, undefined).workspace_id, 'w')
})

test('view property rules keep customisation and are idempotent', () => {
  assert.equal(props.updateWorkspaceMemberProps(null).properties.assignee, true)
  assert.deepEqual(props.updateWorkspaceMemberProps({ key: false }).properties, { key: false })
  const old = {
    filters: { priority: ['high'], type: 'active' },
    groupByProperty: 'state',
    orderBy: '-name',
    showSubIssues: false,
    properties: { key: false }
  }
  const converted = props.workspaceMemberProps(old)
  assert.deepEqual(converted.filters.priority, ['high'])
  assert.equal(converted.display_filters.group_by, 'state')
  assert.equal(converted.display_filters.sub_issue, false)
  assert.equal(converted.display_filters.type, 'active')
  assert.equal(converted.display_properties.key, false)
  assert.equal(converted.display_properties.link, true)
  assert.deepEqual(props.workspaceMemberProps(converted), converted)
  assert.equal('display_properties' in props.projectMemberProps(old), false)
  assert.deepEqual(Object.keys(props.cycleModuleProps(old)), ['filters'])
  assert.notEqual(props.updateCycleProps({ view_props: { filter: {} } }), null)
  assert.equal(props.updateModuleProps({ view_props: { filters: {} } }), null)
  assert.equal(props.updateUserIssueProperties({ key: true }).start_date, true)
  const member = props.workspaceMemberProperties({ view_props: { properties: { key: true } }, default_props: null })
  assert.equal(member.view_props.properties.start_date, true)
  assert.equal(member.default_props.properties.start_date, true)
  assert.equal(props.updateWorkspaceProjectMemberRole(10), 5)
  assert.equal(props.updateWorkspaceProjectMemberRole(20), 20)
  assert.equal(props.updateIssuePriorityChoice(null), 'none')
  assert.equal(props.updateIssuePriorityChoice('high'), 'high')
})

test('sort order is kept when present and repeatable when missing', () => {
  const rows = [{ id: 'b' }, { id: 'a', sort_order: 5 }, { id: 'c' }]
  assert.deepEqual(
    props.backfillSortOrder(rows).map(row => row.sort_order),
    [100, 5, 200]
  )
  assert.deepEqual(props.randomCycleOrder(rows), props.backfillSortOrder(rows))
})

test('personal property rows are derived from memberships', () => {
  const row = props.workspaceUserProperties({
    member_id: 'u',
    workspace_id: 'w',
    view_props: { display_filters: { layout: 'list' }, display_properties: { key: true } }
  })
  assert.deepEqual(row.display_filters, { layout: 'list' })
  assert.equal(props.workspaceUserProperties({ workspace_id: 'w' }), null)
  assert.equal(props.projectUserProperties({ id: 'p' }, undefined), null)
  assert.deepEqual(props.projectUserProperties({ id: 'p' }, { view_props: { filters: { a: 1 } } }).filters, { a: 1 })
  const moved = props.moveIssueUserPropertiesToProjectUserProperties(
    [
      { id: 1, user_id: 'u', project_id: 'p', sort_order: 1 },
      { id: 2, user_id: 'x', project_id: 'p', sort_order: 1 }
    ],
    [{ member_id: 'u', project_id: 'p', preferences: { pin: true }, sort_order: 7 }]
  )
  assert.deepEqual([moved[0].preferences, moved[0].sort_order, moved[1].sort_order], [{ pin: true }, 7, 1])
})

test('activity history rules', () => {
  const users = history.userLookupByEmail([{ id: 'u1', email: 'Ann@Example.com', display_name: 'ann' }])
  const assigned = history.normalizeActivity(
    { field: 'assignee', old_value: null, new_value: 'ann@example.com', comment: 'updated the assignee to ann@example.com' },
    users
  )
  assert.equal(assigned.field, 'assignees')
  assert.equal(assigned.new_value, 'ann')
  assert.equal(assigned.new_identifier, 'u1')
  assert.equal(assigned.comment, 'updated the assignee to ann')
  const removed = history.updateAssigneeIssueActivity(
    { field: 'assignees', old_value: 'ann@example.com', new_value: '', comment: 'removed the assignee ann@example.com' },
    users
  )
  assert.equal(removed.old_identifier, 'u1')
  assert.equal(history.updateNameActivity({ field: 'name', comment: 'updated the start date' }).comment, 'updated the name')
  assert.equal(history.updateNameActivity({ field: 'state', comment: 'start date' }).comment, 'start date')
  const priority = history.updateIssueActivityPriority({ field: 'priority', old_value: null, new_value: '' })
  assert.deepEqual([priority.old_value, priority.new_value], ['none', 'none'])
  assert.equal(history.updateIssueActivityBlocked({ field: 'blocks' }).field, 'blocked_by')
  assert.equal(history.rectifyFieldIssueActivity({ field: 'assignee' }).field, 'assignees')
  assert.deepEqual(history.createIssueRelation({ block_id: 'a', blocked_by_id: 'b', project_id: 'p', workspace_id: 'w' }).relation_type, 'blocked_by')
  const relation = history.createIssueRelation({ block_id: 'a', blocked_by_id: 'b', project_id: 'p', workspace_id: 'w' })
  assert.deepEqual([relation.issue_id, relation.related_issue_id], ['a', 'b'])
})

test('estimate, state and intake rules', () => {
  const remap = history.issueEstimatePoint(
    [{ id: 'p', estimate_id: 'e' }],
    [
      { id: 'ep3', key: 3, value: 'Three', estimate_id: 'e', project_id: 'p' },
      { id: 'ep5', key: 5, value: 'Five', estimate_id: 'e', project_id: 'p' }
    ],
    [
      { id: 'i1', project_id: 'p', point: 3 },
      { id: 'i2', project_id: 'p', point: 9 },
      { id: 'i3', project_id: 'p', point: null }
    ],
    [{ id: 'a1', project_id: 'p', field: 'estimate_point', old_value: '3', new_value: '5' }]
  )
  assert.deepEqual(remap.issues, [{ id: 'i1', estimate_point_id: 'ep3' }])
  assert.equal(remap.unmatched.length, 1)
  assert.deepEqual(
    [remap.activities[0].old_identifier, remap.activities[0].new_value, remap.activities[0].new_identifier],
    ['ep3', 'Five', 'ep5']
  )
  const estimates = history.lastUsedEstimate([{ id: 'e' }, { id: 'f' }], [{ estimate_id: 'e' }, { estimate_id: null }])
  assert.deepEqual(
    estimates.map(row => row.last_used),
    [true, undefined]
  )
  assert.equal(history.updateProjectStateGroup({ group: 'backlog', name: 'Triage' }).group, 'triage')
  assert.equal(history.updateProjectStateGroup({ group: 'started', name: 'Triage' }).group, 'started')
  assert.equal(history.setDefaultSourceType({ source: 'In-App' }).source, 'IN_APP')
  assert.equal(history.setDefaultSourceType({ source: 'EXTERNAL' }).source, 'EXTERNAL')

  const triage = history.createTriageState(
    [
      { id: 'abcdefgh', workspace_id: 'w' },
      { id: 'klmnopqr', workspace_id: 'w' },
      { id: 'stuvwxyz', workspace_id: 'w' }
    ],
    [
      { id: 's1', project_id: 'abcdefgh', group: 'triage', name: 'old', sequence: 1 },
      { id: 's2', project_id: 'klmnopqr', group: 'backlog', name: 'Triage' }
    ],
    [
      { issue_id: 'i1', status: -2 },
      { issue_id: 'i2', status: 1 },
      { issue_id: 'i3', status: 0 }
    ],
    [
      { id: 'i1', project_id: 'abcdefgh' },
      { id: 'i2', project_id: 'abcdefgh' },
      { id: 'i3', project_id: 'stuvwxyz' }
    ]
  )
  assert.deepEqual([triage.states[0].name, triage.states[0].sequence, triage.states[0].color], ['Triage', 65000, '#4E5355'])
  assert.deepEqual(
    triage.created.map(state => state.name),
    ['Triage-klmno', 'Triage']
  )
  assert.deepEqual(triage.issueStates[0], { issue_id: 'i1', state_ref: 's1' })
  assert.deepEqual(triage.issueStates[1].state_ref, { created: true, project_id: 'stuvwxyz' })
  assert.equal(triage.issueStates.length, 2)
})

test('page rules', () => {
  const pages = [
    { id: 1, name: 'Zebra' },
    { id: 2, name: 'Alpha' },
    { id: 3, name: 'Alpha' }
  ]
  assert.deepEqual(
    content.setPageSortOrder(pages).map(page => page.sort_order),
    [300, 100, 200]
  )
  assert.deepEqual(
    content.reverseSetPageSortOrder(pages).map(page => page.sort_order),
    [65535, 65535, 65535]
  )
  const merged = content.updatePages(
    { id: 'pg', description_html: '<p>x</p>', workspace_id: 'w' },
    [
      { page_id: 'pg', name: 'Notes', description_html: '<p>n</p>', sort_order: 2 },
      { page_id: 'pg', name: 'Fix "it"', issue_id: 'i1', sort_order: 1 },
      { page_id: 'other', name: 'Ignored', sort_order: 0 }
    ],
    { projectIdentifier: 'FIRST', issueSequence: () => 4, issueRef: () => 77, transaction: () => 'tx' }
  )
  assert.equal(
    merged.description_html,
    '<p>x</p><issue-embed-component id="tx" entity_name="issue" entity_identifier="77" sequence_id="4" project_identifier="FIRST" title="Fix &quot;it&quot;"></issue-embed-component><h2>Notes</h2><p>n</p>'
  )
  assert.deepEqual([merged.page_logs.length, merged.page_logs[0].entity_name, merged.page_logs[0].transaction], [1, 'issue', 'tx'])
  assert.equal(content.updatePages({ id: 'empty' }, [], {}), null)
  assert.equal(content.migratePages({ id: 'p1', project_id: 'pr', workspace_id: 'w' }).page_id, 'p1')
  assert.equal(content.migratePages({ id: 'p2' }), null)
})

test('view, favorite, dashboard and draft rules', () => {
  const view = content.issueView({ name: 'All', workspace_id: 'w', created_by_id: 'u', query_data: { filters: { a: 1 } }, sort_order: 3 })
  assert.deepEqual([view.project_id, view.filters, view.owned_by_id], [null, { a: 1 }, 'u'])
  assert.equal(content.populateViewsOwnedBy({ created_by_id: 'u' }).owned_by_id, 'u')
  assert.equal(content.populateViewsOwnedBy({ owned_by_id: 'o', created_by_id: 'u' }).owned_by_id, 'o')
  const favorites = content.userFavoriteMigration({
    CycleFavorite: [{ user_id: 'u', cycle_id: 'c', workspace_id: 'w' }],
    IssueViewFavorite: [{ user_id: 'u', view_id: 'v', workspace_id: 'w' }],
    PageFavorite: [{ user_id: 'u', workspace_id: 'w' }]
  })
  assert.deepEqual(
    favorites.map(row => [row.entity_type, row.entity_identifier]),
    [
      ['cycle', 'c'],
      ['view', 'v']
    ]
  )
  assert.equal(content.createWidgets().length, 8)
  assert.equal(content.createDashboards(['a', 'b']).length, 2)
  assert.equal(content.createDashboardWidgets([1, 2], ['a', 'b', 'c']).length, 6)
  const widgets = content.widgetsFilterChange(content.createWidgets())
  assert.deepEqual(widgets.find(widget => widget.key === 'assigned_issues').filters, { duration: 'none', tab: 'pending' })
  assert.deepEqual(widgets.find(widget => widget.key === 'recent_activity').filters, {})
  const board = content.populateDeployBoard({ project_id: 'p', workspace_id: 'w', comments: true, views: { a: 1 } }, 'anchor')
  assert.deepEqual([board.entity_identifier, board.entity_name, board.anchor, board.is_comments_enabled], ['p', 'project', 'anchor', true])

  const drafts = content.migrateDraftIssues(
    [
      { id: 'd1', is_draft: true, name: 'Draft', workspace_id: 'w', project_id: 'p' },
      { id: 'i1', is_draft: false, name: 'Real', workspace_id: 'w', project_id: 'p' }
    ],
    [
      { issue_id: 'd1', assignee_id: 'u' },
      { issue_id: 'd1', assignee_id: 'gone', deleted_at: 1 },
      { issue_id: 'i1', assignee_id: 'u' }
    ],
    [{ issue_id: 'd1', label_id: 'l' }],
    [{ issue_id: 'd1', module_id: 'm' }],
    [{ issue_id: 'd1', cycle_id: 'c' }]
  )
  assert.deepEqual(
    [drafts.draftIssues.length, drafts.assignees.length, drafts.labels.length, drafts.modules.length, drafts.cycles.length],
    [1, 1, 1, 1, 1]
  )
  assert.equal(drafts.assignees[0].draft_issue_id, 'd1')
})

test('attachments become file assets and upload flags need a verified object', () => {
  const asset = content.moveAttachmentToFileasset({ issue_id: 'i', project_id: 'p', workspace_id: 'w', asset: 'a/b.png', attributes: { size: 12, name: 'b.png' } })
  assert.deepEqual([asset.entity_type, asset.size, asset.is_uploaded], ['ISSUE_ATTACHMENT', 12, false])
  assert.equal(content.moveAttachmentToFileasset({ asset: 'x', attributes: {} }).size, 0)
  assert.equal(content.markExistingFileUploads(asset, true).is_uploaded, true)
})

test('rich filters are filled only when empty and can be cleared', () => {
  const converter = { convert: filters => ({ converted: Object.keys(filters) }) }
  assert.deepEqual(content.migrateFiltersToRichFilters({ filters: { state: ['s'] }, rich_filters: {} }, converter).row.rich_filters, { converted: ['state'] })
  assert.deepEqual(content.migrateFiltersToRichFilters({ filters: {}, rich_filters: {} }, converter).row.rich_filters, {})
  const kept = { filters: { state: ['s'] }, rich_filters: { x: 1 } }
  assert.equal(content.migrateFiltersToRichFilters(kept, converter).row, kept)
  const failing = content.migrateFiltersToRichFilters({ filters: { a: 1 }, rich_filters: {} }, {
    convert() {
      throw new Error('bad filter')
    }
  })
  assert.equal(failing.error, 'bad filter')
  assert.deepEqual(content.reverseMigrateRichFiltersToFilters({ rich_filters: { a: 1 } }).rich_filters, {})
})

test('deploy board identity repair matches the Plane rules', () => {
  const boards = [
    { id: 1, entity_name: 'project', entity_identifier: 1, project_id: 1, deleted_at: null, created_at: 1 },
    { id: 2, entity_name: 'project', entity_identifier: 19, project_id: 1, deleted_at: null, created_at: 2 },
    { id: 3, entity_name: 'project', entity_identifier: 23, project_id: 2, deleted_at: null, created_at: 3 },
    { id: 4, entity_name: 'project', entity_identifier: 23, project_id: 1, deleted_at: 10, created_at: 4 }
  ]
  const repaired = content.resetProjectDeployBoardIdentity(boards, 20)
  assert.deepEqual(
    repaired.map(board => [board.entity_identifier, board.deleted_at]),
    [
      [1, null],
      [null, 20],
      [2, null],
      [1, 10]
    ]
  )
  assert.equal(boards[1].deleted_at, null)
})

test('ID map is stable, per table and restorable', () => {
  const map = new IdMap()
  assert.deepEqual([map.allocate('issues', 'A-1'), map.allocate('issues', 'b-2'), map.allocate('issues', 'a-1')], [1, 2, 1])
  assert.equal(map.allocate('states', 'A-1'), 1)
  assert.equal(map.create('states'), 2)
  const restored = new IdMap(map.snapshot())
  assert.equal(restored.get('issues', 'B-2'), 2)
  assert.equal(restored.allocate('issues', 'c-3'), 3)
  restored.setStart('labels', 50)
  assert.equal(restored.allocate('labels', 'x'), 50)
  assert.equal(restored.get('labels', 'missing'), undefined)
})

test('CSV, timestamp and SQL helpers', () => {
  const rows = parseCsv('id,name,note,flag\r\n1,"Smith, ""Al""",,t\n2,"",line,f\n3,"two\nlines",x,\n')
  assert.deepEqual(rows[0], { id: '1', name: 'Smith, "Al"', note: null, flag: 't' })
  assert.deepEqual([rows[1].name, rows[2].name, rows[2].flag], ['', 'two\nlines', null])
  assert.equal(toEpochMs('2024-01-02 03:04:05.123456+00'), Date.UTC(2024, 0, 2, 3, 4, 5, 123))
  assert.equal(toEpochMs('2024-01-02'), Date.UTC(2024, 0, 2))
  assert.equal(toEpochMs('2024-01-02T03:04:05+07:00'), Date.UTC(2024, 0, 1, 20, 4, 5))
  assert.equal(toEpochMs('hello'), null)
  const column = type => ({ name: 'c', type, notNull: false, hasDefault: false, primaryKey: false })
  assert.equal(coerceValue('t', column('INTEGER')), 1)
  assert.equal(coerceValue(false, column('INTEGER')), 0)
  assert.equal(coerceValue('12', column('INTEGER')), 12)
  assert.throws(() => coerceValue('abc', column('INTEGER')))
  assert.equal(coerceValue({ a: 1 }, column('TEXT(255)')), '{"a":1}')
  assert.deepEqual([...coerceValue('\\x0aff', column('BLOB'))], [10, 255])
  assert.equal(sqlLiteral("O'Brien"), "'O''Brien'")
  assert.equal(sqlLiteral(null), 'NULL')
  assert.equal(insertStatement('t', { id: 1, a: 'x', b: null, group: true }), `INSERT INTO "t" ("id", "a", "b", "group") VALUES (1, 'x', NULL, 1);`)
  assert.throws(() => sqlLiteral(Number.NaN))
})

const baseDump = () => ({
  users: [
    { id: 'u-1', email: 'ann@example.com', first_name: 'Ann', last_name: 'Lee', display_name: 'ann', is_email_verified: true, date_joined: '2024-01-02 03:04:05.123456+00' },
    { id: 'u-2', email: 'BOB@Example.com', first_name: '', last_name: '', display_name: '', is_email_verified: false, date_joined: '2024-02-01 00:00:00+00' },
    { id: 'u-3', email: 'bob@example.com', date_joined: '2024-02-02 00:00:00+00' }
  ],
  workspaces: [{ id: 'w-1', name: 'WS', slug: 'ws', owner_id: 'u-1', company_size: 10, created_at: '2024-01-02 03:04:05+00' }],
  workspace_members: [
    { id: 'wm-1', workspace_id: 'w-1', member_id: 'u-1', role: 20 },
    { id: 'wm-2', workspace_id: 'w-1', member_id: 'u-2', role: 10 }
  ],
  projects: [{ id: 'p-1', name: 'First', identifier: 'FIRST', workspace_id: 'w-1' }],
  project_members: [{ id: 'pm-1', project_id: 'p-1', workspace_id: 'w-1', member_id: 'u-1', role: 20 }],
  states: [{ id: 's-1', name: 'Backlog', color: '#000', group: 'backlog', project_id: 'p-1', workspace_id: 'w-1' }],
  issues: [
    { id: 'i-1', name: 'One', sequence_id: 1, project_id: 'p-1', workspace_id: 'w-1', state_id: 's-1', priority: null, created_by_id: 'u-1' },
    { id: 'i-2', name: 'Two', sequence_id: 2, project_id: 'p-1', workspace_id: 'w-1', parent_id: 'i-1', priority: 'high' },
    { id: 'i-3', name: 'Draft', sequence_id: 3, project_id: 'p-1', workspace_id: 'w-1', is_draft: true }
  ],
  issue_assignees: [
    { id: 'ia-1', issue_id: 'i-1', assignee_id: 'u-1', project_id: 'p-1', workspace_id: 'w-1' },
    { id: 'ia-2', issue_id: 'i-3', assignee_id: 'u-1', project_id: 'p-1', workspace_id: 'w-1' }
  ],
  issue_blockers: [{ id: 'b-1', block_id: 'i-2', blocked_by_id: 'i-1', project_id: 'p-1', workspace_id: 'w-1' }],
  issue_activities: [
    {
      id: 'a-1',
      issue_id: 'i-1',
      project_id: 'p-1',
      workspace_id: 'w-1',
      actor_id: 'u-1',
      verb: 'updated',
      field: 'assignee',
      old_value: null,
      new_value: 'ann@example.com',
      comment: 'updated the assignee to ann@example.com',
      epoch: 1700000000.5
    },
    { id: 'a-2', issue_id: 'i-1', project_id: 'p-1', workspace_id: 'w-1', verb: 'updated', field: 'blocks', epoch: 1700000001 }
  ],
  pages: [
    { id: 'pg-1', name: 'Zeta', owned_by_id: 'u-1', workspace_id: 'w-1', project_id: 'p-1', description_html: '<p>a</p>' },
    { id: 'pg-2', name: 'Alpha', owned_by_id: 'u-1', workspace_id: 'w-1' }
  ]
})

test('a Plane dump becomes consistent D1 rows with auto-increment IDs', () => {
  const result = importDump(baseDump())
  // u-3 has no e-mail and is skipped on purpose, so only the profile rows derived from that user are dropped.
  assert.deepEqual(
    Object.entries(result.report.tables)
      .filter(([, table]) => table.dropped)
      .map(([name, table]) => [name, table.dropped]),
    [
      ['profiles', 1],
      ['user_notification_preferences', 1]
    ]
  )
  const db = loadInto(result)
  try {
    const plain = rows => rows.map(row => ({ ...row }))
    const scalar = (sql, ...args) => Object.values(db.prepare(sql).get(...args))[0]
    assert.deepEqual(
      plain(db.prepare('SELECT id, email, email_verified, created_at FROM user ORDER BY id').all()),
      [
        { id: 1, email: 'ann@example.com', email_verified: 1, created_at: Date.UTC(2024, 0, 2, 3, 4, 5, 123) },
        { id: 2, email: 'bob@example.com', email_verified: 0, created_at: Date.UTC(2024, 1, 1) }
      ]
    )
    assert.ok(result.report.warnings.some(message => message.includes('u-3')))
    assert.equal(scalar("SELECT COUNT(*) FROM account WHERE provider_id = 'credential' AND password IS NULL"), 2)
    assert.equal(scalar("SELECT account_id FROM account WHERE user_id = 1 AND provider_id = 'credential'"), '1')
    assert.equal(scalar('SELECT user_timezone FROM profiles WHERE user_id = 1'), 'UTC')
    assert.equal(scalar('SELECT organization_size FROM workspaces'), '10')
    assert.deepEqual(
      db
        .prepare('SELECT role FROM workspace_members ORDER BY id')
        .all()
        .map(row => row.role),
      [20, 5]
    )
    assert.equal(scalar('SELECT sort_order FROM project_members'), 100)
    assert.deepEqual(
      db
        .prepare('SELECT id, priority, parent_id FROM issues ORDER BY id')
        .all()
        .map(row => [row.id, row.priority, row.parent_id]),
      [
        [1, 'none', null],
        [2, 'high', 1]
      ]
    )
    assert.equal(scalar('SELECT COUNT(*) FROM draft_issues'), 1)
    assert.equal(scalar('SELECT COUNT(*) FROM issue_assignees'), 1)
    assert.deepEqual(plain(db.prepare('SELECT issue_id, related_issue_id, relation_type FROM issue_relations').all()), [
      { issue_id: 2, related_issue_id: 1, relation_type: 'blocked_by' }
    ])
    assert.equal(scalar('SELECT last_sequence FROM project_issue_counters'), 2)
    const [assigned, blocked] = plain(db.prepare('SELECT field, new_value, new_identifier, comment, epoch FROM issue_activities ORDER BY id').all())
    assert.deepEqual(assigned, {
      field: 'assignees',
      new_value: 'ann',
      new_identifier: 1,
      comment: 'updated the assignee to ann',
      epoch: 1700000000.5
    })
    assert.equal(blocked.field, 'blocked_by')
    assert.equal(scalar('SELECT COUNT(*) FROM project_pages'), 1)
    assert.equal(scalar('SELECT COUNT(*) FROM workspace_user_properties'), 2)
    assert.equal(JSON.parse(scalar('SELECT product_tour FROM profiles WHERE user_id = 1')).pages, true)

    // A second run with the saved map reuses every ID and allocates new ones after the last.
    const again = importDump(baseDump(), 125, new IdMap(result.idMap.snapshot()))
    assert.deepEqual(renderSql(again, again.schema.order), renderSql(result, result.schema.order))
  } finally {
    db.close()
  }
})

test('an old Plane dump (migration 48) gets the historical rules before it is written', () => {
  const dump = {
    users: [{ id: 'u-1', email: 'ann@example.com', display_name: 'ann', is_email_verified: true, date_joined: '2024-01-02 00:00:00+00' }],
    workspaces: [{ id: 'w-1', name: 'WS', slug: 'ws', owner_id: 'u-1', company_size: 25 }],
    projects: [{ id: 'p-1', name: 'First', identifier: 'FIRST', workspace_id: 'w-1', estimate_id: 'e-1', emoji: null }],
    states: [
      { id: 's-1', name: 'Triage', color: '#111', group: 'backlog', project_id: 'p-1', workspace_id: 'w-1' },
      { id: 's-2', name: 'Todo', color: '#222', group: 'unstarted', project_id: 'p-1', workspace_id: 'w-1' }
    ],
    estimates: [{ id: 'e-1', name: 'Points', project_id: 'p-1', workspace_id: 'w-1' }],
    estimate_points: [{ id: 'ep-1', key: 3, value: '3', estimate_id: 'e-1', project_id: 'p-1', workspace_id: 'w-1' }],
    issues: [{ id: 'i-1', name: 'One', sequence_id: 1, project_id: 'p-1', workspace_id: 'w-1', state_id: 's-2', point: 3 }],
    intakes: [{ id: 'in-1', name: 'Inbox', project_id: 'p-1', workspace_id: 'w-1' }],
    intake_issues: [{ id: 'ii-1', issue_id: 'i-1', status: -2, source: 'in-app', intake_id: 'in-1', project_id: 'p-1', workspace_id: 'w-1' }],
    pages: [
      { id: 'pg-1', name: 'B', project_id: 'p-1', owned_by_id: 'u-1', workspace_id: 'w-1', description_html: '<p>x</p>' },
      { id: 'pg-2', name: 'A', project_id: 'p-1', owned_by_id: 'u-1', workspace_id: 'w-1', description_html: '<p>y</p>' }
    ],
    page_blocks: [
      { id: 'pb-1', page_id: 'pg-1', issue_id: 'i-1', name: 'Fix "it"', sort_order: 1 },
      { id: 'pb-2', page_id: 'pg-1', name: 'Notes', description_html: '<p>n</p>', sort_order: 2 }
    ]
  }
  const result = importDump(dump, 48)
  assert.deepEqual(
    Object.values(result.report.tables).filter(table => table.dropped),
    []
  )
  const db = loadInto(result)
  try {
    const row = sql => ({ ...db.prepare(sql).get() })
    assert.equal(row('SELECT organization_size AS v FROM workspaces').v, '25')
    assert.deepEqual(row("SELECT \"group\" AS g, is_triage AS t, color AS c, sequence AS s FROM states WHERE name = 'Triage'"), {
      g: 'triage',
      t: 1,
      c: '#4E5355',
      s: 65000
    })
    assert.equal(row('SELECT COUNT(*) AS v FROM states').v, 2)
    assert.equal(row('SELECT state_id AS v FROM issues').v, row("SELECT id AS v FROM states WHERE name = 'Triage'").v)
    assert.equal(row('SELECT estimate_point_id AS v FROM issues').v, 1)
    assert.equal(row('SELECT last_used AS v FROM estimates').v, 1)
    assert.equal(row('SELECT source AS v FROM intake_issues').v, 'IN_APP')
    assert.equal(
      row("SELECT description_html AS v FROM pages WHERE name = 'B'").v,
      '<p>x</p><issue-embed-component id="t1" entity_name="issue" entity_identifier="1" sequence_id="1" project_identifier="FIRST" title="Fix &quot;it&quot;"></issue-embed-component><h2>Notes</h2><p>n</p>'
    )
    assert.deepEqual(row('SELECT entity_name AS n, entity_identifier AS i, \"transaction\" AS t FROM page_logs'), { n: 'issue', i: 1, t: 't1' })
    assert.deepEqual(
      db
        .prepare('SELECT name, sort_order FROM pages ORDER BY id')
        .all()
        .map(page => [page.name, page.sort_order]),
      [
        ['B', 200],
        ['A', 100]
      ]
    )
    assert.equal(JSON.parse(row('SELECT logo_props AS v FROM projects').v).in_use, 'icon')
    assert.equal(row('SELECT is_navigation_tour_completed AS v FROM profiles').v, 1)
  } finally {
    db.close()
  }
})

test('rows that cannot be linked are dropped with a warning instead of breaking the import', () => {
  const dump = baseDump()
  dump.issues.push({ id: 'i-9', name: 'Orphan', sequence_id: 9, project_id: 'missing-project', workspace_id: 'w-1' })
  const result = importDump(dump)
  assert.equal(result.report.tables.issues.dropped, 1)
  assert.ok(result.report.warnings.some(message => message.includes('i-9')))
  assert.equal(result.idMap.has('issues', 'i-9'), true)
  assert.equal(result.rows.get('issues').length, 2)
})

test('API tokens are skipped unless requested, and then imported inactive without a workspace', () => {
  const dump = baseDump()
  dump.api_tokens = [{ id: 'tk-1', label: 'CLI', token: 'plane_api_x', user_id: 'u-1', workspace_id: 'w-1', is_service: false, is_active: true }]
  const skipped = importDump(dump)
  assert.equal(skipped.rows.has('api_tokens'), false)
  assert.ok(skipped.report.skippedTables.some(entry => entry.table === 'api_tokens'))
  const options = planeImportOptionsSchema.parse({ includeApiTokens: true, now: 1_800_000_000_000 })
  const included = convertDump({ dump, schema: loadSchema(), idMap: new IdMap(), options })
  assert.deepEqual([included.rows.get('api_tokens')[0].workspace_id, included.rows.get('api_tokens')[0].is_active], [null, 0])
})

test('file assets stay not uploaded until the object is verified, and every asset is listed for copying', () => {
  const dump = baseDump()
  dump.issue_attachments = [
    { id: 'at-1', issue_id: 'i-1', project_id: 'p-1', workspace_id: 'w-1', asset: 'a/one.png', attributes: { size: 5 } },
    { id: 'at-2', issue_id: 'i-1', project_id: 'p-1', workspace_id: 'w-1', asset: 'a/two.png', attributes: {} }
  ]
  const schema = loadSchema()
  const options = planeImportOptionsSchema.parse({ uploadedKeys: ['a/one.png'], now: 1_800_000_000_000 })
  const result = convertDump({ dump, schema, idMap: new IdMap(), options })
  assert.deepEqual(
    result.rows.get('file_assets').map(row => [row.asset, row.is_uploaded, row.size]),
    [
      ['a/one.png', 1, 5],
      ['a/two.png', 0, 0]
    ]
  )
  assert.deepEqual(
    result.report.assetCopies.map(copy => copy.key),
    ['a/two.png']
  )
})

test('legacy favorites, global views and deploy boards are folded into the new tables', () => {
  const dump = baseDump()
  dump.cycle_favorites = []
  dump.project_favorites = [{ id: 'f-1', user_id: 'u-1', project_id: 'p-1', workspace_id: 'w-1' }]
  dump.global_views = [{ id: 'gv-1', name: 'Mine', workspace_id: 'w-1', created_by_id: 'u-1', query: { a: 1 }, query_data: { filters: { b: 2 } } }]
  dump.project_deploy_boards = [{ id: 'db-1', project_id: 'p-1', workspace_id: 'w-1', anchor: 'legacy-anchor', comments: true }]
  const db = loadInto(importDump(dump, 50))
  try {
    const all = sql => db.prepare(sql).all().map(row => ({ ...row }))
    assert.deepEqual(all('SELECT entity_type, entity_identifier, user_id FROM user_favorites'), [
      { entity_type: 'project', entity_identifier: 1, user_id: 1 }
    ])
    assert.deepEqual(all('SELECT project_id, owned_by_id, filters FROM issue_views'), [{ project_id: null, owned_by_id: 1, filters: '{"b":2}' }])
    assert.deepEqual(all('SELECT entity_name, entity_identifier, project_id, is_comments_enabled FROM deploy_boards'), [
      { entity_name: 'project', entity_identifier: 1, project_id: 1, is_comments_enabled: 1 }
    ])
  } finally {
    db.close()
  }
})

test('the command line writes SQL per table, the ID map and a report, and validates against the schema', async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-import-'))
  const dumpDir = join(root, 'dump')
  mkdirSync(dumpDir)
  const dump = baseDump()
  const { users, ...rest } = dump
  void users
  for (const [table, rows] of Object.entries(rest)) writeFileSync(join(dumpDir, `${table}.json`), JSON.stringify(rows))
  writeFileSync(
    join(dumpDir, 'users.csv'),
    'id,email,first_name,last_name,display_name,is_email_verified,date_joined,is_bot\n' +
      'u-1,ann@example.com,Ann,Lee,ann,t,2024-01-02 03:04:05+00,f\n' +
      'u-2,bob@example.com,,,,f,2024-02-01 00:00:00+00,f\n'
  )
  const out = join(root, 'out')
  const { report, problems } = await run(['--dump', dumpDir, '--out', out, '--validate'])
  assert.deepEqual(problems, [])
  const files = readdirSync(out)
  assert.ok(files.includes('id-map.json') && files.includes('report.json') && files.includes('asset-copies.json'))
  assert.ok(files.some(name => /^\d{3}-user\.sql$/.test(name)))
  assert.equal(report.tables.user.written, 2)
  const idMap = JSON.parse(readFileSync(join(out, 'id-map.json'), 'utf8'))
  assert.deepEqual(idMap.tables.user.ids, { 'u-1': 1, 'u-2': 2 })
  const first = files.find(name => name.endsWith('-user.sql'))
  assert.match(readFileSync(join(out, first), 'utf8'), /^PRAGMA defer_foreign_keys = on;\nINSERT INTO "user"/)
  await assert.rejects(run(['--dump', dumpDir]), /Usage/)
  await assert.rejects(run(['--bogus']), /Unknown or incomplete/)
})

test('validation reports statements the schema rejects', () => {
  const bad = ['INSERT INTO "workspaces" ("id", "name", "slug", "owner_id") VALUES (1, \'W\', \'w\', 99);']
  assert.match(validateSql('drizzle', bad).join('\n'), /foreign key/)
})
