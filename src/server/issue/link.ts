import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { issueLinks } from '@/db/schema/issue'
import { ServiceError } from '@/server/common/errors'
import { ISSUE_JOB } from '@/server/issue/activity/index'
import { issueEventStatement, issueEventBody, publishIssueEvent } from '@/server/issue/events'
import { activityStatement } from '@/server/issue/jobs/history'
import { getIssue, writableProject } from '@/server/issue/service'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import {
  createIssueLinkSchema,
  updateIssueLinkSchema,
  type CreateIssueLinkInput,
  type UpdateIssueLinkInput
} from '@/types/issue/schema'
import { parseInput } from '@/server/api/v1/validation'

/** Job that fetches the page title and favicon of a link (Plane `crawl_work_item_link_title`). */
export const CRAWL_LINK_TITLE_JOB = ISSUE_JOB.linkCrawl
async function queueTitleCrawl(linkId: number, url: string) {
  try {
    // Lazy imports keep this module loadable outside a Worker (`cloudflare:workers`).
    const [{ enqueueJob }, { getEnv }] = await Promise.all([import('@/server/common/jobs'), import('@/server/common/env')])
    await enqueueJob(getEnv(), { type: CRAWL_LINK_TITLE_JOB, payload: { id: linkId, url } })
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        label: 'issue link crawl enqueue',
        linkId,
        message: error instanceof Error ? error.message : String(error)
      })
    )
  }
}
function liveIssue(issueId: number, projectId: number) {
  return sql`exists (select 1 from issues where id = ${issueId} and project_id = ${projectId} and deleted_at is null and archived_at is null and is_draft = 0)`
}
export async function listIssueLinks(db: LancityDb, actor: Actor, slug: string, projectId: number, issueId: number) {
  await getIssue(db, actor, slug, projectId, issueId)
  return db
    .select()
    .from(issueLinks)
    .where(and(eq(issueLinks.issueId, issueId), eq(issueLinks.projectId, projectId), isNull(issueLinks.deletedAt)))
    .orderBy(desc(issueLinks.id))
}
export async function getIssueLink(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  linkId: number
) {
  await getIssue(db, actor, slug, projectId, issueId)
  const [link] = await db
    .select()
    .from(issueLinks)
    .where(
      and(
        eq(issueLinks.id, linkId),
        eq(issueLinks.issueId, issueId),
        eq(issueLinks.projectId, projectId),
        isNull(issueLinks.deletedAt)
      )
    )
  if (!link) throw new ServiceError(404, 'LINK_NOT_FOUND', 'Issue link not found')
  return link
}
export async function createIssueLink(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  raw: CreateIssueLinkInput
) {
  const input = parseInput(createIssueLinkSchema, raw)
  await requireProjectAccess(db, actor, slug, projectId, 15)
  await getIssue(db, actor, slug, projectId, issueId)
  const insert = db
    .insert(issueLinks)
    .select(
      sql`select null, cast(unixepoch('subsec') * 1000 as integer), cast(unixepoch('subsec') * 1000 as integer), ${actor.userId}, ${actor.userId}, ${input.title ?? null}, ${input.url}, id, project_id, workspace_id, '{}', null from issues where id = ${issueId} and project_id = ${projectId} and ${writableProject(actor, slug, projectId)} and ${liveIssue(issueId, projectId)} and not exists (select 1 from issue_links l where l.issue_id = ${issueId} and l.url = ${input.url} and l.deleted_at is null)`
    )
    .returning()
  const mutationId = crypto.randomUUID()
  const event = { type: 'link.activity.created', issueId, projectId, actorId: actor.userId,
    requestedData: { id: 0, url: input.url }, currentInstance: null, webhook: false }
  const activity = activityStatement(
    db,
    issueId,
    projectId,
    actor.userId,
    'created',
    'link',
    null,
    input.url,
    'created a link',
    null,
    sql<number>`last_insert_rowid()` as unknown as number,
    false,
    mutationId
  )
  const [created] = await db.batch([insert, activity, issueEventStatement(db, mutationId, event,
    sql`json_set(${JSON.stringify(issueEventBody(event, mutationId))}, '$.requestedData.id', (select new_identifier from issue_activities where mutation_id = ${mutationId} limit 1))`)])
  if (!created.length) throw new ServiceError(409, 'LINK_CONFLICT', 'Link exists or permissions changed')
  await queueTitleCrawl(created[0].id, created[0].url)
  await publishIssueEvent(db, mutationId)
  return created[0]
}
export async function updateIssueLink(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  linkId: number,
  raw: UpdateIssueLinkInput
) {
  const input = parseInput(updateIssueLinkSchema, raw)
  await requireProjectAccess(db, actor, slug, projectId, 15)
  const old = await getIssueLink(db, actor, slug, projectId, issueId, linkId)
  if ((input.url === undefined || input.url === old.url) && (input.title === undefined || input.title === old.title))
    return old
  const update = db
    .update(issueLinks)
    .set({
      ...input,
      updatedById: actor.userId,
      updatedAt: sql`max(${issueLinks.updatedAt} + 1, cast(unixepoch('subsec') * 1000 as integer))`
    })
    .where(
      and(
        eq(issueLinks.id, linkId),
        eq(issueLinks.issueId, issueId),
        eq(issueLinks.projectId, projectId),
        isNull(issueLinks.deletedAt),
        eq(issueLinks.updatedAt, old.updatedAt),
        writableProject(actor, slug, projectId),
        liveIssue(issueId, projectId),
        input.url
          ? sql`not exists (select 1 from issue_links l where l.issue_id = ${issueId} and l.url = ${input.url} and l.id != ${linkId} and l.deleted_at is null)`
          : undefined
      )
    )
    .returning()
  const mutationId = crypto.randomUUID()
  const event = { type: 'link.activity.updated', issueId, projectId, actorId: actor.userId,
    requestedData: { url: input.url }, currentInstance: { id: linkId, url: old.url }, webhook: false }
  const [result] =
    input.url && input.url !== old.url
      ? await db.batch([
          update,
          activityStatement(
            db,
            issueId,
            projectId,
            actor.userId,
            'updated',
            'link',
            old.url,
            input.url,
            'updated a link',
            linkId,
            linkId,
            false,
            mutationId
          ),
          issueEventStatement(db, mutationId, event)
        ])
      : [await update]
  if (!result.length) throw new ServiceError(409, 'LINK_CONFLICT', 'Link exists or changed; reload and try again')
  if (input.url && input.url !== old.url) {
    await queueTitleCrawl(linkId, input.url)
    await publishIssueEvent(db, mutationId)
  }
  return result[0]
}
export async function deleteIssueLink(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  issueId: number,
  linkId: number
) {
  await requireProjectAccess(db, actor, slug, projectId, 15)
  const old = await getIssueLink(db, actor, slug, projectId, issueId, linkId)
  const remove = db
    .update(issueLinks)
    .set({ deletedAt: new Date(), updatedById: actor.userId })
    .where(
      and(
        eq(issueLinks.id, linkId),
        eq(issueLinks.issueId, issueId),
        eq(issueLinks.projectId, projectId),
        isNull(issueLinks.deletedAt),
        eq(issueLinks.updatedAt, old.updatedAt),
        writableProject(actor, slug, projectId),
        liveIssue(issueId, projectId)
      )
    )
    .returning({ id: issueLinks.id })
  const mutationId = crypto.randomUUID()
  const event = { type: 'link.activity.deleted', issueId, projectId, actorId: actor.userId,
    requestedData: { link_id: String(linkId) }, currentInstance: { id: linkId, url: old.url }, webhook: false }
  const [result] = await db.batch([
    remove,
    activityStatement(db, issueId, projectId, actor.userId, 'deleted', 'link', old.url, '', 'deleted the link', null, null, false, mutationId),
    issueEventStatement(db, mutationId, event)
  ])
  if (!result.length) throw new ServiceError(409, 'LINK_CONFLICT', 'Link or permissions changed')
  await publishIssueEvent(db, mutationId)
}
