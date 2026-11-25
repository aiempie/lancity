import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { states } from '@/db/schema/issue'
import { stripTags } from '@/server/issue/sequence'
import type { LancityDb } from '@/types/database/schema'

const SORT_ORDER_STEP = 10000
const DEFAULT_SORT_ORDER = 65535

/**
 * Port of `DraftIssue.save` (PD-1390). Without a state the project's default non-triage state is used, then its first
 * non-triage state. With a state, `completed_at` follows the state group. `completedAt` is `undefined` when the
 * row keeps its value (the fallback-state branch of Plane does not touch it).
 */
export async function saveDraftIssue(
  db: LancityDb,
  input: { projectId: number | null; stateId: number | null; descriptionHtml: string | null }
) {
  let stateId = input.stateId
  let completedAt: Date | null | undefined
  if (stateId === null) {
    if (input.projectId !== null) {
      const live = and(eq(states.projectId, input.projectId), eq(states.isTriage, false), isNull(states.deletedAt))
      const order = [asc(states.sequence), asc(states.id)] as const
      const [fallback] = await db
        .select({ id: states.id })
        .from(states)
        .where(and(live, eq(states.default, true)))
        .orderBy(...order)
        .limit(1)
      const [any] = fallback
        ? [fallback]
        : await db
            .select({ id: states.id })
            .from(states)
            .where(live)
            .orderBy(...order)
            .limit(1)
      stateId = any?.id ?? null
    }
  } else {
    const [state] = await db.select({ group: states.group }).from(states).where(eq(states.id, stateId))
    completedAt = state?.group === 'completed' ? new Date() : null
  }
  return { stateId, completedAt, descriptionStripped: stripTags(input.descriptionHtml) }
}

/** Plane appends a new draft 10000 after the largest `sort_order` of the same project and state. */
export function draftSortOrderSql(projectId: number | null, stateId: number | null) {
  return sql<number>`coalesce((select max(sort_order) + ${SORT_ORDER_STEP} from draft_issues where project_id is ${projectId} and state_id is ${stateId} and deleted_at is null), ${DEFAULT_SORT_ORDER})`
}
