// Pure transforms for Plane data migrations about pages, views, favorites, dashboards, drafts, assets and public boards.
import { isRecord, type Row } from './transforms-accounts'

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export type PageContext = {
  /** Identifier of the page's project (`FIRST`), used for the embed attribute. */
  projectIdentifier: string
  /** Sequence ID of a block's issue, keyed by Plane issue UUID. */
  issueSequence: (issueId: unknown) => unknown
  /** The D1 `issues.id` to write in the embed for a Plane issue UUID. */
  issueRef: (issueId: unknown) => unknown
  transaction: () => string
}

/**
 * PD-1317 `update_pages` (0049): PageBlocks are folded into `description_html`. An issue block becomes an
 * `issue-embed-component` plus a `page_logs` row; other blocks add an `<h2>` and their HTML. Block names and
 * issue titles are escaped before they go into attributes. Blocks are ordered by `sort_order`.
 * Returns null when the page has no blocks (the source leaves such pages alone).
 */
export function updatePages(page: Row, blocks: Row[], context: PageContext): { description_html: string; page_logs: Row[] } | null {
  const own = blocks.filter(block => block.page_id === page.id).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
  if (!own.length) return null
  let html = typeof page.description_html === 'string' ? page.description_html : ''
  const logs: Row[] = []
  for (const block of own) {
    if (block.issue_id) {
      const transaction = context.transaction()
      html +=
        `<issue-embed-component id="${transaction}" entity_name="issue" entity_identifier="${escapeHtml(context.issueRef(block.issue_id))}" ` +
        `sequence_id="${escapeHtml(context.issueSequence(block.issue_id))}" project_identifier="${escapeHtml(context.projectIdentifier)}" ` +
        `title="${escapeHtml(block.name)}"></issue-embed-component>`
      logs.push({
        page_id: page.id,
        transaction,
        entity_identifier: block.issue_id,
        entity_name: 'issue',
        workspace_id: page.workspace_id,
        created_by_id: block.created_by_id ?? null,
        updated_by_id: block.updated_by_id ?? null
      })
    } else {
      html += `<h2>${escapeHtml(block.name)}</h2>${typeof block.description_html === 'string' ? block.description_html : ''}`
    }
  }
  return { description_html: html, page_logs: logs }
}

/** PD-1321 `issue_view` (0053): a GlobalView becomes a workspace-level `issue_views` row (no project). */
export function issueView(globalView: Row): Row {
  const queryData = isRecord(globalView.query_data) ? globalView.query_data : {}
  return {
    workspace_id: globalView.workspace_id,
    project_id: null,
    name: globalView.name,
    description: globalView.description ?? '',
    query: globalView.query ?? {},
    access: globalView.access ?? 1,
    filters: queryData.filters ?? {},
    sort_order: globalView.sort_order ?? 65535,
    created_by_id: globalView.created_by_id ?? null,
    updated_by_id: globalView.updated_by_id ?? null,
    owned_by_id: globalView.owned_by_id ?? globalView.created_by_id ?? null,
    created_at: globalView.created_at,
    updated_at: globalView.updated_at,
    deleted_at: globalView.deleted_at ?? null
  }
}

/** PD-1335 `populate_views_owned_by` (0069): the creator owns a view that has no owner. */
export function populateViewsOwnedBy<T extends Row>(view: T): T {
  return view.owned_by_id ? view : { ...view, owned_by_id: view.created_by_id ?? null }
}

// ---- Historical home dashboard seeds (0055, 0059). ----

export type WidgetSeed = { key: string; filters: Row }

/** PD-1322 `create_widgets` (0055). */
export function createWidgets(): WidgetSeed[] {
  return [
    { key: 'overview_stats', filters: {} },
    { key: 'assigned_issues', filters: { duration: 'this_week', tab: 'upcoming' } },
    { key: 'created_issues', filters: { duration: 'this_week', tab: 'upcoming' } },
    { key: 'issues_by_state_groups', filters: { duration: 'this_week' } },
    { key: 'issues_by_priority', filters: { duration: 'this_week' } },
    { key: 'recent_activity', filters: {} },
    { key: 'recent_projects', filters: {} },
    { key: 'recent_collaborators', filters: {} }
  ]
}

