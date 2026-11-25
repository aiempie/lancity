import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { issueMentions } from '@/db/schema/issue'
import type { BatchItem } from 'drizzle-orm/batch'
import { nowMs, runBatch } from '@/server/issue/collab-access'
import type { LancityDb } from '@/types/database/schema'

const mentionTag = /<mention-component\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi
const attribute = /([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g

/**
 * Port of `extract_mentions` / `extract_comment_mentions`: user ids found in
 * `<mention-component entity_name="user_mention" entity_identifier="...">`, without duplicates.
 */
export function extractMentions(html: string | null | undefined): number[] {
  if (!html) return []
  const found = new Set<number>()
  for (const tag of html.matchAll(mentionTag)) {
    const attrs: Record<string, string> = {}
    for (const pair of tag[1].matchAll(attribute)) attrs[pair[1].toLowerCase()] = pair[2] ?? pair[3] ?? pair[4]
    const id = Number(attrs.entity_identifier)
    if (attrs.entity_name === 'user_mention' && Number.isSafeInteger(id) && id > 0) found.add(id)
  }
  return [...found]
}

/** Port of `get_new_mentions`, `get_removed_mentions` and `get_new_comment_mentions`. */
export function diffMentions(newHtml: string | null | undefined, oldHtml: string | null | undefined) {
  const newer = extractMentions(newHtml)
  const older = new Set(extractMentions(oldHtml))
  const current = new Set(newer)
  return { all: newer, added: newer.filter(id => !older.has(id)), removed: [...older].filter(id => !current.has(id)) }
}

type IssueScope = { issueId: number; projectId: number; workspaceId: number }

/** Port of `update_mentions_for_issue`: record new mentions of active project members and soft-delete removed ones. */
export async function syncIssueMentions(
  db: LancityDb,
  scope: IssueScope,
  actorId: number,
  newHtml: string | null | undefined,
  oldHtml: string | null | undefined
) {
  const { added, removed } = diffMentions(newHtml, oldHtml)
  const statements: BatchItem<'sqlite'>[] = []
  if (added.length)
    statements.push(
      db
        .insert(issueMentions)
        .select(
          sql`select null, ${nowMs}, ${nowMs}, ${actorId}, ${actorId}, ${scope.issueId}, pm.member_id, ${scope.projectId}, ${scope.workspaceId}, null
          from project_members pm
          where pm.project_id = ${scope.projectId} and pm.is_active = 1 and pm.deleted_at is null
            and pm.member_id in (select value from json_each(${JSON.stringify(added)}))
            and not exists (select 1 from issue_mentions m where m.issue_id = ${scope.issueId} and m.mention_id = pm.member_id and m.deleted_at is null)`
        )
        .onConflictDoNothing()
    )
  if (removed.length)
    statements.push(
      db
        .update(issueMentions)
        .set({ deletedAt: new Date(), updatedById: actorId })
        .where(
          and(
            eq(issueMentions.issueId, scope.issueId),
            inArray(issueMentions.mentionId, removed),
            isNull(issueMentions.deletedAt)
          )
        )
    )
  if (statements.length) await runBatch(db, statements)
  return { added, removed }
}
