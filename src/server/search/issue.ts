import { sql, type SQL } from 'drizzle-orm'
import { ServiceError } from '@/server/common/errors'
import { visibleIssueSql } from '@/server/issue/access'
import { searchIssues } from '@/server/issue/filter'
import { LIVE_ISSUES } from '@/server/issue/list'
import { requireReportingWorkspace } from '@/server/notification/service'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { IssueSearchQuery } from '@/types/reporting/p3-view-schema'

type IssueRef = { id: number; parent_id: number | null }

const parseId = (value: string, name: string) => {
  if (!/^[1-9]\d{0,15}$/.test(value)) throw new ServiceError(400, 'VALIDATION_ERROR', `Invalid ${name}`)
  return Number(value)
}

/** PD-0791 `filter_issues_by_project`. */
export const filterIssuesByProjectIssueSearch = (projectId: number): SQL => sql`issues.project_id = ${projectId}`

/** PD-0792 `search_issues_by_query`: name, project identifier or whole numbers as sequence ids (`search_issues`). */
export const searchIssuesByQueryIssueSearch = (query: string): SQL => searchIssues(query)

/** PD-0793 `search_issues_and_excluding_parent`: drop the issue, its parent and its sub-issues. No-op for an unknown issue. */
export function searchIssuesAndExcludingParentIssueSearch(issue: IssueRef | null): SQL | undefined {
  if (!issue) return undefined
  return sql`issues.id != ${issue.id} and (issues.parent_id is null or issues.parent_id != ${issue.id})
    ${issue.parent_id === null ? sql`` : sql`and issues.id != ${issue.parent_id}`}`
}

/** PD-0794 `filter_issues_excluding_related_issues`: drop the issue and every issue linked to it by a relation. */
export function filterIssuesExcludingRelatedIssuesIssueSearch(issue: IssueRef | null): SQL | undefined {
  if (!issue) return undefined
  return sql`issues.id != ${issue.id} and issues.id not in (
    select r.issue_id from issue_relations r where r.deleted_at is null and (r.issue_id = ${issue.id} or r.related_issue_id = ${issue.id})
    union select r.related_issue_id from issue_relations r where r.deleted_at is null and (r.issue_id = ${issue.id} or r.related_issue_id = ${issue.id}))`
}

/** PD-0795 `filter_root_issues_only`: issues without a parent, except the issue itself and its own parent. */
export function filterRootIssuesOnlyIssueSearch(issue: IssueRef | null): SQL | undefined {
  if (!issue) return undefined
  return sql`issues.id != ${issue.id} and issues.parent_id is null
    ${issue.parent_id === null ? sql`` : sql`and issues.id != ${issue.parent_id}`}`
}

/** PD-0796 `exclude_issues_in_cycles`. */
export const excludeIssuesInCyclesIssueSearch = (): SQL =>
  sql`not exists (select 1 from cycle_issues ci where ci.issue_id = issues.id and ci.deleted_at is null)`

/** PD-0797 `exclude_issues_in_module`. */
export const excludeIssuesInModuleIssueSearch = (moduleId: number): SQL =>
  sql`not exists (select 1 from module_issues mi where mi.issue_id = issues.id and mi.module_id = ${moduleId} and mi.deleted_at is null)`

/** PD-0798 `filter_issues_without_target_date`. */
export const filterIssuesWithoutTargetDateIssueSearch = (): SQL => sql`issues.target_date is null`

/**
 * PD-0799 `IssueSearchEndpoint.get`: issues the actor may see (guests: their own unless the project shares all
 * features), narrowed to the project unless `workspace_search=true`, then by the optional exclusions. Max 100 rows.
 */
export async function getIssueSearch(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  query: IssueSearchQuery
) {
  const { workspace } = await requireReportingWorkspace(db, actor, slug)
  const issueId = query.issue_id ? parseId(query.issue_id, 'issue_id') : null
  const moduleId = query.module ? parseId(query.module, 'module') : null
  let issue: IssueRef | null = null
  if (issueId !== null && (query.parent === 'true' || query.issue_relation === 'true' || query.sub_issue === 'true')) {
    const [row] = await db.all<IssueRef>(
      sql`select issues.id, issues.parent_id from issues where issues.id = ${issueId} and issues.workspace_id = ${workspace.id} and ${LIVE_ISSUES}`
    )
    issue = row ?? null
  }
  const conds: (SQL | undefined)[] = [
    sql`issues.workspace_id = ${workspace.id}`,
    LIVE_ISSUES,
    visibleIssueSql(actor.userId),
    (query.workspace_search ?? 'false') === 'false' ? filterIssuesByProjectIssueSearch(projectId) : undefined,
    query.search ? searchIssuesByQueryIssueSearch(query.search) : undefined,
    query.parent === 'true' ? searchIssuesAndExcludingParentIssueSearch(issue) : undefined,
    query.issue_relation === 'true' ? filterIssuesExcludingRelatedIssuesIssueSearch(issue) : undefined,
    query.sub_issue === 'true' ? filterRootIssuesOnlyIssueSearch(issue) : undefined,
    query.cycle === 'true' ? excludeIssuesInCyclesIssueSearch() : undefined,
    moduleId === null ? undefined : excludeIssuesInModuleIssueSearch(moduleId),
    query.target_date === 'none' ? filterIssuesWithoutTargetDateIssueSearch() : undefined
  ]
  const where = sql.join(
    conds.filter((cond): cond is SQL => Boolean(cond)).map(cond => sql`(${cond})`),
    sql` and `
  )
  const rows = await db.all<
    Record<string, unknown>
  >(sql`select issues.name, issues.id, issues.start_date, issues.sequence_id,
      p.name as project_name, p.identifier as project_identifier, issues.project_id, s.name as state_name,
      s."group" as state_group, s.color as state_color
    from issues join projects p on p.id = issues.project_id left join states s on s.id = issues.state_id
    where ${where} order by issues.created_at desc, issues.id desc limit 100`)
  return rows.map(row => ({
    name: row.name,
    id: row.id,
    startDate: row.start_date,
    sequenceId: row.sequence_id,
    projectName: row.project_name,
    projectIdentifier: row.project_identifier,
    projectId: row.project_id,
    workspaceSlug: slug,
    stateName: row.state_name ?? null,
    stateGroup: row.state_group ?? null,
    stateColor: row.state_color ?? null
  }))
}
