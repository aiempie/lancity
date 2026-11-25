import { sql } from 'drizzle-orm'
import { linkto } from '@/data/linkto'
import { ServiceError } from '@/server/common/errors'
import { issueGroupValues as scopedGroupValues } from '@/server/issue/filter'
import type { PublicBoard } from '@/server/public/board'
import type { LancityDb } from '@/types/database/schema'

const CHUNK = 80 // D1 allows 100 bind parameters per statement

/**
 * PD-1623 `issue_queryset_grouper`: Plane annotates the queryset with `label_ids`, `assignee_ids` and `module_ids`.
 * `paginateIssues` of the issue service already selects those columns and builds the group joins, so only the
 * request validation is kept here.
 */
export function issueQuerysetGrouper(query: { group_by?: string; sub_group_by?: string }) {
  const groupBy = query.group_by || null
  const subGroupBy = groupBy ? query.sub_group_by || null : null
  if (groupBy && groupBy === subGroupBy)
    throw new ServiceError(400, 'INVALID_GROUP_BY', 'Group by and sub group by cannot have same parameters')
  return { groupBy, subGroupBy }
}

/** PD-1625 `issue_group_values`, fixed to the board project so a board never lists values of another project. */
export function issueGroupValues(db: LancityDb, board: PublicBoard, field: string, baseWhere = sql`1 = 1`) {
  return scopedGroupValues(db, field, board.workspaceSlug, board.projectId, baseWhere, { publicBoard: true })
}

type Row = {
  issue_id: number
  actor: number
  name: string
  username: string | null
  image: string | null
  asset: number | null
}

/** Public author data of a vote or reaction (Plane `actor_details`). Never includes the email. */
function actorDetails(row: Row) {
  return {
    id: row.actor,
    firstName: row.name,
    lastName: '',
    displayName: row.username ?? row.name,
    avatar: row.image,
    avatarUrl: row.asset ? `${linkto.apiV1}/assets/static/${row.asset}` : row.image
  }
}

/** Votes and reactions of the given issues, as `vote_items` and `reaction_items` of `issue_on_results`. */
async function engagement(db: LancityDb, issueIds: number[]) {
  const votes = new Map<number, unknown[]>()
  const reactions = new Map<number, unknown[]>()
  for (let i = 0; i < issueIds.length; i += CHUNK) {
    const ids = sql.join(
      issueIds.slice(i, i + CHUNK).map(id => sql`${id}`),
      sql`, `
    )
    const [voteRows, reactionRows] = await Promise.all([
      db.all<
        Row & { vote: number }
      >(sql`select v.issue_id, v.vote, v.actor_id as actor, u.name, u.username, u.image, p.avatar_asset_id as asset
        from issue_votes v join "user" u on u.id = v.actor_id left join profiles p on p.user_id = u.id
        where v.issue_id in (${ids}) and v.deleted_at is null order by v.id`),
      db.all<
        Row & { reaction: string }
      >(sql`select r.issue_id, r.reaction, r.actor_id as actor, u.name, u.username, u.image, p.avatar_asset_id as asset
        from issue_reactions r join "user" u on u.id = r.actor_id left join profiles p on p.user_id = u.id
        where r.issue_id in (${ids}) and r.deleted_at is null order by r.id`)
    ])
    for (const row of voteRows)
      votes.set(row.issue_id, [...(votes.get(row.issue_id) ?? []), { vote: row.vote, actorDetails: actorDetails(row) }])
    for (const row of reactionRows)
      reactions.set(row.issue_id, [
        ...(reactions.get(row.issue_id) ?? []),
        { reaction: row.reaction, actorDetails: actorDetails(row) }
      ])
  }
  return { votes, reactions }
}

/** Issue objects of a flat, grouped or sub-grouped result. */
function collectIssues(node: unknown, out: Record<string, unknown>[]) {
  if (Array.isArray(node)) for (const item of node) collectIssues(item, out)
  else if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>
    if (typeof record.id === 'number' && 'sequenceId' in record) out.push(record)
    else for (const value of Object.values(record)) collectIssues(value, out)
  }
}

/**
 * PD-1624 `issue_on_results`: the row shape of the issue service plus `voteItems` and `reactionItems`. Internal
 * columns that a visitor does not need are dropped. Mutates and returns `results`.
 */
export async function issueOnResults<T>(db: LancityDb, results: T): Promise<T> {
  const issues: Record<string, unknown>[] = []
  collectIssues(results, issues)
  const { votes, reactions } = await engagement(
    db,
    issues.map(issue => issue.id as number)
  )
  for (const issue of issues) {
    for (const key of ['updatedBy', 'archivedAt', 'isDraft']) delete issue[key]
    issue.voteItems = votes.get(issue.id as number) ?? []
    issue.reactionItems = reactions.get(issue.id as number) ?? []
  }
  return results
}
