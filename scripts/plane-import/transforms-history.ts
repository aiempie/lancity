// Pure transforms for Plane data migrations about issue history, relations, estimates, states and intake.
import type { Row } from './transforms-accounts'

/** PD-1293 `rename_field` (0039) and PD-1297 `rectify_field_issue_activity` (0041): the field `assignee` became `assignees`. */
export function renameField<T extends Row>(activity: T): T {
  return activity.field === 'assignee' ? { ...activity, field: 'assignees' } : activity
}
export const rectifyFieldIssueActivity = renameField

/** PD-1299 `update_name_activity` (0041): earlier code wrote "start date" in the comment of a name change. */
export function updateNameActivity<T extends Row>(activity: T): T {
  if (activity.field !== 'name' || typeof activity.comment !== 'string') return activity
  return { ...activity, comment: activity.comment.replaceAll('start date', 'name') }
}

/** PD-1314 `update_issue_activity_priority` (0045): empty old/new priority values become `none`. */
export function updateIssueActivityPriority<T extends Row>(activity: T): T {
  if (activity.field !== 'priority') return activity
  return { ...activity, new_value: activity.new_value || 'none', old_value: activity.old_value || 'none' }
}

/** PD-1315 `update_issue_activity_blocked` (0045): the field `blocks` became `blocked_by`. */
export function updateIssueActivityBlocked<T extends Row>(activity: T): T {
  return activity.field === 'blocks' ? { ...activity, field: 'blocked_by' } : activity
}

export type PlaneUserRef = { id: unknown; email?: unknown; display_name?: unknown }

/**
 * PD-1298 `update_assignee_issue_activity` (0041): old activity stored the assignee's email. Look the person up by email, store the
 * display name and put the user id in `new_identifier` / `old_identifier` (still a Plane id; the importer maps it to the D1 `user` id).
 */
export function updateAssigneeIssueActivity<T extends Row>(activity: T, users: Map<string, PlaneUserRef>): T {
  if (activity.field !== 'assignees') return activity
  const next: Row = { ...activity }
  const side = (valueKey: 'new_value' | 'old_value', identifierKey: 'new_identifier' | 'old_identifier') => {
    const user = users.get(String(activity[valueKey] ?? '').toLowerCase())
    if (!user) return
    next[valueKey] = user.display_name
    next[identifierKey] = user.id
    const words = typeof activity.comment === 'string' ? activity.comment.split(/\s+/).filter(Boolean) : []
    if (words.length) {
      words[words.length - 1] = String(user.display_name ?? '')
      next.comment = words.join(' ')
    }
  }
  if (activity.new_value && !activity.old_value) side('new_value', 'new_identifier')
  if (activity.old_value && !activity.new_value) side('old_value', 'old_identifier')
  return next as T
}

/** All historical activity rules in migration order. `users` is keyed by lower-cased email. */
export function normalizeActivity<T extends Row>(activity: T, users: Map<string, PlaneUserRef>): T {
  return updateIssueActivityBlocked(
    updateIssueActivityPriority(updateNameActivity(updateAssigneeIssueActivity(renameField(activity), users)))
  )
}

export function userLookupByEmail(users: Row[]): Map<string, PlaneUserRef> {
  return new Map(users.filter(user => typeof user.email === 'string').map(user => [String(user.email).toLowerCase(), user as PlaneUserRef]))
}

/** PD-1305 `create_issue_relation` (0043): IssueBlocker rows become `blocked_by` relations (`block` is the blocked issue). */
export function createIssueRelation(blocker: Row): Row {
  return {
    issue_id: blocker.block_id,
    related_issue_id: blocker.blocked_by_id,
    relation_type: 'blocked_by',
    project_id: blocker.project_id,
    workspace_id: blocker.workspace_id,
    created_by_id: blocker.created_by_id ?? null,
    updated_by_id: blocker.updated_by_id ?? null,
    created_at: blocker.created_at,
    updated_at: blocker.updated_at,
    deleted_at: blocker.deleted_at ?? null
  }
}

export type EstimateRemap = {
  issues: { id: unknown; estimate_point_id: unknown }[]
  activities: Row[]
  unmatched: string[]
}

/**
 * PD-1331 `issue_estimate_point` (0067): issues keep an estimate point FK instead of the numeric `point`, and `estimate_point`
 * activities store the point id and value. Unknown keys are reported (the source would crash on them) and left untouched.
 */
