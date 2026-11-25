import { env } from 'cloudflare:workers'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { apiV1Routes, linkto } from '@/data/linkto'
import { getDb } from '@/db/client'
import { getActor } from '@/lib/auth/server-session'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import { getEnv } from '@/server/common/env'
import { ServiceError } from '@/server/common/errors'
import { getClientIp } from '@/server/common/ip-address'
import { rateLimit } from '@/server/common/rate-limit'
import {
  changePublicComment,
  createPublicComment,
  getPublicComment,
  listPublicComments
} from '@/server/public/comments'
import {
  bulkBindPublicAssets,
  createPublicAsset,
  deletePublicAsset,
  getPublicAsset,
  restorePublicAsset,
  updatePublicAsset,
  uploadPublicAssetContent
} from '@/server/public/asset'
import {
  createPublicCommentReaction,
  createPublicIssueReaction,
  createPublicIssueVote,
  deletePublicCommentReaction,
  deletePublicIssueReaction,
  deletePublicIssueVote,
  listPublicCommentReactions,
  listPublicIssueReactions,
  listPublicIssueVotes
} from '@/server/public/engagement'
import { getPublicIssueDetail, getPublicProjectIssues } from '@/server/public/issues'
import {
  createPublicIntakeIssue,
  deletePublicIntakeIssue,
  getPublicIntakeIssue,
  listPublicIntakeIssues,
  updatePublicIntakeIssue
} from '@/server/public/intake'
import {
  getPublicBoardSettings,
  getWorkspaceProjectAnchor,
  listPublicBoardMembers,
  listWorkspaceProjectBoards
} from '@/server/public/project'
import { publicCommentContent } from '@/server/public/board'
import { sanitizeHtml, stripTags } from '@/server/issue/comment-html'
import {
  getPublicBoard,
  getPublicProjectMeta,
  listPublicCycles,
  listPublicIssues,
  listPublicLabels,
  listPublicModules,
  listPublicStates,
  publishProject,
  setPublicationSettings,
  unpublishProject
} from '@/server/public/service'
import type { ApiEnv } from '@/types/api/schema'
import {
  publicCommentInputSchema,
  publicationSettingsSchema,
  publicWorkspaceSlugSchema
} from '@/types/content/p3-public-schema'
import { contentIdSchema, publicBoardAnchorSchema, type ContentWorkerEnv } from '@/types/content/schema'
import type { IssueListQuery } from '@/types/issue/schema'

export const projectPublicationRoutes = new Hono<ApiEnv>()
export const publicRoutes = new Hono<ApiEnv>()

const envSetting = (name: string, fallback: string) =>
  ((getEnv() as unknown as Record<string, unknown>)[name] as string | undefined) || fallback

/** A JSON body that may be absent. Invalid JSON is a 400. */
async function optionalBody(c: Context): Promise<unknown> {
  const text = await c.req.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new ServiceError(400, 'INVALID_JSON', 'Request body must be valid JSON')
  }
}

/** Session is optional on a public board: reads work anonymously, and a signed-in visitor skips the anon throttle. */
publicRoutes.use('*', async (c, next) => {
  if (!c.get('actor')) {
    const actor = await getActor(c.req.raw.headers).catch(() => null)
    if (actor) c.set('actor', actor)
  }
  await next()
})
/** Anonymous throttle per IP. Plane `AnonRateThrottle` is 30/minute; a board page loads several lists at once, so the default is 120/minute. `PUBLIC_ANON_RATE_LIMIT` overrides it. */
publicRoutes.use(
  '*',
  rateLimit({
    rate: () => envSetting('PUBLIC_ANON_RATE_LIMIT', '120/minute'),
    key: c => (c.get('actor') ? null : `public_anon:${getClientIp(c.req.raw) ?? 'unknown'}`)
  })
)
/** Writes of a signed-in visitor are limited per user so one account cannot flood a board. */
publicRoutes.use(
  '*',
  rateLimit({
    rate: () => envSetting('PUBLIC_WRITE_RATE_LIMIT', '30/minute'),
    key: c => (c.req.method === 'GET' || !c.get('actor') ? null : `public_write:${c.get('actor').userId}`)
  })
)

const anchorOf = (c: Context) => parseInput(publicBoardAnchorSchema, c.req.param('anchor'))
const idOf = (c: Context, name: string) => parseInput(contentIdSchema, c.req.param(name))
const bucket = () => (env as unknown as ContentWorkerEnv).ASSET_BUCKET
const publicBase = `${linkto.apiV1}${linkto.apiPublic}`

