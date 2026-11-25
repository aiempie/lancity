import { apiV1Routes } from '@/data/linkto'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import { getEnv } from '@/server/common/env'
import { getIssueActivity, listIssueActivitiesPage, listIssueHistory } from '@/server/issue/activity'
import {
  confirmIssueAttachment,
  createIssueAttachment,
  deleteIssueAttachment,
  downloadIssueAttachment,
  listIssueAttachments,
  uploadIssueAttachmentContent
} from '@/server/issue/attachment'
import {
  createCommentReaction,
  createIssueComment,
  deleteCommentReaction,
  deleteIssueComment,
  getIssueComment,
  listCommentReactions,
  listIssueComments,
  updateIssueComment
} from '@/server/issue/comment'
import { createIssueRelations } from '@/server/issue/relation'
import { createIssueReaction, deleteIssueReaction, listIssueReactions } from '@/server/issue/reaction'
import {
  getDescriptionVersion,
  getIssueVersion,
  listDescriptionVersionsPage,
  listIssueVersionsPage
} from '@/server/issue/version'
import { getIssueVotes, removeIssueVote, voteOnIssue } from '@/server/issue/vote'
import type { ApiEnv } from '@/types/api/schema'
import {
  createAttachmentSchema,
  createRichCommentSchema,
  issueRelationCreateExtSchema,
  issueVoteInputSchema,
  reactionCodeParamSchema,
  reactionInputSchema,
  updateRichCommentSchema
} from '@/types/issue/collab-schema'
import { issueIdParamSchema } from '@/types/issue/schema'

/**
 * Paths relative to the project mount (`linkto.apiProject`). Keep them in sync with the
 * `apiV1Routes` keys listed in docs/plane-demo-porting/handoff/p1-issue-collab.md.
 */
export const issueCollabPaths = {
  comments: apiV1Routes.comments,
  comment: apiV1Routes.comment,
  commentReactions: apiV1Routes.commentReactions,
  commentReaction: apiV1Routes.commentReaction,
  issueReactions: apiV1Routes.issueReactions,
  issueReaction: apiV1Routes.issueReaction,
  issueVotes: apiV1Routes.issueVotes,
  issueRelations: apiV1Routes.issueRelations,
  attachments: apiV1Routes.attachments,
  attachment: apiV1Routes.attachment,
  attachmentContent: apiV1Routes.attachmentContent,
  issueHistory: apiV1Routes.issueHistory,
  activitiesPage: apiV1Routes.activitiesPage,
  activityEntry: apiV1Routes.activityEntry,
  versionsPage: apiV1Routes.versionsPage,
  versionEntry: apiV1Routes.versionEntry,
  descriptionVersions: apiV1Routes.descriptionVersions,
  descriptionVersion: apiV1Routes.descriptionVersion
} as const

export const issueCollabRoutes = new Hono<ApiEnv>()
issueCollabRoutes.use('*', authenticate)

function scope(c: Context<ApiEnv>) {
  return {
    db: getDb(),
    actor: c.get('actor'),
    slug: c.req.param('slug')!,
    projectId: parseInput(issueIdParamSchema, c.req.param('projectId'))
  }
}
function id(c: Context<ApiEnv>, name: string) {
  return parseInput(issueIdParamSchema, c.req.param(name))
}

// Comments
issueCollabRoutes.get(issueCollabPaths.comments, async c => {
  const { db, actor, slug, projectId } = scope(c)
  return c.json(await listIssueComments(db, actor, slug, projectId, id(c, 'issueId')))
})
issueCollabRoutes.post(issueCollabPaths.comments, async c => {
  const { db, actor, slug, projectId } = scope(c)
  const body = await readJson(c, createRichCommentSchema)
  return c.json(await createIssueComment(db, actor, slug, projectId, id(c, 'issueId'), body), 201)
})
issueCollabRoutes.get(issueCollabPaths.comment, async c => {
  const { db, actor, slug, projectId } = scope(c)
  return c.json(await getIssueComment(db, actor, slug, projectId, id(c, 'issueId'), id(c, 'commentId')))
})
issueCollabRoutes.patch(issueCollabPaths.comment, async c => {
  const { db, actor, slug, projectId } = scope(c)
  const body = await readJson(c, updateRichCommentSchema)
  return c.json(await updateIssueComment(db, actor, slug, projectId, id(c, 'issueId'), id(c, 'commentId'), body))
})
issueCollabRoutes.delete(issueCollabPaths.comment, async c => {
  const { db, actor, slug, projectId } = scope(c)
  await deleteIssueComment(db, actor, slug, projectId, id(c, 'issueId'), id(c, 'commentId'))
  return c.body(null, 204)
})

