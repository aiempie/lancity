import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm'
import { issueRelations, issues } from '@/db/schema/issue'
import { workspaces } from '@/db/schema/workspace'
import { parseInput } from '@/server/api/v1/validation'
import { ServiceError } from '@/server/common/errors'
import { outboxStatement } from '@/server/common/outbox'
import { ISSUE_ACTIVITY_JOB, issueEventBody, issueEventStatement, publishIssueEvent } from '@/server/issue/events'
import { activityStatement } from '@/server/issue/jobs/history'
import { getIssue, writableProject } from '@/server/issue/service'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import { issueRelationCreateExtSchema, type IssueRelationCreateExt } from '@/types/issue/collab-schema'
import { getActualRelation, getInverseRelation, reversedRelationTypes } from '@/server/issue/issue-relation-mapper'

/** Port of `issue_in_project`: the issue must live in the URL workspace and project. */
export async function issueInProject(
  db: LancityDb,
  slug: string,
  projectId: number,
  issueId: number,
  includeArchived = false
) {
  const [row] = await db
    .select({ id: issues.id })
    .from(issues)
    .innerJoin(workspaces, eq(workspaces.id, issues.workspaceId))
    .where(
      and(
        eq(issues.id, issueId),
        eq(issues.projectId, projectId),
        eq(workspaces.slug, slug),
        isNull(issues.deletedAt),
        eq(issues.isDraft, false),
        includeArchived ? undefined : isNull(issues.archivedAt)
      )
    )
    .limit(1)
  return Boolean(row)
}
/** Resolve only within the caller's workspace and apply the target project's visibility rules. */
async function visibleIssue(db: LancityDb, actor: Actor, slug: string, workspaceId: number, issueId: number) {
  const [target] = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.id, issueId), readableTarget(actor, slug, workspaceId, issueId)))
    .limit(1)
  if (!target) throw new ServiceError(404, 'ISSUE_NOT_FOUND', 'Issue not found')
}
function readableTarget(actor: Actor, slug: string, workspaceId: number, issueId: number | SQL) {
  return sql`exists (select 1 from issues i join projects p on p.id = i.project_id and p.workspace_id = i.workspace_id
    join workspaces w on w.id = p.workspace_id
    join workspace_members wm on wm.workspace_id = w.id and wm.member_id = ${actor.userId}
    join project_members pm on pm.project_id = p.id and pm.workspace_id = w.id and pm.member_id = ${actor.userId}
    where i.id = ${issueId} and i.workspace_id = ${workspaceId} and w.slug = ${slug}
      and i.deleted_at is null and i.archived_at is null and i.is_draft = 0
      and p.deleted_at is null and p.archived_at is null and w.deleted_at is null
      and wm.is_active = 1 and wm.deleted_at is null and pm.is_active = 1 and pm.deleted_at is null
      and not exists (select 1 from states s where s.id = i.state_id and (s."group" = 'triage' or s.is_triage = 1))
      and (wm.role = 20 or pm.role >= 15 or p.guest_view_all_features = 1 or i.created_by_id = ${actor.userId}))`
}

