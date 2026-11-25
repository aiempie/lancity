import { sql } from 'drizzle-orm'
import { ServiceError } from '@/server/common/errors'
import { validateHtmlContent } from '@/server/page/content-validator'

/** Largest integer a JavaScript client can represent exactly. A project that reaches it can no longer create issues. */
export const MAX_SEQUENCE = 9007199254740991
const DEFAULT_SORT_ORDER = 65535
const SORT_ORDER_STEP = 10000

/**
 * Next sequence for a project. It takes the largest of the counter, the live issues and every historical
 * reservation, so a missing or stale counter repairs itself. It evaluates to NULL at the limit, and the NOT NULL
 * constraint of the target column aborts the whole D1 batch (port of the `Issue.save` sequence lock, PD-1418).
 */
export function nextSequenceSql(projectId: number) {
  const largest = sql`max(
    coalesce((select last_sequence from project_issue_counters where project_id = ${projectId}), 0),
    coalesce((select max(sequence_id) from issues where project_id = ${projectId}), 0),
    coalesce((select max(sequence) from issue_sequences where project_id = ${projectId}), 0)
  )`
  return sql<number>`case when ${largest} < ${MAX_SEQUENCE} then ${largest} + 1 else null end`
}

/** Sequence reserved by the counter statement of the same batch. */
export function currentSequenceSql(projectId: number) {
  return sql<number>`(select last_sequence from project_issue_counters where project_id = ${projectId})`
}

/** Id of the issue inserted by the same batch for the reserved sequence. */
export function createdIssueIdSql(projectId: number) {
  return sql<number>`(select id from issues where project_id = ${projectId} and sequence_id = ${currentSequenceSql(projectId)})`
}

/** Plane appends a new issue 10000 after the largest `sort_order` of the same project and state. */
export function newIssueSortOrderSql(projectId: number, stateId: number | null) {
  return sql<number>`coalesce((select max(sort_order) + ${SORT_ORDER_STEP} from issues where project_id = ${projectId} and state_id is ${stateId} and deleted_at is null), ${DEFAULT_SORT_ORDER})`
}

/** Sort order for a new label or state: 10000 (label) or 15000 (state) after the project's largest value. */
export function nextAfterMaxSql(table: 'labels' | 'states', projectId: number) {
  const column = table === 'labels' ? sql.raw('sort_order') : sql.raw('sequence')
  const step = table === 'labels' ? SORT_ORDER_STEP : 15000
  const live = table === 'states' ? sql`deleted_at is null and is_triage = 0` : sql`deleted_at is null`
  return sql<number>`coalesce((select max(${column}) + ${step} from ${sql.raw(table)} where project_id = ${projectId} and ${live}), ${DEFAULT_SORT_ORDER})`
}

/** Remove HTML tags the way Django `strip_tags` does for `description_stripped`. */
export function stripTags(html: string | null | undefined): string | null {
  if (html === null || html === undefined || html === '') return null
  return html
    .replace(/<[^>]*>/g, '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
}

/**
 * Port of the serializer step `validate_html_content` (PD-1715): returns the sanitized description HTML, or the input
 * unchanged when it is empty/undefined (Plane keeps the original value then). Throws 400 `INVALID_HTML` for oversized
 * or unsanitizable content. Callers must store the returned value, not the input.
 */
export function sanitizeDescriptionHtml<T extends string | null | undefined>(html: T): T | string {
  if (!html) return html
  const result = validateHtmlContent(html)
  if (!result.isValid) throw new ServiceError(400, 'INVALID_HTML', 'html content is not valid')
  return result.cleanHtml ?? html
}

/**
 * Safety net for callers that still store the raw input: rejects markup that can run script. New code must call
 * `sanitizeDescriptionHtml` and store its result instead; this check does not clean anything.
 */
export function assertSafeDescriptionHtml(html: string | undefined): void {
  if (!html) return
  sanitizeDescriptionHtml(html)
  if (/<\s*(script|iframe|object|embed|style|link|meta)\b|\son\w+\s*=|javascript:/i.test(html))
    throw new ServiceError(400, 'INVALID_HTML', 'html content is not valid')
}