// Comment reactions
issueCollabRoutes.get(issueCollabPaths.commentReactions, async c => {
  const { db, actor, slug, projectId } = scope(c)
  return c.json(await listCommentReactions(db, actor, slug, projectId, id(c, 'commentId')))
})
issueCollabRoutes.post(issueCollabPaths.commentReactions, async c => {
  const { db, actor, slug, projectId } = scope(c)
  const body = await readJson(c, reactionInputSchema)
  return c.json(await createCommentReaction(db, actor, slug, projectId, id(c, 'commentId'), body), 201)
})
issueCollabRoutes.delete(issueCollabPaths.commentReaction, async c => {
  const { db, actor, slug, projectId } = scope(c)
  const code = parseInput(reactionCodeParamSchema, c.req.param('reactionCode'))
  await deleteCommentReaction(db, actor, slug, projectId, id(c, 'commentId'), code)
  return c.body(null, 204)
})

// Issue reactions
issueCollabRoutes.get(issueCollabPaths.issueReactions, async c => {
  const { db, actor, slug, projectId } = scope(c)
  return c.json(await listIssueReactions(db, actor, slug, projectId, id(c, 'issueId')))
})
issueCollabRoutes.post(issueCollabPaths.issueReactions, async c => {
  const { db, actor, slug, projectId } = scope(c)
  const body = await readJson(c, reactionInputSchema)
  return c.json(await createIssueReaction(db, actor, slug, projectId, id(c, 'issueId'), body), 201)
})
issueCollabRoutes.delete(issueCollabPaths.issueReaction, async c => {
  const { db, actor, slug, projectId } = scope(c)
  const code = parseInput(reactionCodeParamSchema, c.req.param('reactionCode'))
  await deleteIssueReaction(db, actor, slug, projectId, id(c, 'issueId'), code)
  return c.body(null, 204)
})

// Votes
issueCollabRoutes.get(issueCollabPaths.issueVotes, async c => {
  const { db, actor, slug, projectId } = scope(c)
  return c.json(await getIssueVotes(db, actor, slug, projectId, id(c, 'issueId')))
})
issueCollabRoutes.post(issueCollabPaths.issueVotes, async c => {
  const { db, actor, slug, projectId } = scope(c)
  const body = await readJson(c, issueVoteInputSchema)
  return c.json(await voteOnIssue(db, actor, slug, projectId, id(c, 'issueId'), body), 201)
})
issueCollabRoutes.delete(issueCollabPaths.issueVotes, async c => {
  const { db, actor, slug, projectId } = scope(c)
  return c.json(await removeIssueVote(db, actor, slug, projectId, id(c, 'issueId')))
})

// Relations: accepts `implements` and `implemented_by` in addition to the types of issues.ts
issueCollabRoutes.post(issueCollabPaths.issueRelations, async c => {
  const { db, actor, slug, projectId } = scope(c)
  const body = await readJson(c, issueRelationCreateExtSchema)
  return c.json(await createIssueRelations(db, actor, slug, projectId, id(c, 'issueId'), body), 201)
})