export async function listIssueRelations(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number
) {
  const source = await getIssue(db, actor, slug, projectId, issueId)
  await visibleIssue(db, actor, slug, source.workspaceId, issueId)
  const otherIssueId = sql`case when ${issueRelations.issueId} = ${issueId}
    then ${issueRelations.relatedIssueId} else ${issueRelations.issueId} end`
  const rows = await db
    .select({
      relationType: issueRelations.relationType,
      sourceId: issueRelations.issueId,
      issue: {
        id: issues.id,
        name: issues.name,
        project_id: issues.projectId,
        sequence_id: issues.sequenceId,
        state_id: issues.stateId,
        priority: issues.priority,
        sort_order: issues.sortOrder,
        created_at: issues.createdAt,
        updated_at: issues.updatedAt,
        created_by: issues.createdById,
        updated_by: issues.updatedById,
        label_ids: sql<string>`coalesce((select json_group_array(label_id) from issue_labels where issue_id = ${issues.id} and deleted_at is null), '[]')`,
        assignee_ids: sql<string>`coalesce((select json_group_array(assignee_id) from issue_assignees where issue_id = ${issues.id} and deleted_at is null), '[]')`
      }
    })
    .from(issueRelations)
    .innerJoin(issues, and(eq(issues.id, otherIssueId), eq(issues.workspaceId, issueRelations.workspaceId)))
    .where(
      and(
        eq(issueRelations.workspaceId, source.workspaceId),
        or(eq(issueRelations.issueId, issueId), eq(issueRelations.relatedIssueId, issueId)),
        isNull(issueRelations.deletedAt),
        readableTarget(actor, slug, source.workspaceId, sql`${issues.id}`)
      )
    )
    .orderBy(issueRelations.id)
  const result: Record<
    string,
    Array<{
      id: number
      name: string
      project_id: number
      sequence_id: number
      state_id: number | null
      priority: string
      sort_order: number
      created_at: Date
      updated_at: Date
      created_by: number | null
      updated_by: number | null
      label_ids: number[]
      assignee_ids: number[]
      relation_type: string
    }>
  > = {
    blocking: [],
    blocked_by: [],
    duplicate: [],
    relates_to: [],
    start_after: [],
    start_before: [],
    finish_after: [],
    finish_before: [],
    implements: [],
    implemented_by: []
  }
  for (const row of rows) {
    const key = row.sourceId === issueId ? row.relationType : getInverseRelation(row.relationType)
    if (result[key])
      result[key].push({
        ...row.issue,
        label_ids: JSON.parse(row.issue.label_ids),
        assignee_ids: JSON.parse(row.issue.assignee_ids),
        relation_type: key
      })
  }
  return result
}
export async function createIssueRelations(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  raw: IssueRelationCreateExt
) {
  const input = parseInput(issueRelationCreateExtSchema, raw)
  await requireProjectAccess(db, actor, slug, projectId, 15)
  const issue = await getIssue(db, actor, slug, projectId, issueId)
  await visibleIssue(db, actor, slug, issue.workspaceId, issueId)
  for (const id of input.issues) {
    if (id === issueId) throw new ServiceError(400, 'INVALID_RELATION', 'An issue cannot relate to itself')
    await visibleIssue(db, actor, slug, issue.workspaceId, id)
  }
  const allTargetsVisible = sql`not exists (select 1 from json_each(${JSON.stringify(input.issues)}) target
    where not ${readableTarget(actor, slug, issue.workspaceId, sql`target.value`)})`
  const sourceVisible = readableTarget(actor, slug, issue.workspaceId, issueId)
  const mutationId = crypto.randomUUID()
  const statements = input.issues.flatMap(id => {
    const a = reversedRelationTypes.has(input.relation_type) ? id : issueId
    const b = reversedRelationTypes.has(input.relation_type) ? issueId : id
    const relation = getActualRelation(input.relation_type)
    const insert = db
      .insert(issueRelations)
      .select(
        sql`select null, cast(unixepoch('subsec') * 1000 as integer), cast(unixepoch('subsec') * 1000 as integer), ${actor.userId}, ${actor.userId}, ${relation}, ${a}, ${projectId}, ${b}, ${issue.workspaceId}, null where ${writableProject(actor, slug, projectId)} and ${sourceVisible} and ${allTargetsVisible} and not exists (select 1 from issue_relations r where r.workspace_id = ${issue.workspaceId} and r.deleted_at is null and ((r.issue_id = ${a} and r.related_issue_id = ${b}) or (r.issue_id = ${b} and r.related_issue_id = ${a})))`
      )
      .onConflictDoNothing()
      .returning()
    return [
      insert,
      activityStatement(
        db,
        issueId,
        projectId,
        actor.userId,
        'created',
        'relation',
        null,
        String(id),
        'created an issue relation',
        null,
        null,
        false,
        mutationId
      )
    ]
  })
  const [first, ...rest] = statements
  if (!first) return []
  const event = issueEventBody({
    type: 'issue_relation.activity.created',
    issueId,
    projectId,
    actorId: actor.userId,
    requestedData: { relation_type: input.relation_type, issues: input.issues },
    currentInstance: null,
    webhook: false
  }, mutationId)
  const results = await db.batch([
    first,
    ...rest,
    outboxStatement(db, mutationId, ISSUE_ACTIVITY_JOB, event, sql`exists (
      select 1 from issue_activities where issue_id = ${issueId} and mutation_id = ${mutationId}
    )`)
  ])
  const inserted = results.slice(0, statements.length).flatMap((result, index) => (index % 2 === 0 && Array.isArray(result) ? result : []))
  if (!inserted.length) {
    await requireProjectAccess(db, actor, slug, projectId, 15)
    await visibleIssue(db, actor, slug, issue.workspaceId, issueId)
    for (const id of input.issues) await visibleIssue(db, actor, slug, issue.workspaceId, id)
  }
  if (inserted.length) await publishIssueEvent(db, mutationId)
  return inserted
}
export async function removeIssueRelation(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  relatedId: number
) {
  await requireProjectAccess(db, actor, slug, projectId, 15)
  const source = await getIssue(db, actor, slug, projectId, issueId)
  await visibleIssue(db, actor, slug, source.workspaceId, issueId)
  await visibleIssue(db, actor, slug, source.workspaceId, relatedId)
  const [existing] = await db
    .select({ id: issueRelations.id })
    .from(issueRelations)
    .where(
      and(
        eq(issueRelations.workspaceId, source.workspaceId),
        isNull(issueRelations.deletedAt),
        or(
          and(eq(issueRelations.issueId, issueId), eq(issueRelations.relatedIssueId, relatedId)),
          and(eq(issueRelations.issueId, relatedId), eq(issueRelations.relatedIssueId, issueId))
        )
      )
    )
    .limit(1)
  if (!existing) throw new ServiceError(404, 'RELATION_NOT_FOUND', 'Issue relation not found')
  const mutationId = crypto.randomUUID()
  const remove = db
    .update(issueRelations)
    .set({ deletedAt: new Date(), updatedById: actor.userId })
    .where(
      and(
        eq(issueRelations.id, existing.id),
        isNull(issueRelations.deletedAt),
        writableProject(actor, slug, projectId),
        readableTarget(actor, slug, source.workspaceId, issueId),
        readableTarget(actor, slug, source.workspaceId, relatedId)
      )
    )
    .returning({ id: issueRelations.id })
  const [removed] = await db.batch([
    remove,
    activityStatement(
      db,
      issueId,
      projectId,
      actor.userId,
      'deleted',
      'relation',
      String(relatedId),
      null,
      'deleted an issue relation',
      null,
      null,
      false,
      mutationId
    ),
    issueEventStatement(db, mutationId, {
      type: 'issue_relation.activity.deleted',
      issueId,
      projectId,
      actorId: actor.userId,
      requestedData: { related_issue: relatedId },
      currentInstance: null,
      webhook: false
    })
  ])
  if (!removed.length) throw new ServiceError(409, 'RELATION_CONFLICT', 'Issue relation or permissions changed')
  await publishIssueEvent(db, mutationId)
}