/** PD-1323 `create_dashboards` (0055): one default home dashboard per user. */
export function createDashboards(userIds: unknown[]): Row[] {
  return userIds.map(owned_by_id => ({
    name: 'Home dashboard',
    description_html: '<p></p>',
    identifier: null,
    owned_by_id,
    type_identifier: 'home',
    is_default: true
  }))
}

/** PD-1324 `create_dashboard_widgets` (0055): every widget on every dashboard. */
export function createDashboardWidgets(widgetIds: unknown[], dashboardIds: unknown[]): { widget_id: unknown; dashboard_id: unknown }[] {
  return widgetIds.flatMap(widget_id => dashboardIds.map(dashboard_id => ({ widget_id, dashboard_id })))
}

const WIDGET_FILTERS_0059: Record<string, Row> = {
  assigned_issues: { duration: 'none', tab: 'pending' },
  created_issues: { duration: 'none', tab: 'pending' },
  issues_by_state_groups: { duration: 'none' },
  issues_by_priority: { duration: 'none' }
}

/** PD-1326 `widgets_filter_change` (0059): the final default filters. */
export function widgetsFilterChange<T extends Row>(widgets: T[]): T[] {
  return widgets.map(widget => (typeof widget.key === 'string' && Object.hasOwn(WIDGET_FILTERS_0059, widget.key) ? { ...widget, filters: { ...WIDGET_FILTERS_0059[widget.key] } } : widget))
}

// ---- Favorites, deploy boards, project pages, drafts, assets. ----

export const FAVORITE_ENTITY_TYPES = {
  CycleFavorite: 'cycle',
  ModuleFavorite: 'module',
  ProjectFavorite: 'project',
  PageFavorite: 'page',
  IssueViewFavorite: 'view'
} as const

/** The Plane column that holds the favorite's target (`view` favorites use `view_id` in the old table). */
function favoriteTarget(row: Row, entityType: string): unknown {
  return row[`${entityType}_id`] ?? row[entityType]
}

/**
 * PD-1330 `user_favorite_migration` (0065): merge the five favorite tables into `user_favorites`. `entity_identifier` stays a Plane
 * UUID here; the importer maps it to the D1 id of the entity table that `entity_type` selects.
 */
export function userFavoriteMigration(sources: Partial<Record<keyof typeof FAVORITE_ENTITY_TYPES, Row[]>>): Row[] {
  const rows: Row[] = []
  for (const [model, entityType] of Object.entries(FAVORITE_ENTITY_TYPES)) {
    for (const favorite of sources[model as keyof typeof FAVORITE_ENTITY_TYPES] ?? []) {
      const target = favoriteTarget(favorite, entityType)
      if (!target) continue
      rows.push({
        user_id: favorite.user_id,
        entity_type: entityType,
        entity_identifier: target,
        project_id: favorite.project_id ?? null,
        workspace_id: favorite.workspace_id,
        created_by_id: favorite.created_by_id ?? null,
        updated_by_id: favorite.updated_by_id ?? null,
        created_at: favorite.created_at,
        updated_at: favorite.updated_at,
        deleted_at: favorite.deleted_at ?? null
      })
    }
  }
  return rows
}

