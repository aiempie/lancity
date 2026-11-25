import { sql } from 'drizzle-orm'
import { issueActivities, issueSubscribers, issueVersions } from '@/db/schema/issue'
import type { LancityDb } from '@/types/database/schema'

/** Each insert runs only if the preceding statement changed one row. */
export function activityStatement(
  db: LancityDb,
  issueId: number | ReturnType<typeof sql<number>>,
  projectId: number,
  actorId: number,
  verb: string,
  field: string | null,
  oldValue: string | null,
  newValue: string | null,
  comment: string,
  oldId: number | null = null,
  newId: number | null = null,
  includeDeleted = false,
  mutationId: string | null = null
) {
  return db.insert(issueActivities).select(sql`select
    null, cast(unixepoch('subsec') * 1000 as integer), cast(unixepoch('subsec') * 1000 as integer), ${actorId}, ${actorId},
    ${verb}, ${field}, ${oldValue}, ${newValue}, ${comment}, '[]', id, null, project_id, workspace_id,
    ${actorId}, ${newId}, ${oldId}, unixepoch('subsec'), null, ${mutationId}
    from issues where id = ${issueId} and project_id = ${projectId} and (${includeDeleted ? 1 : 0} = 1 or deleted_at is null) and changes() = 1`)
}

/** Snapshot issue fields and its live relationships in the same D1 batch. */
export function versionStatement(
  db: LancityDb,
  issueId: number | ReturnType<typeof sql<number>>,
  projectId: number,
  actorId: number
) {
  return db.insert(issueVersions).select(sql`select
    null, cast(unixepoch('subsec') * 1000 as integer), cast(unixepoch('subsec') * 1000 as integer), ${actorId}, ${actorId},
    null, parent_id, state_id, estimate_point_id, name, priority, start_date, target_date, sequence_id, sort_order,
    completed_at, archived_at, is_draft, external_source, external_id, type_id, cast(unixepoch('subsec') * 1000 as integer), ${actorId},
    coalesce((select json_group_array(assignee_id) from issue_assignees where issue_id = issues.id and deleted_at is null), '[]'),
    coalesce((select json_group_array(label_id) from issue_labels where issue_id = issues.id and deleted_at is null), '[]'),
    (select cycle_id from cycle_issues where issue_id = issues.id and deleted_at is null limit 1),
    coalesce((select json_group_array(module_id) from module_issues where issue_id = issues.id and deleted_at is null), '[]'),
    '{}', '{}', id, project_id, workspace_id,
    (select id from issue_activities where issue_id = issues.id and project_id = issues.project_id order by id desc limit 1)
    from issues where id = ${issueId} and project_id = ${projectId} and deleted_at is null and changes() = 1`)
}

/** Record a comment mutation only when the immediately preceding update succeeded. */
export function commentActivityStatement(
  db: LancityDb,
  commentId: number | ReturnType<typeof sql<number>>,
  issueId: number,
  projectId: number,
  actorId: number,
  verb: 'created' | 'updated' | 'deleted',
  oldValue: string | null,
  newValue: string | null,
  mutationId: string | null = null
) {
  return db.insert(issueActivities).select(sql`select
    null, cast(unixepoch('subsec') * 1000 as integer), cast(unixepoch('subsec') * 1000 as integer), ${actorId}, ${actorId},
    ${verb}, 'comment', ${oldValue}, ${newValue}, ${verb === 'created' ? 'created a comment' : verb === 'updated' ? 'updated a comment' : 'deleted the comment'}, '[]', issue_id, id, project_id, workspace_id,
    ${actorId}, ${verb !== 'deleted' ? commentId : null}, ${verb === 'updated' ? commentId : null}, unixepoch('subsec'), null, ${mutationId}
    from issue_comments where id = ${commentId} and issue_id = ${issueId} and project_id = ${projectId} and changes() = 1`)
}

/** Plane `display_name` of the user (`username`, falling back to the name). */
const displayName = sql`coalesce(u.username, u.name)`

/**
 * Plane `create_issue_activity` runs `track_assignees` when `assignee_ids` is present: one `added assignee ` activity
 * per assignee, plus a subscriber row for each. One statement each, for every id of the JSON array that is linked to the
 * issue. Run them after the statements that rely on `changes() = 1`, because they touch several rows.
 */
