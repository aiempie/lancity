import { and, asc, between, eq, gt, inArray, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { user } from '@/db/schema/auth'
import { fileAssets } from '@/db/schema/content'
import {
  issueAssignees,
  issueComments,
  issueLabels,
  issueLinks,
  issueRelations,
  issueSubscribers,
  issues,
  labels,
  states
} from '@/db/schema/issue'
import { cycleIssues, cycles, estimatePoints, moduleIssues, modules } from '@/db/schema/planning'
import { projectMembers, projects } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import { MAX_EXPORT_ISSUES } from '@/server/export/model-rules'
import type { LancityDb } from '@/types/database/schema'
import type { IssueExportRecord } from '@/types/reporting/p3-export-schema'

const PAGE = 500
/** D1 allows 100 bound parameters per statement. */
const ID_CHUNK = 80
const GUEST = 5

export type IssueExportScope = {
  workspaceId: number
  workspaceSlug: string
  /** The member the export runs for; only projects of this member are read. */
  userId: number
  projectIds: number[]
}

/** Projects of the member in the workspace: active membership, project not archived or deleted. */
export async function visibleExportProjects(db: LancityDb, scope: Pick<IssueExportScope, 'workspaceId' | 'userId' | 'projectIds'>) {
  const found: { id: number; name: string; identifier: string; guestViewAllFeatures: boolean; role: number }[] = []
  for (let i = 0; i < scope.projectIds.length; i += ID_CHUNK) {
    found.push(
      ...(await db
        .select({
          id: projects.id,
          name: projects.name,
          identifier: projects.identifier,
          guestViewAllFeatures: projects.guestViewAllFeatures,
          role: projectMembers.role
        })
        .from(projects)
        .innerJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.workspaceId, projects.workspaceId)))
        .where(
          and(
            eq(projects.workspaceId, scope.workspaceId),
            inArray(projects.id, scope.projectIds.slice(i, i + ID_CHUNK)),
            isNull(projects.deletedAt),
            isNull(projects.archivedAt),
            eq(projectMembers.memberId, scope.userId),
            eq(projectMembers.isActive, true),
            isNull(projectMembers.deletedAt)
          )
        ))
    )
  }
  return found.sort((a, b) => a.id - b.id)
}

function groupByIssue<T extends { issueId: number }>(rows: T[]): Map<number, T[]> {
  const map = new Map<number, T[]>()
  for (const row of rows) map.set(row.issueId, [...(map.get(row.issueId) ?? []), row])
  return map
}

/**
 * Load the object graph of `issue_export_task`: all non-deleted issues (like Plane's `Issue.objects`, archived, draft and triage issues are included) the member may see (guests of a project without
 * `guest_view_all_features` only get issues they created) with labels, assignees, subscribers, cycles, modules,
 * links, relations, comments and attachments. Issues are read by id pages and relations by the page's id range,
 * so no statement binds more than a handful of parameters.
 */