/** PD-1333 `populate_deploy_board` (0067): ProjectDeployBoard becomes a `deploy_boards` row for the project. */
export function populateDeployBoard(board: Row, anchor: string): Row {
  return {
    entity_identifier: board.project_id,
    entity_name: 'project',
    project_id: board.project_id,
    anchor,
    is_comments_enabled: board.comments ?? false,
    is_reactions_enabled: board.reactions ?? false,
    is_votes_enabled: board.votes ?? false,
    view_props: board.views ?? {},
    workspace_id: board.workspace_id,
    created_at: board.created_at,
    updated_at: board.updated_at,
    created_by_id: board.created_by_id ?? null,
    updated_by_id: board.updated_by_id ?? null,
    deleted_at: board.deleted_at ?? null,
    intake_id: board.inbox ?? board.intake_id ?? null
  }
}

/** PD-1334 `migrate_pages` (0068): `project_pages` row from a page's old project link. Null for pages without a project. */
export function migratePages(page: Row): Row | null {
  if (!page.project_id) return null
  return {
    workspace_id: page.workspace_id,
    project_id: page.project_id,
    page_id: page.id,
    created_by_id: page.created_by_id ?? null,
    updated_by_id: page.updated_by_id ?? null,
    created_at: page.created_at,
    updated_at: page.updated_at
  }
}

export type DraftMigration = { draftIssues: Row[]; assignees: Row[]; labels: Row[]; modules: Row[]; cycles: Row[] }

const live = (row: Row) => !row.deleted_at

/**
 * PD-1337 `migrate_draft_issues` (0077): issues with `is_draft` become `draft_issues` plus link rows. The new draft keeps the
 * published issue's UUID as its source key but is mapped in the `draft_issues` ID space. Deleted links are skipped, as the
 * Django default manager does.
 */
export function migrateDraftIssues(issues: Row[], assignees: Row[], labels: Row[], moduleIssues: Row[], cycleIssues: Row[]): DraftMigration {
  const result: DraftMigration = { draftIssues: [], assignees: [], labels: [], modules: [], cycles: [] }
  for (const issue of issues.filter(item => item.is_draft === true)) {
    result.draftIssues.push({
      id: issue.id,
      parent_id: issue.parent_id ?? null,
      state_id: issue.state_id ?? null,
      estimate_point_id: issue.estimate_point_id ?? null,
      name: issue.name,
      description_html: issue.description_html,
      description_stripped: issue.description_stripped ?? null,
      description_binary: issue.description_binary ?? null,
      priority: issue.priority ?? 'none',
      start_date: issue.start_date ?? null,
      target_date: issue.target_date ?? null,
      workspace_id: issue.workspace_id,
      project_id: issue.project_id,
      created_by_id: issue.created_by_id ?? null,
      updated_by_id: issue.updated_by_id ?? null,
      created_at: issue.created_at,
      updated_at: issue.updated_at
    })
    const base = { draft_issue_id: issue.id, workspace_id: issue.workspace_id, project_id: issue.project_id }
    for (const row of assignees.filter(item => item.issue_id === issue.id && live(item))) result.assignees.push({ ...base, assignee_id: row.assignee_id })
    for (const row of labels.filter(item => item.issue_id === issue.id && live(item))) result.labels.push({ ...base, label_id: row.label_id })
    for (const row of moduleIssues.filter(item => item.issue_id === issue.id && live(item))) result.modules.push({ ...base, module_id: row.module_id })
    const cycle = cycleIssues.find(item => item.issue_id === issue.id && live(item))
    if (cycle) result.cycles.push({ ...base, cycle_id: cycle.cycle_id })
  }
  return result
}

/** PD-1338 `move_attachment_to_fileasset` (0079): metadata of an issue attachment as a `file_assets` row. Not uploaded until verified. */
export function moveAttachmentToFileasset(attachment: Row): Row {
  const attributes = isRecord(attachment.attributes) ? attachment.attributes : {}
  return {
    issue_id: attachment.issue_id,
    entity_type: 'ISSUE_ATTACHMENT',
    project_id: attachment.project_id,
    workspace_id: attachment.workspace_id,
    attributes,
    asset: attachment.asset,
    external_source: attachment.external_source ?? null,
    external_id: attachment.external_id ?? null,
    deleted_at: attachment.deleted_at ?? null,
    created_by_id: attachment.created_by_id ?? null,
    updated_by_id: attachment.updated_by_id ?? null,
    created_at: attachment.created_at,
    updated_at: attachment.updated_at,
    size: typeof attributes.size === 'number' ? attributes.size : 0,
    is_uploaded: false
  }
}

