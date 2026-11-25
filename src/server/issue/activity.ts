import { and, desc, eq, gt, isNull, lt, notInArray, or } from 'drizzle-orm'
import { user } from '@/db/schema/auth'
import { intakeIssues } from '@/db/schema/planning'
import { issueActivities } from '@/db/schema/issue'
import { parseInput } from '@/server/api/v1/validation'
import { ServiceError } from '@/server/common/errors'
import { collabIssue, parsePage } from '@/server/issue/collab-access'
import { listIssueComments } from '@/server/issue/comment'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import { collabPageQuerySchema, issueHistoryQuerySchema } from '@/types/issue/collab-schema'

/** Fields Plane keeps out of the property activity feed because they have their own feeds. */
const hiddenFields = ['comment', 'vote', 'reaction', 'draft']
const visibleField = or(isNull(issueActivities.field), notInArray(issueActivities.field, hiddenFields))
const actorDetail = { id: user.id, name: user.name, username: user.username, image: user.image }

function activityRows(db: LancityDb, filter: ReturnType<typeof and>) {
  return db
    .select({
      activity: issueActivities,
      actorDetail,
      intakeSource: intakeIssues.source,
      intakeExtra: intakeIssues.extra
    })
    .from(issueActivities)
    .leftJoin(user, eq(user.id, issueActivities.actorId))
    .leftJoin(intakeIssues, and(eq(intakeIssues.issueId, issueActivities.issueId), isNull(intakeIssues.deletedAt)))
    .where(filter)
}
/** `IssueActivitySerializer.get_source_data`: intake origin of the issue, when it came from intake. */
function presentActivity(row: Awaited<ReturnType<typeof activityRows>>[number]) {
  return {
    ...row.activity,
    actorDetail: row.actorDetail,
    sourceData: row.intakeSource ? { source: row.intakeSource, extra: row.intakeExtra } : null
  }
}

/**
 * `IssueActivityEndpoint.get`: property activity and comments of one issue, oldest first.
 * `activity_type` restricts the feed to `issue-property` or `issue-comment`.
 */
export async function listIssueHistory(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  rawQuery: Record<string, string | undefined> = {}
) {
  const query = parseInput(issueHistoryQuerySchema, rawQuery)
  await collabIssue(db, actor, slug, projectId, issueId, { includeArchived: true })
  const after = query.created_at__gt
  const activities =
    query.activity_type === 'issue-comment'
      ? []
      : (
          await activityRows(
            db,
            and(
              eq(issueActivities.issueId, issueId),
              eq(issueActivities.projectId, projectId),
              isNull(issueActivities.deletedAt),
              visibleField,
              after ? gt(issueActivities.createdAt, after) : undefined
            )
          ).orderBy(issueActivities.createdAt, issueActivities.id)
        ).map(presentActivity)
  if (query.activity_type === 'issue-property') return activities
  const comments = (await listIssueComments(db, actor, slug, projectId, issueId)).filter(
    comment => !after || comment.createdAt.getTime() > after.getTime()
  )
  if (query.activity_type === 'issue-comment') return comments
  return [...activities, ...comments].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

/** `IssueActivityListAPIEndpoint.get`: newest first, cursor is the id of the last row of the previous page. */
export async function listIssueActivitiesPage(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  rawQuery: Record<string, string | undefined> = {}
) {
  const query = parseInput(collabPageQuerySchema, rawQuery)
  await collabIssue(db, actor, slug, projectId, issueId, { includeArchived: true, hideFromGuest: true })
  const perPage = query.per_page ?? 100
  const rows = await activityRows(
    db,
    and(
      eq(issueActivities.issueId, issueId),
      eq(issueActivities.projectId, projectId),
      isNull(issueActivities.deletedAt),
      query.cursor ? lt(issueActivities.id, query.cursor) : undefined
    )
  )
    .orderBy(desc(issueActivities.id))
    .limit(perPage + 1)
  const page = parsePage(
    rows.map(row => ({ ...presentActivity(row), id: row.activity.id })),
    perPage
  )
  return page
}

/** `IssueActivityDetailAPIEndpoint.get`. */
export async function getIssueActivity(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  activityId: number
) {
  await collabIssue(db, actor, slug, projectId, issueId, { includeArchived: true, hideFromGuest: true })
  const [row] = await activityRows(
    db,
    and(
      eq(issueActivities.id, activityId),
      eq(issueActivities.issueId, issueId),
      eq(issueActivities.projectId, projectId),
      isNull(issueActivities.deletedAt)
    )
  ).limit(1)
  if (!row) throw new ServiceError(404, 'ACTIVITY_NOT_FOUND', 'Activity not found')
  return presentActivity(row)
}

export * from '@/server/issue/activity/index'