// Attachments (R2)
issueCollabRoutes.get(issueCollabPaths.attachments, async c => {
  const { db, actor, slug, projectId } = scope(c)
  const base = new URL(c.req.url).pathname
  const rows = await listIssueAttachments(db, actor, slug, projectId, id(c, 'issueId'))
  return c.json(rows.map(row => ({ ...row, assetUrl: `${base}/${row.id}` })))
})
issueCollabRoutes.post(issueCollabPaths.attachments, async c => {
  const { db, actor, slug, projectId } = scope(c)
  const body = await readJson(c, createAttachmentSchema)
  const attachment = await createIssueAttachment(db, actor, slug, projectId, id(c, 'issueId'), body)
  const assetUrl = `${new URL(c.req.url).pathname}/${attachment.id}`
  return c.json({ uploadUrl: `${assetUrl}/content`, assetId: attachment.id, attachment, assetUrl }, 201)
})
issueCollabRoutes.put(issueCollabPaths.attachmentContent, async c => {
  const { db, actor, slug, projectId } = scope(c)
  const result = await uploadIssueAttachmentContent(
    db,
    getEnv().ASSET_BUCKET,
    actor,
    slug,
    projectId,
    id(c, 'issueId'),
    id(c, 'attachmentId'),
    c.req.raw
  )
  return c.json(result)
})
issueCollabRoutes.get(issueCollabPaths.attachment, async c => {
  const { db, actor, slug, projectId } = scope(c)
  const { object, name, type } = await downloadIssueAttachment(
    db,
    getEnv().ASSET_BUCKET,
    actor,
    slug,
    projectId,
    id(c, 'issueId'),
    id(c, 'attachmentId')
  )
  return new Response(object.body, {
    headers: {
      'content-type': type,
      'content-length': String(object.size),
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'x-content-type-options': 'nosniff'
    }
  })
})
issueCollabRoutes.patch(issueCollabPaths.attachment, async c => {
  const { db, actor, slug, projectId } = scope(c)
  const raw: unknown = await c.req.json().catch(() => ({}))
  await confirmIssueAttachment(
    db,
    getEnv().ASSET_BUCKET,
    actor,
    slug,
    projectId,
    id(c, 'issueId'),
    id(c, 'attachmentId'),
    raw
  )
  return c.body(null, 204)
})
issueCollabRoutes.delete(issueCollabPaths.attachment, async c => {
  const { db, actor, slug, projectId } = scope(c)
  await deleteIssueAttachment(
    db,
    getEnv().ASSET_BUCKET,
    actor,
    slug,
    projectId,
    id(c, 'issueId'),
    id(c, 'attachmentId')
  )
  return c.body(null, 204)
})

// Activity feed, versions and description versions (read only). Static `/page` routes come before `/:id`.
issueCollabRoutes.get(issueCollabPaths.issueHistory, async c => {
  const { db, actor, slug, projectId } = scope(c)
  return c.json(await listIssueHistory(db, actor, slug, projectId, id(c, 'issueId'), c.req.query()))
})
issueCollabRoutes.get(issueCollabPaths.activitiesPage, async c => {
  const { db, actor, slug, projectId } = scope(c)
  return c.json(await listIssueActivitiesPage(db, actor, slug, projectId, id(c, 'issueId'), c.req.query()))
})
issueCollabRoutes.get(issueCollabPaths.activityEntry, async c => {
  const { db, actor, slug, projectId } = scope(c)
  return c.json(await getIssueActivity(db, actor, slug, projectId, id(c, 'issueId'), id(c, 'activityId')))
})
issueCollabRoutes.get(issueCollabPaths.versionsPage, async c => {
  const { db, actor, slug, projectId } = scope(c)
  return c.json(await listIssueVersionsPage(db, actor, slug, projectId, id(c, 'issueId'), c.req.query()))
})
issueCollabRoutes.get(issueCollabPaths.versionEntry, async c => {
  const { db, actor, slug, projectId } = scope(c)
  return c.json(await getIssueVersion(db, actor, slug, projectId, id(c, 'issueId'), id(c, 'versionId')))
})
issueCollabRoutes.get(issueCollabPaths.descriptionVersions, async c => {
  const { db, actor, slug, projectId } = scope(c)
  return c.json(await listDescriptionVersionsPage(db, actor, slug, projectId, id(c, 'issueId'), c.req.query()))
})
issueCollabRoutes.get(issueCollabPaths.descriptionVersion, async c => {
  const { db, actor, slug, projectId } = scope(c)
  return c.json(await getDescriptionVersion(db, actor, slug, projectId, id(c, 'issueId'), id(c, 'versionId')))
})

export default issueCollabRoutes