/**
 * PD-1339 `mark_existing_file_uploads` (0079). Plane marked every asset uploaded because the bytes already existed. Lancity can
 * only say so once the object is confirmed in R2, so `uploaded` is the result of that check.
 */
export function markExistingFileUploads<T extends Row>(asset: T, uploaded: boolean): T {
  return { ...asset, is_uploaded: uploaded }
}

/** PD-1341 `set_page_sort_order` (0106): alphabetical order in steps of 100, soft-deleted pages included, ties broken by ID. */
export function setPageSortOrder<T extends Row>(pages: T[]): T[] {
  const order = [...pages].sort((a, b) => {
    const left = String(a.name ?? '')
    const right = String(b.name ?? '')
    if (left !== right) return left < right ? -1 : 1
    return String(a.id) < String(b.id) ? -1 : 1
  })
  const rank = new Map(order.map((page, index) => [page, (index + 1) * 100]))
  return pages.map(page => ({ ...page, sort_order: rank.get(page) }))
}

/** PD-1342 `reverse_set_page_sort_order` (0106): the rollback value. */
export function reverseSetPageSortOrder<T extends Row>(pages: T[]): T[] {
  return pages.map(page => ({ ...page, sort_order: 65535 }))
}

export type FilterConverter = { convert(filters: Row, strict?: boolean): Row }

/**
 * PD-1343 `migrate_filters_to_rich_filters` (0107): fill `rich_filters` from `filters` when it is empty. `converter` is
 * `LegacyToRichFiltersConverter` (p1-platform). Returns `error` instead of throwing so one bad row does not stop an import.
 */
export function migrateFiltersToRichFilters<T extends Row>(row: T, converter: FilterConverter): { row: T; error?: string } {
  const filters = isRecord(row.filters) ? row.filters : null
  const rich = isRecord(row.rich_filters) ? row.rich_filters : {}
  if (!filters || !Object.keys(filters).length || Object.keys(rich).length) return { row }
  try {
    return { row: { ...row, rich_filters: converter.convert(filters, false) } }
  } catch (error) {
    return { row, error: error instanceof Error ? error.message : String(error) }
  }
}

/** PD-1344 `reverse_migrate_rich_filters_to_filters` (0107): rollback clears `rich_filters`. */
export function reverseMigrateRichFiltersToFilters<T extends Row>(row: T): T {
  return { ...row, rich_filters: {} }
}

/**
 * PD-1356 `reset_project_deploy_board_identity` (0125). Every project board, soft-deleted ones included, points at its own project.
 * Only one live board may publish a project, so a clashing live board is unpublished instead. Boards are handled newest first.
 * IDs must already be in one ID space (both `entity_identifier` and `project_id` compare equal for the same project).
 */
export function resetProjectDeployBoardIdentity(boards: Row[], now: number): Row[] {
  const next = boards.map(board => ({ ...board }))
  const isProject = (board: Row) => board.entity_name === 'project'
  const mismatched = next
    .filter(board => isProject(board) && board.project_id != null && (board.entity_identifier ?? null) !== board.project_id)
    .sort((a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0) || Number(b.id ?? 0) - Number(a.id ?? 0))
  for (const board of mismatched) board.entity_identifier = null
  for (const board of mismatched) {
    const clash = next.some(
      other => other !== board && isProject(other) && other.entity_identifier === board.project_id && (other.deleted_at ?? null) === (board.deleted_at ?? null)
    )
    if (!clash) board.entity_identifier = board.project_id
    else if (!board.deleted_at) {
      board.deleted_at = now
      board.is_disabled = true
    }
  }
  return next
}