export function assigneeActivitiesStatement(
  db: LancityDb,
  issueId: number | ReturnType<typeof sql<number>>,
  actorId: number,
  assigneeIds: number[],
  mutationId: string | null = null
) {
  return db.insert(issueActivities).select(sql`select
    null, cast(unixepoch('subsec') * 1000 as integer), cast(unixepoch('subsec') * 1000 as integer), ${actorId}, ${actorId},
    'updated', 'assignees', '', ${displayName}, 'added assignee ', '[]', i.id, null, i.project_id, i.workspace_id,
    ${actorId}, u.id, null, unixepoch('subsec'), null, ${mutationId}
    from issues i, json_each(${JSON.stringify(assigneeIds)}) je join "user" u on u.id = je.value
    where i.id = ${issueId}
      and exists (select 1 from issue_assignees ia where ia.issue_id = i.id and ia.assignee_id = u.id and ia.deleted_at is null)`)
}

/** Plane subscribes every added assignee to the issue (`IssueSubscriber.bulk_create(..., ignore_conflicts=True)`). */
export function assigneeSubscribersStatement(db: LancityDb, issueId: number | ReturnType<typeof sql<number>>, assigneeIds: number[]) {
  return db
    .insert(issueSubscribers)
    .select(sql`select null, cast(unixepoch('subsec') * 1000 as integer), cast(unixepoch('subsec') * 1000 as integer),
      u.id, u.id, i.id, i.project_id, u.id, i.workspace_id, null
      from issues i, json_each(${JSON.stringify(assigneeIds)}) je join "user" u on u.id = je.value
      where i.id = ${issueId}
        and exists (select 1 from issue_assignees ia where ia.issue_id = i.id and ia.assignee_id = u.id and ia.deleted_at is null)`)
    .onConflictDoNothing()
}

/** `PROJ-12`: the project identifier and sequence of an issue, the value Plane's `track_parent` stores. */
export async function issueIdentifierLabel(db: LancityDb, projectId: number, issueId: number | null | undefined) {
  if (!issueId) return ''
  const [row] = await db.all<{ label: string }>(
    sql`select p.identifier || '-' || i.sequence_id as label from issues i join projects p on p.id = i.project_id
      where i.id = ${issueId} and i.project_id = ${projectId} and i.deleted_at is null`
  )
  return row?.label ?? ''
}

/**
 * Plane `track_estimate_points`: field `estimate_<type>`, old and new values are the point values, and clearing the
 * point is the verb `removed`. Returns null when the new point does not belong to the project (Plane skips it).
 * Plane reads the type from the new point, which crashes on a removal; the old point's type is used then.
 */
export async function estimateActivity(
  db: LancityDb,
  projectId: number,
  oldPointId: number | null,
  newPointId: number | null
) {
  const find = async (id: number | null) => {
    if (id === null) return null
    const [row] = await db.all<{ value: string; type: string }>(
      sql`select ep.value, e.type from estimate_points ep join estimates e on e.id = ep.estimate_id
        where ep.id = ${id} and ep.project_id = ${projectId}`
    )
    return row ?? null
  }
  const [oldPoint, newPoint] = [await find(oldPointId), await find(newPointId)]
  if (newPointId !== null && !newPoint) return null
  const type = (newPoint ?? oldPoint)?.type
  if (!type) return null
  return {
    verb: newPoint ? 'updated' : 'removed',
    field: `estimate_${type}`,
    oldValue: oldPoint?.value ?? null,
    newValue: newPoint?.value ?? null,
    comment: 'updated the estimate point to '
  }
}

/** Plane `track_archive_at`: `manual_archive` on archive, `restore` on restore. */
export function archiveActivityValues(archive: boolean, automation = false) {
  if (!archive) return { oldValue: 'archive', newValue: 'restore', comment: 'has restored the issue' }
  return automation
    ? { oldValue: null, newValue: 'archive', comment: 'Plane has archived the issue' }
    : { oldValue: null, newValue: 'manual_archive', comment: 'Actor has archived the issue' }
}
