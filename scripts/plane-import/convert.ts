// Plane (Postgres rows) to Lancity D1 rows. All rules come from the Django data migrations in ./transforms-*.ts.
import { randomUUID } from 'node:crypto'
import type { PlaneDump, PlaneImportOptions, PlaneImportReport } from '../../src/types/database/p4-migrations-schema'
import type { IdMap } from './id-map'
import type { SqlValue } from './sql'
import type { ColumnInfo, TargetSchema } from './target-schema'
import {
  type Row,
  createNotificationPreferences,
  generateDisplayName,
  migrateAllTheProductTourToTrue,
  migrateExistingApiTokens,
  migrateUserProfile,
  onboardingDefaultSteps,
  populateProductTour,
  restructureTheming,
  updateCompanyOrganizationSize,
  updateProjectLogoProps,
  updateUserTimezone
} from './transforms-accounts'
import {
  type FilterConverter,
  createWidgets,
  createDashboards,
  createDashboardWidgets,
  widgetsFilterChange,
  FAVORITE_ENTITY_TYPES,
  issueView,
  markExistingFileUploads,
  migrateDraftIssues,
  migrateFiltersToRichFilters,
  migratePages,
  moveAttachmentToFileasset,
  populateDeployBoard,
  populateViewsOwnedBy,
  resetProjectDeployBoardIdentity,
  setPageSortOrder,
  updatePages,
  userFavoriteMigration
} from './transforms-content'
import {
  type PlaneUserRef,
  createIssueRelation,
  createTriageState,
  issueEstimatePoint,
  lastUsedEstimate,
  normalizeActivity,
  setDefaultSourceType,
  stateSlug,
  updateProjectStateGroup,
  userLookupByEmail
} from './transforms-history'
import {
  backfillSortOrder,
  moveIssueUserPropertiesToProjectUserProperties,
  projectUserProperties,
  updateCycleProps,
  updateIssuePriorityChoice,
  updateModuleProps,
  updateProjectMemberViewProps,
  updateUserIssueProperties,
  updateWorkspaceMemberProps,
  updateWorkspaceMemberViewProps,
  updateWorkspaceProjectMemberRole,
  workspaceMemberProperties,
  workspaceUserProperties
} from './transforms-props'

export type OutRow = Record<string, SqlValue>
export type ConvertInput = {
  dump: PlaneDump
  schema: TargetSchema
  idMap: IdMap
  options: PlaneImportOptions
  /** `LegacyToRichFiltersConverter` from src/server/common/filters.ts. Without it `rich_filters` stay empty. */
  converter?: FilterConverter | null
  anchor?: () => string
  transaction?: () => string
}
export type ConvertResult = { rows: Map<string, OutRow[]>; report: PlaneImportReport }

const ENTITY_TABLES: Record<string, string> = {
  issue: 'issues',
  epic: 'issues',
  project: 'projects',
  cycle: 'cycles',
  module: 'modules',
  page: 'pages',
  view: 'issue_views',
  issue_view: 'issue_views',
  workspace: 'workspaces',
  user: 'user'
}

const ACTIVITY_IDENTIFIER_TABLES: Record<string, string> = {
  assignees: 'user',
  mentions: 'user',
  state: 'states',
  labels: 'labels',
  cycles: 'cycles',
  modules: 'modules',
  parent: 'issues',
  blocked_by: 'issues',
  blocking: 'issues',
  relates_to: 'issues',
  duplicate: 'issues',
  estimate_point: 'estimate_points',
  type: 'issue_types'
}

const LEGACY_FAVORITE_FILES: Record<keyof typeof FAVORITE_ENTITY_TYPES, string[]> = {
  CycleFavorite: ['cycle_favorites'],
  ModuleFavorite: ['module_favorites'],
  ProjectFavorite: ['project_favorites'],
  PageFavorite: ['page_favorites'],
  IssueViewFavorite: ['issue_view_favorites', 'view_favorites']
}