/** PD-1655: a rich comment is sanitized and its text derived from it; a plain `text` comment is passed through. */
async function commentBody(c: Context) {
  const body = publicCommentContent(await readJson(c, publicCommentInputSchema))
  if (body.comment_html === undefined) return { input: { text: body.text! }, content: undefined }
  const html = sanitizeHtml(body.comment_html)
  return { input: { text: stripTags(html).trim() }, content: { html, json: body.comment_json } }
}

projectPublicationRoutes.post(apiV1Routes.projectPublication, authenticate, async c =>
  c.json(
    await publishProject(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(contentIdSchema, c.req.param('projectId'))
    )
  )
)
projectPublicationRoutes.patch(apiV1Routes.projectPublication, authenticate, async c =>
  c.json(
    await setPublicationSettings(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(contentIdSchema, c.req.param('projectId')),
      await readJson(c, publicationSettingsSchema)
    )
  )
)
projectPublicationRoutes.delete(apiV1Routes.projectPublication, authenticate, async c => {
  await unpublishProject(
    getDb(),
    c.get('actor'),
    c.req.param('slug')!,
    parseInput(contentIdSchema, c.req.param('projectId'))
  )
  return c.body(null, 204)
})
publicRoutes.get(apiV1Routes.publicBoard, async c =>
  c.json(await getPublicBoard(getDb(), parseInput(publicBoardAnchorSchema, c.req.param('anchor'))))
)
publicRoutes.get(apiV1Routes.publicBoardIssues, async c =>
  c.json(await listPublicIssues(getDb(), parseInput(publicBoardAnchorSchema, c.req.param('anchor'))))
)
// Without a query string the board keeps the original flat summary; any query (pagination, filters, grouping,
// ordering) selects the Plane `ProjectIssuesPublicEndpoint` response (PD-1656).
publicRoutes.get(apiV1Routes.publicBoardAnchorIssues, async c =>
  Object.keys(c.req.query()).length
    ? c.json(await getPublicProjectIssues(getDb(), anchorOf(c), c.req.query() as IssueListQuery))
    : c.json(await listPublicIssues(getDb(), anchorOf(c)))
)
publicRoutes.get(apiV1Routes.publicBoardIssue, async c =>
  c.json(await getPublicIssueDetail(getDb(), anchorOf(c), idOf(c, 'issueId')))
)
publicRoutes.get(apiV1Routes.publicBoardComments, async c =>
  c.json(
    await listPublicComments(
      getDb(),
      parseInput(publicBoardAnchorSchema, c.req.param('anchor')),
      parseInput(contentIdSchema, c.req.param('issueId'))
    )
  )
)
publicRoutes.get(apiV1Routes.publicBoardComment, async c =>
  c.json(
    await getPublicComment(
      getDb(),
      parseInput(publicBoardAnchorSchema, c.req.param('anchor')),
      parseInput(contentIdSchema, c.req.param('issueId')),
      parseInput(contentIdSchema, c.req.param('commentId'))
    )
  )
)
publicRoutes.post(apiV1Routes.publicBoardComments, authenticate, async c => {
  const { input, content } = await commentBody(c)
  return c.json(
    await createPublicComment(getDb(), c.get('actor'), anchorOf(c), idOf(c, 'issueId'), input, content),
    201
  )
})
publicRoutes.patch(apiV1Routes.publicBoardComment, authenticate, async c => {
  const { input, content } = await commentBody(c)
  return c.json(
    await changePublicComment(
      getDb(),
      c.get('actor'),
      anchorOf(c),
      idOf(c, 'issueId'),
      idOf(c, 'commentId'),
      input,
      content
    )
  )
})
publicRoutes.delete(apiV1Routes.publicBoardComment, authenticate, async c => {
  await changePublicComment(
    getDb(),
    c.get('actor'),
    parseInput(publicBoardAnchorSchema, c.req.param('anchor')),
    parseInput(contentIdSchema, c.req.param('issueId')),
    parseInput(contentIdSchema, c.req.param('commentId')),
    null
  )
  return c.body(null, 204)
})
publicRoutes.get(apiV1Routes.publicBoardMeta, async c =>
  c.json(await getPublicProjectMeta(getDb(), parseInput(publicBoardAnchorSchema, c.req.param('anchor'))))
)
publicRoutes.get(apiV1Routes.publicBoardStates, async c =>
  c.json(await listPublicStates(getDb(), parseInput(publicBoardAnchorSchema, c.req.param('anchor'))))
)
publicRoutes.get(apiV1Routes.publicBoardLabels, async c =>
  c.json(await listPublicLabels(getDb(), parseInput(publicBoardAnchorSchema, c.req.param('anchor'))))
)
publicRoutes.get(apiV1Routes.publicBoardCycles, async c =>
  c.json(await listPublicCycles(getDb(), parseInput(publicBoardAnchorSchema, c.req.param('anchor'))))
)
publicRoutes.get(apiV1Routes.publicBoardModules, async c =>
  c.json(await listPublicModules(getDb(), parseInput(publicBoardAnchorSchema, c.req.param('anchor'))))
)