export async function loadIssueExportRecords(db: LancityDb, scope: IssueExportScope, onlyProjectId?: number): Promise<IssueExportRecord[]> {
  const parent = alias(issues, 'parent_issue')
  const relIssue = alias(issues, 'rel_issue')
  const relProject = alias(projects, 'rel_project')
  const curIssue = alias(issues, 'cur_issue')
  const actor = alias(user, 'comment_actor')
  const records: IssueExportRecord[] = []
  const visible = (await visibleExportProjects(db, scope)).filter(project => onlyProjectId === undefined || project.id === onlyProjectId)
  for (const project of visible) {
    const ownOnly = project.role <= GUEST && !project.guestViewAllFeatures
    let after = 0
    for (;;) {
      const page = await db
        .select({
          issue: issues,
          stateName: states.name,
          creatorName: user.name,
          estimateValue: estimatePoints.value,
          parentSequence: parent.sequenceId
        })
        .from(issues)
        .leftJoin(states, eq(states.id, issues.stateId))
        .leftJoin(user, eq(user.id, issues.createdById))
        .leftJoin(estimatePoints, eq(estimatePoints.id, issues.estimatePointId))
        .leftJoin(parent, and(eq(parent.id, issues.parentId), isNull(parent.deletedAt)))
        .where(
          and(
            eq(issues.projectId, project.id),
            eq(issues.workspaceId, scope.workspaceId),
            isNull(issues.deletedAt),
            gt(issues.id, after),
            ownOnly ? eq(issues.createdById, scope.userId) : undefined
          )
        )
        .orderBy(asc(issues.id))
        .limit(PAGE)
      if (!page.length) break
      after = page[page.length - 1].issue.id
      if (records.length + page.length > MAX_EXPORT_ISSUES) {
        throw new ServiceError(413, 'EXPORT_TOO_LARGE', `An export holds at most ${MAX_EXPORT_ISSUES} issues. Pick fewer projects.`)
      }
      const [min, max] = [page[0].issue.id, after]
      const [labelRows, assigneeRows, subscriberRows, cycleRows, moduleRows, linkRows, relationRows, relatedRows, commentRows, assetRows] =
        await Promise.all([
          db
            .select({ issueId: issueLabels.issueId, name: labels.name })
            .from(issueLabels)
            .innerJoin(labels, eq(labels.id, issueLabels.labelId))
            .where(and(eq(issueLabels.projectId, project.id), between(issueLabels.issueId, min, max), isNull(issueLabels.deletedAt), isNull(labels.deletedAt)))
            .orderBy(asc(issueLabels.id)),
          db
            .select({ issueId: issueAssignees.issueId, name: user.name })
            .from(issueAssignees)
            .innerJoin(user, eq(user.id, issueAssignees.assigneeId))
            .where(and(eq(issueAssignees.projectId, project.id), between(issueAssignees.issueId, min, max), isNull(issueAssignees.deletedAt)))
            .orderBy(asc(issueAssignees.id)),
          db
            .select({ issueId: issueSubscribers.issueId, name: user.name })
            .from(issueSubscribers)
            .innerJoin(user, eq(user.id, issueSubscribers.subscriberId))
            .where(and(eq(issueSubscribers.projectId, project.id), between(issueSubscribers.issueId, min, max), isNull(issueSubscribers.deletedAt)))
            .orderBy(asc(issueSubscribers.id)),
          db
            .select({
              issueId: cycleIssues.issueId,
              createdAt: cycleIssues.createdAt,
              name: cycles.name,
              startDate: cycles.startDate,
              endDate: cycles.endDate
            })
            .from(cycleIssues)
            .innerJoin(cycles, eq(cycles.id, cycleIssues.cycleId))
            .where(and(eq(cycleIssues.projectId, project.id), between(cycleIssues.issueId, min, max), isNull(cycleIssues.deletedAt), isNull(cycles.deletedAt)))
            .orderBy(asc(cycleIssues.id)),
          db
            .select({ issueId: moduleIssues.issueId, name: modules.name })
            .from(moduleIssues)
            .innerJoin(modules, eq(modules.id, moduleIssues.moduleId))
            .where(and(eq(moduleIssues.projectId, project.id), between(moduleIssues.issueId, min, max), isNull(moduleIssues.deletedAt), isNull(modules.deletedAt)))
            .orderBy(asc(moduleIssues.id)),
          db
            .select({ issueId: issueLinks.issueId, url: issueLinks.url, title: issueLinks.title })
            .from(issueLinks)
            .where(and(eq(issueLinks.projectId, project.id), between(issueLinks.issueId, min, max), isNull(issueLinks.deletedAt)))
            .orderBy(asc(issueLinks.id)),
          db
            .select({
              issueId: issueRelations.issueId,
              relationType: issueRelations.relationType,
              sequenceId: relIssue.sequenceId,
              identifier: relProject.identifier
            })
            .from(issueRelations)
            .innerJoin(relIssue, eq(relIssue.id, issueRelations.relatedIssueId))
            .innerJoin(relProject, eq(relProject.id, relIssue.projectId))
            .where(and(eq(issueRelations.projectId, project.id), between(issueRelations.issueId, min, max), isNull(issueRelations.deletedAt), isNull(relIssue.deletedAt)))
            .orderBy(asc(issueRelations.id)),
          db
            .select({
              issueId: issueRelations.relatedIssueId,
              relationType: issueRelations.relationType,
              sequenceId: relIssue.sequenceId,
              identifier: relProject.identifier
            })
            .from(issueRelations)
            .innerJoin(curIssue, and(eq(curIssue.id, issueRelations.relatedIssueId), eq(curIssue.projectId, project.id)))
            .innerJoin(relIssue, eq(relIssue.id, issueRelations.issueId))
            .innerJoin(relProject, eq(relProject.id, relIssue.projectId))
            .where(and(between(issueRelations.relatedIssueId, min, max), isNull(issueRelations.deletedAt), isNull(relIssue.deletedAt)))
            .orderBy(asc(issueRelations.id)),
          db
            .select({
              issueId: issueComments.issueId,
              commentStripped: issueComments.commentStripped,
              createdAt: issueComments.createdAt,
              actorName: actor.name
            })
            .from(issueComments)
            .leftJoin(actor, eq(actor.id, issueComments.actorId))
            .where(and(eq(issueComments.projectId, project.id), between(issueComments.issueId, min, max), isNull(issueComments.deletedAt)))
            .orderBy(asc(issueComments.createdAt), asc(issueComments.id)),
          db
            .select({ issueId: fileAssets.issueId, id: fileAssets.id })
            .from(fileAssets)
            .where(
              and(
                eq(fileAssets.entityType, 'ISSUE_ATTACHMENT'),
                eq(fileAssets.projectId, project.id),
                between(fileAssets.issueId, min, max),
                eq(fileAssets.isDeleted, false),
                isNull(fileAssets.deletedAt)
              )
            )
            .orderBy(asc(fileAssets.id))
        ])
      const byLabel = groupByIssue(labelRows)
      const byAssignee = groupByIssue(assigneeRows)
      const bySubscriber = groupByIssue(subscriberRows)
      const byCycle = groupByIssue(cycleRows)
      const byModule = groupByIssue(moduleRows)
      const byLink = groupByIssue(linkRows)
      const byRelation = groupByIssue(relationRows)
      const byRelated = groupByIssue(relatedRows)
      const byComment = groupByIssue(commentRows)
      const byAsset = groupByIssue(assetRows.filter((row): row is { issueId: number; id: number } => row.issueId !== null))
      const ref = (sequenceId: number, identifier: string) => ({ sequenceId, project: { identifier } })
      for (const row of page) {
        const { issue } = row
        records.push({
          id: issue.id,
          name: issue.name,
          descriptionStripped: issue.descriptionStripped,
          priority: issue.priority,
          startDate: issue.startDate,
          targetDate: issue.targetDate,
          sequenceId: issue.sequenceId,
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
          completedAt: issue.completedAt,
          archivedAt: issue.archivedAt,
          isDraft: issue.isDraft,
          projectId: project.id,
          workspace: { slug: scope.workspaceSlug },
          project: { id: project.id, name: project.name, identifier: project.identifier },
          state: row.stateName ? { name: row.stateName } : null,
          createdBy: row.creatorName ? { name: row.creatorName } : null,
          estimatePoint: row.estimateValue === null ? null : { value: row.estimateValue },
          parent: row.parentSequence === null ? null : ref(row.parentSequence, project.identifier),
          labels: (byLabel.get(issue.id) ?? []).map(({ name }) => ({ name })),
          assignees: (byAssignee.get(issue.id) ?? []).map(({ name }) => ({ name })),
          subscribers: (bySubscriber.get(issue.id) ?? []).map(({ name }) => ({ name })),
          cycles: (byCycle.get(issue.id) ?? []).map(c => ({
            createdAt: c.createdAt,
            cycle: { name: c.name, startDate: c.startDate, endDate: c.endDate }
          })),
          modules: (byModule.get(issue.id) ?? []).map(({ name }) => ({ name })),
          links: (byLink.get(issue.id) ?? []).map(({ url, title }) => ({ url, title })),
          relations: (byRelation.get(issue.id) ?? []).map(r => ({ relationType: r.relationType, relatedIssue: ref(r.sequenceId, r.identifier) })),
          related: (byRelated.get(issue.id) ?? []).map(r => ({ relationType: r.relationType, issue: ref(r.sequenceId, r.identifier) })),
          comments: (byComment.get(issue.id) ?? []).map(c => ({
            commentStripped: c.commentStripped,
            createdAt: c.createdAt,
            actor: c.actorName ? { name: c.actorName } : null
          })),
          attachmentIds: (byAsset.get(issue.id) ?? []).map(({ id }) => id)
        })
      }
      if (page.length < PAGE) break
    }
  }
  return records
}