const DATETIME = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}(:?\d{2})?|Z)?)?$/

/** Postgres timestamp or date text to epoch milliseconds. Values without a zone are UTC. */
export function toEpochMs(value: string): number | null {
  const text = value.trim()
  if (!DATETIME.test(text)) return null
  let iso = text.replace(' ', 'T')
  if (!iso.includes('T')) iso += 'T00:00:00Z'
  else if (!/(Z|[+-]\d{2}(:?\d{2})?)$/.test(iso)) iso += 'Z'
  else if (/[+-]\d{2}$/.test(iso)) iso += ':00'
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/** Convert one source value to what the D1 column stores. Throws when the value cannot be represented. */
export function coerceValue(value: unknown, column: ColumnInfo): SqlValue {
  if (value === null || value === undefined) return null
  const type = column.type
  if (type.startsWith('INT')) {
    if (typeof value === 'boolean') return value ? 1 : 0
    if (typeof value === 'number' || typeof value === 'bigint') return value
    if (value instanceof Date) return value.getTime()
    if (typeof value === 'string') {
      if (['t', 'true'].includes(value)) return 1
      if (['f', 'false'].includes(value)) return 0
      if (/^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value)
      const ms = toEpochMs(value)
      if (ms !== null) return ms
    }
    throw new Error(`${column.name}: cannot store ${JSON.stringify(value)} as an integer`)
  }
  if (type.startsWith('REAL') || type.startsWith('NUM') || type.startsWith('FLOA') || type.startsWith('DOUB')) {
    const number = Number(value)
    if (!Number.isFinite(number)) throw new Error(`${column.name}: cannot store ${JSON.stringify(value)} as a number`)
    return number
  }
  if (type.startsWith('BLOB')) {
    if (value instanceof Uint8Array) return value
    if (typeof value === 'string' && value.startsWith('\\x')) return Buffer.from(value.slice(2), 'hex')
    return Buffer.from(String(value))
  }
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const asRows = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : [])
const hex = () => randomUUID().replaceAll('-', '')

type Work = Map<string, Row[]>

export function convertDump(input: ConvertInput): ConvertResult {
  const { dump, schema, idMap, options } = input
  const now = options.now ?? Date.now()
  const before = (migration: number) => options.sourceMigration < migration
  const anchor = input.anchor ?? hex
  const transaction = input.transaction ?? hex
  const report: PlaneImportReport = { tables: {}, warnings: [], skippedTables: [], assetCopies: [] }
  const warn = (message: string) => {
    if (report.warnings.length < 500) report.warnings.push(message)
  }
  const get = (...names: string[]): Row[] => names.flatMap(name => asRows(dump[name]))
  const has = (...names: string[]) => names.some(name => asRows(dump[name]).length > 0)
  const work: Work = new Map()
  const put = (table: string, rows: Row[]) => work.set(table, [...(work.get(table) ?? []), ...rows])

  // ---- Source rows grouped by D1 table; legacy tables that no longer exist are folded in below. ----
  const dashboardTables = ['widgets', 'dashboards', 'dashboard_widgets'].filter(name => schema.tables.has(name))
  const consumed = new Set([
    'users', 'accounts', 'global_views', 'issue_properties', 'page_blocks',
    ...dashboardTables.map(name => `deprecated_${name}`),
    ...Object.values(LEGACY_FAVORITE_FILES).flat()
  ])
  for (const table of schema.order) {
    if (table === 'user' || table === 'account') continue
    const source = dashboardTables.includes(table) && !Object.hasOwn(dump, table) ? `deprecated_${table}` : table
    const rows = get(source)
    if (rows.length) put(table, rows.map(row => ({ ...row })))
  }
  for (const name of Object.keys(dump)) {
    if (!consumed.has(name) && !schema.tables.has(name)) report.skippedTables.push({ table: name, reason: 'No table with this name in the D1 schema.' })
  }

  // ---- Users, credentials and profiles (PD-1291, 1292, 1296, 1304, 1318, 1325, 1329, 1346-1348, 1355). ----
  const users = get('users')
  const seenEmails = new Set<string>()
  const userRows: Row[] = []
  for (const user of users) {
    const email = String(user.email ?? '').trim().toLowerCase()
    if (!email || seenEmails.has(email)) {
      warn(`users ${String(user.id)}: skipped, email is empty or duplicated`)
      continue
    }
    seenEmails.add(email)
    const displayName = generateDisplayName({ ...user, email })
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
    userRows.push({
      id: user.id,
      name: fullName || displayName,
      email,
      email_verified: user.is_email_verified === true || user.is_email_verified === 't',
      image: user.avatar || null,
      created_at: user.date_joined ?? user.created_at ?? now,
      updated_at: user.updated_at ?? user.date_joined ?? user.created_at ?? now
    })
  }
  put('user', userRows)
  const kept = new Set(userRows.map(row => row.id))
  for (const row of userRows) idMap.allocate('user', row.id)

  // Credential accounts carry no password hash: Django hashes are not Better Auth credentials (PD-1318).
  put(
    'account',
    userRows.map(user => ({
      id: `credential:${String(user.id)}`,
      account_id: String(idMap.get('user', user.id)),
      provider_id: 'credential',
      user_id: user.id,
      password: null,
      created_at: user.created_at,
      updated_at: user.updated_at
    }))
  )
  put(
    'account',
    get('accounts')
      .filter(account => kept.has(account.user_id))
      .map(account => ({
        id: account.id,
        account_id: account.provider_account_id ?? account.account_id,
        provider_id: account.provider ?? account.provider_id,
        user_id: account.user_id,
        access_token: account.access_token ?? null,
        refresh_token: account.refresh_token ?? null,
        id_token: account.id_token ?? null,
        access_token_expires_at: account.access_token_expired_at ?? null,
        refresh_token_expires_at: account.refresh_token_expired_at ?? null,
        created_at: account.created_at ?? now,
        updated_at: account.updated_at ?? now
      }))
  )

  const profileSource = has('profiles')
    ? get('profiles')
    : users.map(user => {
        let next: Row = { ...user }
        if (before(38)) {
          const steps = before(37) ? null : onboardingDefaultSteps(user)
          if (steps) next = { ...next, ...steps }
          const theme = restructureTheming(user.theme)
          if (theme) next.theme = theme
        }
        return migrateUserProfile(next)
      })
  const profiles = profileSource.map(profile => {
    const next: Row = { ...profile, user_timezone: updateUserTimezone(profile.user_timezone) }
    if (before(118)) {
      Object.assign(next, migrateAllTheProductTourToTrue(next, {}).profile)
    } else next.product_tour = populateProductTour(next.product_tour)
    return next
  })
  work.delete('profiles')
  put('profiles', profiles.map(row => ({ ...row, id: row.id ?? `profile:${String(row.user_id)}` })))
  if (!has('user_notification_preferences')) put('user_notification_preferences', createNotificationPreferences(users).map(row => ({ ...row, id: `preferences:${String(row.user_id)}` })))

  // ---- Historical dashboard seed (0055) and widget default change (0059). ----
  // 0090 renamed these tables and 0092 removed them; absent newer tables are not re-created.
  if (before(55)) {
    put('widgets', createWidgets().map(widget => ({ ...widget, id: `seed-widget:${widget.key}` })))
    const homeDashboards = createDashboards(userRows.map(user => user.id))
    put('dashboards', homeDashboards.map(row => ({ ...row, id: `seed-dashboard:${String(row.owned_by_id)}` })))
    const widgetIds = (work.get('widgets') ?? []).map(row => row.id)
    const dashboardIds = (work.get('dashboards') ?? []).map(row => row.id)
    const linkKey = (row: Row) => JSON.stringify([row.widget_id, row.dashboard_id])
    const existing = new Set((work.get('dashboard_widgets') ?? []).map(linkKey))
    const links = createDashboardWidgets(widgetIds, dashboardIds)
      .filter(row => !existing.has(linkKey(row)))
      .map(row => ({ ...row, id: `seed-dashboard-widget:${linkKey(row)}` }))
    put('dashboard_widgets', links)
  }
  if (before(59)) work.set('widgets', widgetsFilterChange(work.get('widgets') ?? []))

  // ---- Workspaces, projects and members. ----
  work.set(
    'workspaces',
    (work.get('workspaces') ?? []).map(workspace => ({ ...workspace, organization_size: updateCompanyOrganizationSize(workspace) ?? workspace.organization_size }))
  )
  work.set(
    'projects',
    (work.get('projects') ?? []).map(project => (before(61) ? { ...project, logo_props: updateProjectLogoProps(project) } : project))
  )
  work.set(
    'workspace_members',
    (work.get('workspace_members') ?? []).map(member => {
      let next: Row = { ...member, role: updateWorkspaceProjectMemberRole(member.role) }
      if (before(39)) next.view_props = updateWorkspaceMemberProps(next.view_props)
      if (before(41)) next = { ...next, ...workspaceMemberProperties(next) }
      if (before(44) || !next.default_props) next = { ...next, ...updateWorkspaceMemberViewProps(next) }
      if (before(118)) next = migrateAllTheProductTourToTrue({}, next).member
      return next
    })
  )
  work.set(
    'project_members',
    backfillSortOrder(work.get('project_members') ?? []).map(member => {
      const next: Row = { ...member, role: updateWorkspaceProjectMemberRole(member.role) }
      return before(44) ? { ...next, ...updateProjectMemberViewProps(next) } : next
    })
  )
  for (const [table, update] of [
    ['cycles', updateCycleProps],
    ['modules', updateModuleProps]
  ] as const) {
    work.set(
      table,
      backfillSortOrder(work.get(table) ?? []).map(row => {
        const props = before(44) ? update(row) : null
        return props ? { ...row, view_props: props } : row
      })
    )
  }
  work.set('labels', backfillSortOrder(work.get('labels') ?? []))

  // ---- States, issues, drafts, relations, activity. ----
  const projects = work.get('projects') ?? []
  let states = (work.get('states') ?? []).map(state => (before(63) ? updateProjectStateGroup(state) : state))
  const issueRows = work.get('issues') ?? []
  const draftIds = new Set(issueRows.filter(issue => issue.is_draft === true || issue.is_draft === 't').map(issue => issue.id))
  let published: Row[] = issueRows.filter(issue => !draftIds.has(issue.id)).map(issue => ({ ...issue, priority: updateIssuePriorityChoice(issue.priority) }))
  for (const table of ['issue_assignees', 'issue_labels', 'cycle_issues', 'module_issues']) {
    work.set(table, (work.get(table) ?? []).filter(row => !draftIds.has(row.issue_id)))
  }
  if (draftIds.size && !has('draft_issues')) {
    const drafts = migrateDraftIssues(
      issueRows.map(issue => ({ ...issue, is_draft: draftIds.has(issue.id) })),
      get('issue_assignees'),
      get('issue_labels'),
      get('module_issues'),
      get('cycle_issues')
    )
    put('draft_issues', drafts.draftIssues)
    put('draft_issue_assignees', drafts.assignees.map(row => ({ ...row, id: `draft-assignee:${String(row.draft_issue_id)}:${String(row.assignee_id)}` })))
    put('draft_issue_labels', drafts.labels.map(row => ({ ...row, id: `draft-label:${String(row.draft_issue_id)}:${String(row.label_id)}` })))
    put('draft_issue_modules', drafts.modules.map(row => ({ ...row, id: `draft-module:${String(row.draft_issue_id)}:${String(row.module_id)}` })))
    put('draft_issue_cycles', drafts.cycles.map(row => ({ ...row, id: `draft-cycle:${String(row.draft_issue_id)}:${String(row.cycle_id)}` })))
  }

  let activities = work.get('issue_activities') ?? []
  if (before(67)) {
    const remap = issueEstimatePoint(projects, work.get('estimate_points') ?? [], published, activities)
    for (const message of remap.unmatched) warn(`estimate point not found: ${message}`)
    const points = new Map(remap.issues.map(item => [item.id, item.estimate_point_id]))
    published = published.map(issue => (points.has(issue.id) ? { ...issue, estimate_point_id: points.get(issue.id) } : issue))
    const changed = new Map(remap.activities.map(activity => [activity.id, activity]))
    activities = activities.map(activity => changed.get(activity.id) ?? activity)
    work.set('estimates', lastUsedEstimate(work.get('estimates') ?? [], projects))
  }
  const emailLookup: Map<string, PlaneUserRef> = userLookupByEmail(users.map(user => ({ ...user, display_name: generateDisplayName(user) })))
  work.set('issue_activities', activities.map(activity => normalizeActivity(activity, emailLookup)))

  if (before(112)) {
    const result = createTriageState(projects, states, work.get('intake_issues') ?? [], published)
    states = [...result.states, ...result.created.map(state => ({ ...state, id: `triage:${String(state.project_id)}` }))]
    const stateOf = new Map(
      result.issueStates.map(item => [
        item.issue_id,
        typeof item.state_ref === 'object' && item.state_ref !== null ? `triage:${String((item.state_ref as Row).project_id)}` : item.state_ref
      ])
    )
    published = published.map(issue => (stateOf.has(issue.id) ? { ...issue, state_id: stateOf.get(issue.id) } : issue))
  }
  work.set(
    'states',
    states.map(state => ({ ...state, slug: state.slug || stateSlug(state.name), is_triage: state.is_triage || state.group === 'triage' }))
  )
  work.set('issues', published)
  work.set('intake_issues', (work.get('intake_issues') ?? []).map(setDefaultSourceType))

  const relations = work.get('issue_relations') ?? []
  const seenRelations = new Set(relations.map(row => `${String(row.issue_id)}:${String(row.related_issue_id)}:${String(row.relation_type)}`))
  const derived = get('issue_blockers')
    .map(createIssueRelation)
    .filter(row => !seenRelations.has(`${String(row.issue_id)}:${String(row.related_issue_id)}:blocked_by`))
  if (derived.length) put('issue_relations', derived.map(row => ({ ...row, id: `blocker:${String(row.issue_id)}:${String(row.related_issue_id)}` })))

  if (!has('project_issue_counters')) {
    const last = new Map<unknown, number>()
    for (const issue of published) last.set(issue.project_id, Math.max(last.get(issue.project_id) ?? 0, Number(issue.sequence_id ?? 0)))
    put('project_issue_counters', [...last].map(([project_id, last_sequence]) => ({ id: `counter:${String(project_id)}`, project_id, last_sequence })))
  }

  // ---- Pages and project links (PD-1317, 1334, 1341). ----
  const identifiers = new Map(projects.map(project => [project.id, project.identifier]))
  const sequenceOf = new Map(published.map(issue => [issue.id, issue.sequence_id]))
  let pages = work.get('pages') ?? []
  const blocks = get('page_blocks')
  if (blocks.length) {
    const logs: Row[] = []
    pages = pages.map(page => {
      const merged = updatePages(page, blocks, {
        projectIdentifier: String(identifiers.get(page.project_id) ?? ''),
        issueSequence: id => sequenceOf.get(id) ?? '',
        issueRef: id => idMap.allocate('issues', id),
        transaction
      })
      if (!merged) return page
      logs.push(...merged.page_logs.map(log => ({ ...log, id: `page-log:${String(log.transaction)}` })))
      return { ...page, description_html: merged.description_html }
    })
    put('page_logs', logs)
  }
  if (before(106)) pages = setPageSortOrder(pages)
  work.set('pages', pages)
  if (!has('project_pages')) {
    put(
      'project_pages',
      pages.flatMap(page => {
        const link = migratePages(page)
        return link ? [{ ...link, id: `project-page:${String(page.id)}` }] : []
      })
    )
  }

  // ---- Views and personal properties (PD-1319-1321, 1335, 1343, 1349). ----
  const globalViews = get('global_views')
  if (globalViews.length) put('issue_views', globalViews.map(view => ({ ...issueView(view), id: view.id })))
  work.set('issue_views', (work.get('issue_views') ?? []).map(populateViewsOwnedBy))

  const projectMembers = work.get('project_members') ?? []
  if (!has('workspace_user_properties')) {
    put(
      'workspace_user_properties',
      (work.get('workspace_members') ?? []).flatMap(member => {
        const row = workspaceUserProperties(member)
        return row ? [{ ...row, id: `workspace-props:${String(row.workspace_id)}:${String(row.user_id)}` }] : []
      })
    )
  }
  let userProperties = get('project_user_properties')
  if (!userProperties.length) {
    const byMember = new Map(projectMembers.map(member => [`${String(member.member_id)}:${String(member.project_id)}`, member]))
    userProperties = get('issue_properties').flatMap(property => {
      const row = projectUserProperties(
        { ...property, display_properties: updateUserIssueProperties(property.properties ?? property.display_properties) },
        byMember.get(`${String(property.user_id)}:${String(property.project_id)}`)
      )
      return row ? [{ ...row, id: property.id }] : []
    })
  }
  work.set('project_user_properties', before(115) ? moveIssueUserPropertiesToProjectUserProperties(userProperties, projectMembers) : userProperties)

  if (before(107)) {
    if (!input.converter) warn('No filter converter given: rich_filters stay empty (PD-1343).')
    for (const table of ['issue_views', 'workspace_user_properties', 'module_user_properties', 'project_user_properties', 'cycle_user_properties']) {
      work.set(
        table,
        (work.get(table) ?? []).map(row => {
          if (!input.converter) return row
          const result = migrateFiltersToRichFilters(row, input.converter)
          if (result.error) warn(`${table} ${String(row.id)}: ${result.error}`)
          return result.row
        })
      )
    }
  }

  // ---- Favorites, deploy boards, assets, tokens. ----
  if (!has('user_favorites')) {
    const legacy = Object.fromEntries(
      Object.entries(LEGACY_FAVORITE_FILES).map(([model, files]) => [model, get(...files)])
    ) as Parameters<typeof userFavoriteMigration>[0]
    put('user_favorites', userFavoriteMigration(legacy).map((row, index) => ({ ...row, id: `favorite:${index}` })))
  }
  if (!has('deploy_boards') && has('project_deploy_boards')) {
    put('deploy_boards', get('project_deploy_boards').map(board => ({ ...populateDeployBoard(board, String(board.anchor ?? anchor())), id: `board:${String(board.id)}` })))
  }
  if (!has('file_assets') && has('issue_attachments')) {
    put('file_assets', get('issue_attachments').map(attachment => ({ ...moveAttachmentToFileasset(attachment), id: `attachment:${String(attachment.id)}` })))
  }
  const apiTokens = work.get('api_tokens') ?? []
  if (apiTokens.length && !options.includeApiTokens) {
    work.delete('api_tokens')
    report.skippedTables.push({ table: 'api_tokens', reason: 'Skipped by default (PD-1350). Create new tokens or pass --include-api-tokens to import them inactive.' })
  } else {
    const owners = new Map(users.map(user => [user.id, user]))
    work.set('api_tokens', apiTokens.map(token => migrateExistingApiTokens(token, owners.get(token.user_id))))
  }

  // ---- Map IDs and coerce values per D1 column. ----
  const uploadedKeys = new Set(options.uploadedKeys)
  const out = new Map<string, OutRow[]>()
  for (const table of schema.order) {
    for (const row of work.get(table) ?? []) if (row.id !== undefined && row.id !== null) idMap.allocate(table, row.id)
  }
  const unknownIdentifiers = new Map<string, number>()
  for (const table of schema.order) {
    const info = schema.tables.get(table)!
    const rows = work.get(table) ?? []
    const stats = (report.tables[table] ??= { read: 0, written: 0, dropped: 0 })
    stats.read += rows.length
    const written: OutRow[] = []
    for (const source of rows) {
      const outRow: OutRow = {}
      let drop: string | null = null
      const id = source.id === undefined || source.id === null ? idMap.create(table) : idMap.allocate(table, source.id)
      for (const [name, column] of info.columns) {
        if (name === 'id') {
          outRow.id = id
          continue
        }
        let value: unknown = source[name]
        if (name === 'created_at' || name === 'updated_at') value ??= now
        if (value === undefined || (value === null && column.notNull && column.hasDefault)) {
          if (column.notNull && !column.hasDefault) drop = `${name} is required`
          if (drop) break
          continue
        }
        if (value === null && column.notNull) {
          drop = `${name} is required`
          break
        }
        try {
          const refTable = info.foreignKeys.get(name)
          if (value === null || (value === '' && refTable)) {
            outRow[name] = null
          } else if (refTable) {
            const mapped = idMap.get(refTable, value)
            if (mapped === undefined && !/^\d+$/.test(String(value))) {
              if (column.notNull) drop = `${name} refers to a missing ${refTable} row (${String(value)})`
              else if (!name.endsWith('_by_id')) warn(`${table} ${String(source.id)}: ${name} refers to a missing ${refTable} row, set to null`)
              outRow[name] = null
            } else outRow[name] = mapped ?? Number(value)
          } else if (name === 'entity_identifier' && column.type.startsWith('INT')) {
            const entity = ENTITY_TABLES[String(source.entity_name ?? source.entity_type ?? '').toLowerCase()]
            outRow[name] = entity && idMap.get(entity, value) !== undefined ? idMap.get(entity, value)! : null
          } else if ((name === 'new_identifier' || name === 'old_identifier') && table === 'issue_activities') {
            const target = ACTIVITY_IDENTIFIER_TABLES[String(source.field)]
            const mapped = target ? idMap.get(target, value) : undefined
            if (mapped === undefined) unknownIdentifiers.set(String(source.field), (unknownIdentifiers.get(String(source.field)) ?? 0) + 1)
            outRow[name] = mapped ?? null
          } else {
            outRow[name] = coerceValue(value, column)
          }
        } catch (error) {
          drop = error instanceof Error ? error.message : String(error)
        }
        if (drop) break
      }
      if (drop) {
        stats.dropped++
        warn(`${table} ${String(source.id)}: dropped, ${drop}`)
      } else written.push(outRow)
    }
    if (written.length) out.set(table, written)
  }
  for (const [field, count] of unknownIdentifiers) warn(`issue_activities: ${count} identifier(s) for field "${field}" could not be mapped and were cleared`)

  if (before(125)) {
    const boards = out.get('deploy_boards')
    if (boards) out.set('deploy_boards', resetProjectDeployBoardIdentity(boards as Row[], now) as OutRow[])
  }

  // Asset bytes live in S3 until copied: an asset is uploaded only once its key is verified (PD-1338, PD-1339).
  const assets = out.get('file_assets')
  if (assets) {
    out.set(
      'file_assets',
      assets.map(asset => {
        const key = String(asset.asset ?? '')
        const uploaded = options.assumeUploaded || uploadedKeys.has(key)
        if (key && !uploaded) report.assetCopies.push({ id: Number(asset.id), key })
        const marked = markExistingFileUploads(asset, uploaded)
        return { ...marked, is_uploaded: marked.is_uploaded ? 1 : 0 }
      })
    )
  }
  for (const [table, rows] of out) (report.tables[table] ??= { read: 0, written: 0, dropped: 0 }).written = rows.length
  return { rows: out, report }
}