// ---------------------------------------------------------------------------------------------------------------
// PD-1634 to PD-1645 (`space/views/base.py`): the mixins are the middleware above (optional session, anon throttle,
// per-user write throttle) and `requireBoard` in every service (anchor and board scope). `handle_exception` is the
// global `handleApiError`; the route params are read with `parseInput` (`workspace_slug`, `project_id`).

/**
 * Paths below the public mount (`linkto.apiPublic`). They have no `linkto` key yet; see the handoff of p3-public.
 */
const boardPaths = {
  settings: apiV1Routes.publicBoardSettings,
  members: apiV1Routes.publicBoardMembers,
  workspaceBoards: apiV1Routes.publicWorkspaceBoards,
  workspaceProjectAnchor: apiV1Routes.publicWorkspaceProjectAnchor,
  issueReactions: apiV1Routes.publicIssueReactions,
  issueReaction: apiV1Routes.publicIssueReaction,
  issueVotes: apiV1Routes.publicIssueVotes,
  commentReactions: apiV1Routes.publicCommentReactions,
  commentReaction: apiV1Routes.publicCommentReaction,
  inboxIssues: apiV1Routes.publicInboxIssues,
  intakeIssues: apiV1Routes.publicIntakeIssues,
  intakeIssue: apiV1Routes.publicIntakeIssue,
  assets: apiV1Routes.publicAssets,
  asset: apiV1Routes.publicAsset,
  assetContent: apiV1Routes.publicAssetContent,
  assetRestore: apiV1Routes.publicAssetRestore,
  assetBulk: apiV1Routes.publicAssetBulk
} as const
export { boardPaths as publicBoardPaths }

publicRoutes.get(boardPaths.settings, async c => c.json(await getPublicBoardSettings(getDb(), anchorOf(c))))
publicRoutes.get(boardPaths.members, async c => c.json(await listPublicBoardMembers(getDb(), anchorOf(c))))
publicRoutes.get(boardPaths.workspaceBoards, async c =>
  c.json(await listWorkspaceProjectBoards(getDb(), parseInput(publicWorkspaceSlugSchema, c.req.param('slug'))))
)
publicRoutes.get(boardPaths.workspaceProjectAnchor, async c =>
  c.json(
    await getWorkspaceProjectAnchor(
      getDb(),
      parseInput(publicWorkspaceSlugSchema, c.req.param('slug')),
      idOf(c, 'projectId')
    )
  )
)

// Reactions and votes. Every write needs a session; reads are public when the board enables the feature.
publicRoutes.get(boardPaths.issueReactions, async c =>
  c.json(await listPublicIssueReactions(getDb(), anchorOf(c), idOf(c, 'issueId')))
)
publicRoutes.post(boardPaths.issueReactions, authenticate, async c =>
  c.json(
    await createPublicIssueReaction(getDb(), c.get('actor'), anchorOf(c), idOf(c, 'issueId'), await optionalBody(c)),
    201
  )
)
publicRoutes.delete(boardPaths.issueReaction, authenticate, async c => {
  await deletePublicIssueReaction(getDb(), c.get('actor'), anchorOf(c), idOf(c, 'issueId'), c.req.param('reactionCode'))
  return c.body(null, 204)
})
publicRoutes.get(boardPaths.commentReactions, async c =>
  c.json(await listPublicCommentReactions(getDb(), anchorOf(c), idOf(c, 'commentId')))
)
publicRoutes.post(boardPaths.commentReactions, authenticate, async c =>
  c.json(
    await createPublicCommentReaction(
      getDb(),
      c.get('actor'),
      anchorOf(c),
      idOf(c, 'commentId'),
      await optionalBody(c)
    ),
    201
  )
)
publicRoutes.delete(boardPaths.commentReaction, authenticate, async c => {
  await deletePublicCommentReaction(
    getDb(),
    c.get('actor'),
    anchorOf(c),
    idOf(c, 'commentId'),
    c.req.param('reactionCode')
  )
  return c.body(null, 204)
})
publicRoutes.get(boardPaths.issueVotes, async c =>
  c.json(await listPublicIssueVotes(getDb(), anchorOf(c), idOf(c, 'issueId')))
)
publicRoutes.post(boardPaths.issueVotes, authenticate, async c =>
  c.json(
    await createPublicIssueVote(getDb(), c.get('actor'), anchorOf(c), idOf(c, 'issueId'), await optionalBody(c)),
    201
  )
)
publicRoutes.delete(boardPaths.issueVotes, authenticate, async c => {
  await deletePublicIssueVote(getDb(), c.get('actor'), anchorOf(c), idOf(c, 'issueId'))
  return c.body(null, 204)
})

