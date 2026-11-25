import { sql, type SQL } from 'drizzle-orm'
import type { LancityDb } from '@/types/database/schema'

const NOW_MS = sql`cast(unixepoch('subsec') * 1000 as integer)`

/**
 * Owner of a synced version: updated_by, else created_by, else a project admin (role 20).
 * Plane `get_owner_id` in issue_version_sync.py and issue_description_version_sync.py.
 */
export function ownerIdSql(alias = 'i'): SQL {
  const a = sql.raw(alias)
  return sql`coalesce(${a}.updated_by_id, ${a}.created_by_id,
    (select member_id from project_members where project_id = ${a}.project_id and role = 20 and deleted_at is null and member_id is not null limit 1))`
}

/** Resolve the owner of one issue, or null when nobody qualifies. */
export async function getOwnerId(db: LancityDb, issueId: number): Promise<number | null> {
  const rows = await db.all<{ owner: number | null }>(
    sql`select ${ownerIdSql()} as owner from issues i where i.id = ${issueId}`
  )
  return rows[0]?.owner ?? null
}

/** Live relations of an issue as the `issue_versions` JSON columns (Plane `get_related_data`). */
const relatedColumns = sql`
  coalesce((select json_group_array(assignee_id) from issue_assignees where issue_id = i.id and deleted_at is null), '[]'),
  coalesce((select json_group_array(label_id) from issue_labels where issue_id = i.id and deleted_at is null), '[]'),
  (select cycle_id from cycle_issues where issue_id = i.id and deleted_at is null order by id limit 1),
  coalesce((select json_group_array(module_id) from module_issues where issue_id = i.id and deleted_at is null), '[]')`

const versionColumns = sql.raw(
  `created_at, updated_at, created_by_id, updated_by_id, parent, state, estimate_point, name, priority, start_date,
   target_date, sequence_id, sort_order, completed_at, archived_at, is_draft, external_source, external_id, type,
   last_saved_at, owned_by_id, assignees, labels, cycle, modules, properties, meta, issue_id, project_id, workspace_id, activity_id`
)

/** `insert ... select` of full issue snapshots. `where` is evaluated against `issues i`. Returns inserted ids. */
async function insertVersions(db: LancityDb, owner: SQL, createdBy: SQL, updatedBy: SQL, where: SQL) {
  const rows = await db.all<{ id: number }>(sql`insert into issue_versions (${versionColumns})
    select ${NOW_MS}, ${NOW_MS}, ${createdBy}, ${updatedBy}, i.parent_id, i.state_id, i.estimate_point_id, i.name, i.priority,
      i.start_date, i.target_date, i.sequence_id, i.sort_order, i.completed_at, i.archived_at, i.is_draft, i.external_source,
      i.external_id, i.type_id, ${NOW_MS}, ${owner}, ${relatedColumns}, '{}', '{}', i.id, i.project_id, i.workspace_id,
      (select id from issue_activities where issue_id = i.id order by id desc limit 1)
    from issues i where i.deleted_at is null and ${where} returning id`)
  return rows.map(row => row.id)
}

/** Plane `IssueVersion.log_issue_version`: snapshot one issue for `userId`. Returns the version id or null. */
export async function logIssueVersion(db: LancityDb, issueId: number, userId: number): Promise<number | null> {
  const ids = await insertVersions(db, sql`${userId}`, sql`${userId}`, sql`${userId}`, sql`i.id = ${issueId}`)
  return ids[0] ?? null
}

/**
 * Backfill one window of issues (ordered by created_at, id) that have no version yet.
 * Rows whose owner cannot be resolved are skipped, like Plane. Returns the number of versions created.
 */
export async function backfillIssueVersions(db: LancityDb, batchSize: number, offset: number): Promise<number> {
  const owner = ownerIdSql()
  const ids = await insertVersions(
    db,
    owner,
    sql`i.created_by_id`,
    sql`i.updated_by_id`,
    sql`i.id in (select id from issues where deleted_at is null order by created_at, id limit ${batchSize} offset ${offset})
      and not exists (select 1 from issue_versions v where v.issue_id = i.id) and ${owner} is not null`
  )
  return ids.length
}

/** Plane `IssueDescriptionVersion.log_issue_description_version`. */
export async function logIssueDescriptionVersion(
  db: LancityDb,
  issueId: number,
  userId: number
): Promise<number | null> {
  const rows = await db.all<{ id: number }>(descriptionInsert(sql`${userId}`, sql`i.id = ${issueId}`))
  return rows[0]?.id ?? null
}

/** Backfill one window of issues without a description version. */
export async function backfillDescriptionVersions(db: LancityDb, batchSize: number, offset: number): Promise<number> {
  const owner = ownerIdSql()
  const rows = await db.all<{ id: number }>(
    descriptionInsert(
      owner,
      sql`i.id in (select id from issues where deleted_at is null order by created_at, id limit ${batchSize} offset ${offset})
        and not exists (select 1 from issue_description_versions v where v.issue_id = i.id) and ${owner} is not null`
    )
  )
  return rows.length
}

function descriptionInsert(owner: SQL, where: SQL): SQL {
  return sql`insert into issue_description_versions (created_at, updated_at, created_by_id, updated_by_id, owned_by_id, last_saved_at,
      issue_id, project_id, workspace_id, description_binary, description_html, description_stripped, description_json)
    select ${NOW_MS}, ${NOW_MS}, i.created_by_id, i.updated_by_id, ${owner}, ${NOW_MS}, i.id, i.project_id, i.workspace_id,
      i.description_binary, i.description_html, i.description_stripped, i.description_json
    from issues i where i.deleted_at is null and ${where} returning id`
}

/** Count live issues (the window total used by the backfill jobs). */
export async function countLiveIssues(db: LancityDb): Promise<number> {
  const rows = await db.all<{ n: number }>(sql`select count(*) as n from issues where deleted_at is null`)
  return rows[0]?.n ?? 0
}