export function issueEstimatePoint(projects: Row[], points: Row[], issues: Row[], activities: Row[]): EstimateRemap {
  const result: EstimateRemap = { issues: [], activities: [], unmatched: [] }
  for (const project of projects) {
    if (!project.estimate_id) continue
    const find = (key: unknown) =>
      points.find(point => point.estimate_id === project.estimate_id && point.project_id === project.id && String(point.key) === String(key))
    for (const activity of activities) {
      if (activity.field !== 'estimate_point' || activity.project_id !== project.id) continue
      const next: Row = { ...activity }
      for (const side of ['new', 'old'] as const) {
        const raw = activity[`${side}_value`]
        if (!raw) continue
        const point = find(raw)
        if (!point) result.unmatched.push(`activity ${String(activity.id)} ${side}_value ${String(raw)}`)
        else {
          next[`${side}_identifier`] = point.id
          next[`${side}_value`] = point.value
        }
      }
      result.activities.push(next)
    }
    for (const issue of issues) {
      if (issue.project_id !== project.id || issue.point === null || issue.point === undefined) continue
      const point = find(issue.point)
      if (point) result.issues.push({ id: issue.id, estimate_point_id: point.id })
      else result.unmatched.push(`issue ${String(issue.id)} point ${String(issue.point)}`)
    }
  }
  return result
}

/** PD-1332 `last_used_estimate` (0067): estimates assigned to a project are `last_used`. Returns the updated estimates. */
export function lastUsedEstimate(estimates: Row[], projects: Row[]): Row[] {
  const used = new Set(projects.filter(project => project.estimate_id).map(project => project.estimate_id))
  return estimates.map(estimate => (used.has(estimate.id) ? { ...estimate, last_used: true } : estimate))
}

/** PD-1328 `update_project_state_group` (0063): the backlog state named `Triage` moves to the triage group. */
export function updateProjectStateGroup<T extends Row>(state: T): T {
  return state.group === 'backlog' && state.name === 'Triage' ? { ...state, group: 'triage', is_triage: true } : state
}

/** PD-1340 `set_default_source_type` (0094): `in-app` in any case becomes the `IN_APP` enum value. */
export function setDefaultSourceType<T extends Row>(intakeIssue: T): T {
  return typeof intakeIssue.source === 'string' && intakeIssue.source.toLowerCase() === 'in-app' ? { ...intakeIssue, source: 'IN_APP' } : intakeIssue
}

export const TRIAGE_STATE = { name: 'Triage', color: '#4E5355', sequence: 65000, default: false }

export type TriageResult = { states: Row[]; created: Row[]; issueStates: { issue_id: unknown; state_ref: unknown }[] }

/**
 * PD-1345 `create_triage_state` (0112): normalise existing triage states, create one for each project that lacks it (named
 * `Triage-<first 5 characters of the project UUID>` when a non-triage state is already called `Triage`) and move pending intake
 * issues (status -2 or 0) to the project's triage state. `created` rows have no `id`; `issueStates[].state_ref` is a state id
 * (existing row) or the created row's `project_id` + `{ created: true }` marker resolved by the caller.
 */
export function createTriageState(projects: Row[], states: Row[], intakeIssues: Row[], issues: Row[]): TriageResult {
  const normalized = states.map(state => (state.group === 'triage' ? { ...state, ...TRIAGE_STATE, is_triage: true } : state))
  const withTriage = new Set(normalized.filter(state => state.group === 'triage').map(state => state.project_id))
  const nameClash = new Set(normalized.filter(state => state.group !== 'triage' && state.name === 'Triage').map(state => state.project_id))
  const created: Row[] = []
  for (const project of projects) {
    if (withTriage.has(project.id)) continue
    created.push({
      ...TRIAGE_STATE,
      name: nameClash.has(project.id) ? `Triage-${String(project.id).slice(0, 5)}` : TRIAGE_STATE.name,
      group: 'triage',
      is_triage: true,
      project_id: project.id,
      workspace_id: project.workspace_id
    })
  }
  const triageByProject = new Map<unknown, unknown>()
  for (const state of normalized) if (state.group === 'triage' && !triageByProject.has(state.project_id)) triageByProject.set(state.project_id, state.id)
  const issueById = new Map(issues.map(issue => [issue.id, issue]))
  const issueStates: TriageResult['issueStates'] = []
  for (const intake of intakeIssues) {
    if (![-2, 0].includes(Number(intake.status))) continue
    const issue = issueById.get(intake.issue_id)
    if (!issue) continue
    const existing = triageByProject.get(issue.project_id)
    issueStates.push({ issue_id: issue.id, state_ref: existing ?? { created: true, project_id: issue.project_id } })
  }
  return { states: normalized, created, issueStates }
}

export function stateSlug(name: unknown): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