// Public intake. All routes need a session (Plane `IsAuthenticated`).
for (const path of [boardPaths.inboxIssues, boardPaths.intakeIssues]) {
  publicRoutes.get(path, authenticate, async c =>
    c.json(await listPublicIntakeIssues(getDb(), c.get('actor'), anchorOf(c), idOf(c, 'intakeId'), c.req.query()))
  )
  publicRoutes.post(path, authenticate, async c =>
    c.json(
      await createPublicIntakeIssue(getDb(), c.get('actor'), anchorOf(c), idOf(c, 'intakeId'), await optionalBody(c))
    )
  )
}
publicRoutes.get(boardPaths.intakeIssue, authenticate, async c =>
  c.json(await getPublicIntakeIssue(getDb(), c.get('actor'), anchorOf(c), idOf(c, 'intakeId'), idOf(c, 'pk')))
)
publicRoutes.patch(boardPaths.intakeIssue, authenticate, async c =>
  c.json(
    await updatePublicIntakeIssue(
      getDb(),
      c.get('actor'),
      anchorOf(c),
      idOf(c, 'intakeId'),
      idOf(c, 'pk'),
      await optionalBody(c)
    )
  )
)
publicRoutes.delete(boardPaths.intakeIssue, authenticate, async c => {
  await deletePublicIntakeIssue(getDb(), c.get('actor'), anchorOf(c), idOf(c, 'intakeId'), idOf(c, 'pk'))
  return c.body(null, 204)
})

// Public assets (comment images in R2). Reading is open; every write needs a session and is limited to own assets.
const assetUrlOf = (anchor: string) => (id: number) =>
  `${publicBase}${boardPaths.asset.replace(':anchor', anchor).replace(':pk', String(id))}`
const contentUrlOf = (anchor: string) => (id: number) => `${assetUrlOf(anchor)(id)}/content`
const createAsset = async (c: Context) => {
  const anchor = anchorOf(c)
  return c.json(
    await createPublicAsset(
      getDb(),
      c.get('actor'),
      anchor,
      await optionalBody(c),
      contentUrlOf(anchor),
      assetUrlOf(anchor)
    )
  )
}
publicRoutes.post(boardPaths.assets, authenticate, createAsset)
// Plane also routes `POST .../<pk>/` to the same create handler; the pk is ignored.
publicRoutes.post(boardPaths.asset, authenticate, createAsset)
publicRoutes.get(boardPaths.asset, async c =>
  getPublicAsset(getDb(), bucket(), c.get('actor') ?? null, anchorOf(c), idOf(c, 'pk'))
)
publicRoutes.put(boardPaths.assetContent, authenticate, async c =>
  c.json(await uploadPublicAssetContent(getDb(), bucket(), c.get('actor'), anchorOf(c), idOf(c, 'pk'), c.req.raw))
)
publicRoutes.patch(boardPaths.asset, authenticate, async c => {
  await updatePublicAsset(getDb(), bucket(), c.get('actor'), anchorOf(c), idOf(c, 'pk'), await optionalBody(c))
  return c.body(null, 204)
})
publicRoutes.delete(boardPaths.asset, authenticate, async c => {
  await deletePublicAsset(getDb(), c.get('actor'), anchorOf(c), idOf(c, 'pk'))
  return c.body(null, 204)
})
publicRoutes.post(boardPaths.assetRestore, authenticate, async c => {
  await restorePublicAsset(getDb(), c.get('actor'), anchorOf(c), idOf(c, 'pk'))
  return c.body(null, 204)
})
publicRoutes.post(boardPaths.assetBulk, authenticate, async c => {
  await bulkBindPublicAssets(getDb(), c.get('actor'), anchorOf(c), idOf(c, 'entityId'), await optionalBody(c))
  return c.body(null, 204)
})
