import { sql } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { listIssueLinks, getIssueLink, createIssueLink, updateIssueLink, deleteIssueLink } from '@/server/issue/link'
import { listIssueRelations, removeIssueRelation } from '@/server/issue/relation'
import {
  listIssueSubscribers,
  issueSubscriptionStatus,
  addIssueSubscriber,
  removeIssueSubscriber
} from '@/server/issue/subscriber'
import { apiV1Routes } from '@/data/linkto'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import {
  archiveIssue,
  bulkArchiveIssues,
  bulkDeleteIssues,
  bulkUpdateIssueDates,
  getIssueArchive,
  listIssueArchives,
  unarchiveIssue
} from '@/server/issue/archive'
import { bulkCreateIssueLabels, deleteLabel, getLabel, getWorkspaceLabels, updateLabel } from '@/server/issue/label'
import {
  deletedIssuesList,
  getIssueById,
  getIssueByIdentifier,
  getIssueDetail,
  getIssueList,
  getIssueMeta,
  paginateIssues,
  issueListContext,
  listIssuesPaginated,
  searchWorkspaceIssues
} from '@/server/issue/list'
import { presentIssueApi, presentIssueApiList } from '@/server/issue/issue-presenters'
import { getProjectUserDisplayProperty, updateProjectUserDisplayProperty } from '@/server/issue/properties'
import {
  deleteState,
  getIntakeState,
  getState,
  getWorkspaceStates,
  listStatesGrouped,
  markAsDefaultState,
  updateState
} from '@/server/issue/state'
import { createSubIssues, getSubIssues } from '@/server/issue/sub-issue'
import {
  createIssue,
  listIssues,
  upsertIssueByExternalId,
  updateIssue,
  deleteIssue,
  listIssueActivities,
  listIssueVersions,
  listStates,
  createState,
  listLabels,
  createLabel,
  changeIssueRelation
} from '@/server/issue/service'
import type { ApiEnv } from '@/types/api/schema'
import type { Actor } from '@/types/auth/schema'
import {
  bulkCreateLabelsInputSchema,
  externalIssueInputSchema,
  bulkIssueIdsInputSchema,
  bulkUpdateDatesInputSchema,
  projectUserPropertyInputSchema,
  subIssuesInputSchema,
  updateLabelInputSchema,
  updateStateInputSchema,
  createIssueInputSchema,
  updateIssueInputSchema,
  createStateInputSchema,
  createLabelInputSchema,
  issueIdParamSchema,
  issueRelationInputSchema,
  createIssueLinkSchema,
  updateIssueLinkSchema,
  issueRelationRemoveSchema,
  issueSubscriberInputSchema
} from '@/types/issue/schema'

export const issuesRoutes = new Hono<ApiEnv>()
issuesRoutes.use('*', authenticate)

/**
 * Paths of the routes added for the Plane issue port, relative to the project mount. They belong in
 * `apiV1Routes` (src/data/linkto.ts); kept here until the integrator adds the keys (see the handoff).
 */
const coreRoutes = {
  issuesList: apiV1Routes.issuesList,
  issuesDetail: apiV1Routes.issuesDetail,
  issuesPaginated: apiV1Routes.issuesPaginated,
  issueMeta: apiV1Routes.issueMeta,
  issueArchive: apiV1Routes.issueArchive,
  archivedIssues: apiV1Routes.archivedIssues,
  bulkArchive: apiV1Routes.bulkArchive,
  bulkDelete: apiV1Routes.bulkDelete,
  deletedIssues: apiV1Routes.deletedIssues,
  issueDates: apiV1Routes.issueDates,
  userProperties: apiV1Routes.userProperties,
  subIssues: apiV1Routes.subIssues,
  state: apiV1Routes.state,
  stateDefault: apiV1Routes.stateDefault,
  intakeState: apiV1Routes.intakeState,
  label: apiV1Routes.label,
  issueLabelsList: apiV1Routes.issueLabelsList,
  issueLabelItem: apiV1Routes.issueLabelItem,
  bulkCreateLabels: apiV1Routes.bulkCreateLabels
}
/** Workspace-level routes, mounted at `linkto.apiWorkspace`. */
const workspaceCoreRoutes = {
  states: apiV1Routes.states,
  labels: apiV1Routes.labels,
  issueSearch: apiV1Routes.workspaceIssueSearch,
  issueIdentifier: apiV1Routes.workspaceIssueIdentifier,
  workItemIdentifier: apiV1Routes.workspaceWorkItemIdentifier
}

const projectOf = (c: Context) => parseInput(issueIdParamSchema, c.req.param('projectId'))
const idOf = (c: Context, name: string) => parseInput(issueIdParamSchema, c.req.param(name))
const scope = (c: Context) => [getDb(), c.get('actor') as Actor, c.req.param('slug')!, projectOf(c)] as const

/** Routes that must be registered before `/issues/:issueId`, or the id parser would reject their literal segment. */
issuesRoutes.get(coreRoutes.issuesList, async c => c.json(await getIssueList(...scope(c), c.req.query())))
issuesRoutes.get(coreRoutes.issuesDetail, async c => c.json(await getIssueDetail(...scope(c), c.req.query())))
issuesRoutes.get(coreRoutes.issuesPaginated, async c => c.json(await listIssuesPaginated(...scope(c), c.req.query())))
issuesRoutes.get(apiV1Routes.issues, async c => {
  const query = c.req.query()
  const [db, actor, slug, projectId] = scope(c)
  // Public API lookup of one issue by its external id.
  if (query.external_id && query.external_source) {
    const [row] = await db.all<{ id: number }>(sql`select id from issues where project_id = ${projectId}
      and external_id = ${query.external_id} and external_source = ${query.external_source} and deleted_at is null limit 1`)
    if (!row) return c.json({ error: { code: 'ISSUE_NOT_FOUND', message: 'Issue not found' } }, 404)
    return c.json(await presentIssueApi(db, await getIssueById(db, actor, slug, projectId, row.id), query))
  }
  if (query.pql || query.filters)
    return c.json(
      { error: { code: 'UNSUPPORTED_FILTER', message: 'PQL and structured filters are not supported', details: ['pql', 'filters'] } },
      400
    )
  // Without any query string the original flat array is kept for existing clients.
  if (!Object.keys(query).length) return c.json(await presentIssueApiList(db, await listIssues(db, actor, slug, projectId), query))
  const page = await paginateIssues(db, await issueListContext(db, actor, slug, projectId), query)
  // `?fields=` and `?expand=` shape the items of a flat page. Grouped pages keep their nested shape.
  if ((query.fields || query.expand) && Array.isArray(page.results))
    return c.json({ ...page, results: await presentIssueApiList(db, page.results as Array<Record<string, unknown>>, query) })
  return c.json(page)
})
issuesRoutes.put(apiV1Routes.issues, async c => {
  const result = await upsertIssueByExternalId(...scope(c), await readJson(c, externalIssueInputSchema))
  return c.json(await presentIssueApi(getDb(), result.issue, c.req.query()), result.created ? 201 : 200)
})
issuesRoutes.put(apiV1Routes.issue, async c =>
  c.json(
    await presentIssueApi(
      getDb(),
      await updateIssue(...scope(c), idOf(c, 'issueId'), await readJson(c, updateIssueInputSchema)),
      c.req.query()
    )
  )
)
issuesRoutes.get(coreRoutes.issueMeta, async c => c.json(await getIssueMeta(...scope(c), idOf(c, 'issueId'))))
issuesRoutes.get(coreRoutes.issueArchive, async c => c.json(await getIssueArchive(...scope(c), idOf(c, 'issueId'))))
issuesRoutes.post(coreRoutes.issueArchive, async c => c.json(await archiveIssue(...scope(c), idOf(c, 'issueId'))))
issuesRoutes.delete(coreRoutes.issueArchive, async c => {
  await unarchiveIssue(...scope(c), idOf(c, 'issueId'))
  return c.body(null, 204)
})
issuesRoutes.get(coreRoutes.archivedIssues, async c => c.json(await listIssueArchives(...scope(c), c.req.query())))
issuesRoutes.post(coreRoutes.bulkArchive, async c =>
  c.json(await bulkArchiveIssues(...scope(c), await readJson(c, bulkIssueIdsInputSchema)))
)
issuesRoutes.delete(coreRoutes.bulkDelete, async c =>
  c.json(await bulkDeleteIssues(...scope(c), await readJson(c, bulkIssueIdsInputSchema)))
)
issuesRoutes.get(coreRoutes.deletedIssues, async c => c.json(await deletedIssuesList(...scope(c), c.req.query())))
issuesRoutes.post(coreRoutes.issueDates, async c =>
  c.json(await bulkUpdateIssueDates(...scope(c), await readJson(c, bulkUpdateDatesInputSchema)))
)
issuesRoutes.get(coreRoutes.userProperties, async c => c.json(await getProjectUserDisplayProperty(...scope(c))))
issuesRoutes.patch(coreRoutes.userProperties, async c =>
  c.json(await updateProjectUserDisplayProperty(...scope(c), await readJson(c, projectUserPropertyInputSchema)))
)
issuesRoutes.get(coreRoutes.subIssues, async c =>
  c.json(await getSubIssues(...scope(c), idOf(c, 'issueId'), c.req.query()))
)
issuesRoutes.post(coreRoutes.subIssues, async c =>
  c.json(await createSubIssues(...scope(c), idOf(c, 'issueId'), await readJson(c, subIssuesInputSchema)))
)

issuesRoutes.get(apiV1Routes.states, async c => {
  const args = scope(c)
  return c.json(c.req.query('grouped') === 'true' ? await listStatesGrouped(...args) : await listStates(...args))
})
issuesRoutes.get(coreRoutes.intakeState, async c => c.json(await getIntakeState(...scope(c))))
issuesRoutes.get(coreRoutes.state, async c => c.json(await getState(...scope(c), idOf(c, 'stateId'))))
issuesRoutes.patch(coreRoutes.state, async c =>
  c.json(await updateState(...scope(c), idOf(c, 'stateId'), await readJson(c, updateStateInputSchema)))
)
issuesRoutes.post(coreRoutes.stateDefault, async c => {
  await markAsDefaultState(...scope(c), idOf(c, 'stateId'))
  return c.body(null, 204)
})
issuesRoutes.delete(coreRoutes.state, async c => {
  await deleteState(...scope(c), idOf(c, 'stateId'))
  return c.body(null, 204)
})

/** `/labels` is the public API path and `/issue-labels` the app API path of the same resource. */
issuesRoutes.get(coreRoutes.issueLabelsList, async c => c.json(await listLabels(...scope(c))))
issuesRoutes.post(coreRoutes.issueLabelsList, async c =>
  c.json(await createLabel(...scope(c), await readJson(c, createLabelInputSchema)), 201)
)
for (const item of [coreRoutes.label, coreRoutes.issueLabelItem]) {
  issuesRoutes.get(item, async c => c.json(await getLabel(...scope(c), idOf(c, 'labelId'))))
  issuesRoutes.patch(item, async c =>
    c.json(await updateLabel(...scope(c), idOf(c, 'labelId'), await readJson(c, updateLabelInputSchema)))
  )
  issuesRoutes.delete(item, async c => {
    await deleteLabel(...scope(c), idOf(c, 'labelId'))
    return c.body(null, 204)
  })
}
issuesRoutes.post(coreRoutes.bulkCreateLabels, async c =>
  c.json(await bulkCreateIssueLabels(...scope(c), await readJson(c, bulkCreateLabelsInputSchema)), 201)
)

/** Workspace-level issue routes. Mount at `linkto.apiWorkspace`. */
export const issuesWorkspaceRoutes = new Hono<ApiEnv>()
issuesWorkspaceRoutes.use('*', authenticate)
const workspaceOf = (c: Context) => [getDb(), c.get('actor') as Actor, c.req.param('slug')!] as const
issuesWorkspaceRoutes.get(workspaceCoreRoutes.states, async c => c.json(await getWorkspaceStates(...workspaceOf(c))))
issuesWorkspaceRoutes.get(workspaceCoreRoutes.labels, async c => c.json(await getWorkspaceLabels(...workspaceOf(c))))
issuesWorkspaceRoutes.get(workspaceCoreRoutes.issueSearch, async c =>
  c.json(await searchWorkspaceIssues(...workspaceOf(c), c.req.query()))
)
/** `PROJECT-12` style identifier. The sequence is the part after the last dash. */
function splitIdentifier(identifier: string) {
  const dash = identifier.lastIndexOf('-')
  return dash < 1 ? null : ([identifier.slice(0, dash), identifier.slice(dash + 1)] as const)
}
issuesWorkspaceRoutes.get(workspaceCoreRoutes.issueIdentifier, async c => {
  const parts = splitIdentifier(c.req.param('identifier')!)
  if (!parts) return c.json({ error: { code: 'ISSUE_NOT_FOUND', message: 'Work item not found' } }, 404)
  return c.json(await getIssueByIdentifier(...workspaceOf(c), parts[0], parts[1], false))
})
issuesWorkspaceRoutes.get(workspaceCoreRoutes.workItemIdentifier, async c => {
  const parts = splitIdentifier(c.req.param('identifier')!)
  if (!parts) return c.json({ error: { code: 'INVALID_IDENTIFIER', message: 'Invalid issue identifier' } }, 400)
  return c.json(await getIssueByIdentifier(...workspaceOf(c), parts[0], parts[1], true))
})
issuesRoutes.post(apiV1Routes.issues, async c =>
  c.json(
    await presentIssueApi(
      getDb(),
      await createIssue(
        getDb(),
        c.get('actor'),
        c.req.param('slug')!,
        parseInput(issueIdParamSchema, c.req.param('projectId')),
        await readJson(c, createIssueInputSchema)
      ),
      c.req.query()
    ),
    201
  )
)

issuesRoutes.get(apiV1Routes.issue, async c =>
  c.json(await presentIssueApi(getDb(), await getIssueById(...scope(c), idOf(c, 'issueId')), c.req.query()))
)
issuesRoutes.post(apiV1Routes.states, async c =>
  c.json(
    await createState(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(issueIdParamSchema, c.req.param('projectId')),
      await readJson(c, createStateInputSchema)
    ),
    201
  )
)
issuesRoutes.get(apiV1Routes.labels, async c =>
  c.json(
    await listLabels(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(issueIdParamSchema, c.req.param('projectId'))
    )
  )
)
issuesRoutes.post(apiV1Routes.labels, async c =>
  c.json(
    await createLabel(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(issueIdParamSchema, c.req.param('projectId')),
      await readJson(c, createLabelInputSchema)
    ),
    201
  )
)
issuesRoutes.patch(apiV1Routes.issue, async c =>
  c.json(
    await presentIssueApi(
      getDb(),
      await updateIssue(
        getDb(),
        c.get('actor'),
        c.req.param('slug')!,
        parseInput(issueIdParamSchema, c.req.param('projectId')),
        parseInput(issueIdParamSchema, c.req.param('issueId')),
        await readJson(c, updateIssueInputSchema)
      ),
      c.req.query()
    )
  )
)
issuesRoutes.get(apiV1Routes.issueActivities, async c =>
  c.json(
    await listIssueActivities(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(issueIdParamSchema, c.req.param('projectId')),
      parseInput(issueIdParamSchema, c.req.param('issueId'))
    )
  )
)
issuesRoutes.get(apiV1Routes.issueVersions, async c =>
  c.json(
    await listIssueVersions(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(issueIdParamSchema, c.req.param('projectId')),
      parseInput(issueIdParamSchema, c.req.param('issueId'))
    )
  )
)

issuesRoutes.delete(apiV1Routes.issue, async c => {
  await deleteIssue(
    getDb(),
    c.get('actor'),
    c.req.param('slug')!,
    parseInput(issueIdParamSchema, c.req.param('projectId')),
    parseInput(issueIdParamSchema, c.req.param('issueId'))
  )
  return c.body(null, 204)
})

issuesRoutes.post(apiV1Routes.issueLabels, async c =>
  c.json(
    await changeIssueRelation(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(issueIdParamSchema, c.req.param('projectId')),
      parseInput(issueIdParamSchema, c.req.param('issueId')),
      'labels',
      (await readJson(c, issueRelationInputSchema)).id,
      true
    )
  )
)

issuesRoutes.delete(apiV1Routes.issueLabels, async c =>
  c.json(
    await changeIssueRelation(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(issueIdParamSchema, c.req.param('projectId')),
      parseInput(issueIdParamSchema, c.req.param('issueId')),
      'labels',
      (await readJson(c, issueRelationInputSchema)).id,
      false
    )
  )
)

issuesRoutes.post(apiV1Routes.issueAssignees, async c =>
  c.json(
    await changeIssueRelation(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(issueIdParamSchema, c.req.param('projectId')),
      parseInput(issueIdParamSchema, c.req.param('issueId')),
      'assignees',
      (await readJson(c, issueRelationInputSchema)).id,
      true
    )
  )
)

issuesRoutes.delete(apiV1Routes.issueAssignees, async c =>
  c.json(
    await changeIssueRelation(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(issueIdParamSchema, c.req.param('projectId')),
      parseInput(issueIdParamSchema, c.req.param('issueId')),
      'assignees',
      (await readJson(c, issueRelationInputSchema)).id,
      false
    )
  )
)

issuesRoutes.get(apiV1Routes.issueLinks, async c =>
  c.json(
    await listIssueLinks(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(issueIdParamSchema, c.req.param('projectId')),
      parseInput(issueIdParamSchema, c.req.param('issueId'))
    )
  )
)

issuesRoutes.post(apiV1Routes.issueLinks, async c =>
  c.json(
    await createIssueLink(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(issueIdParamSchema, c.req.param('projectId')),
      parseInput(issueIdParamSchema, c.req.param('issueId')),
      await readJson(c, createIssueLinkSchema)
    ),
    201
  )
)

issuesRoutes.get(apiV1Routes.issueLink, async c =>
  c.json(
    await getIssueLink(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(issueIdParamSchema, c.req.param('projectId')),
      parseInput(issueIdParamSchema, c.req.param('issueId')),
      parseInput(issueIdParamSchema, c.req.param('linkId'))
    )
  )
)

issuesRoutes.patch(apiV1Routes.issueLink, async c =>
  c.json(
    await updateIssueLink(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(issueIdParamSchema, c.req.param('projectId')),
      parseInput(issueIdParamSchema, c.req.param('issueId')),
      parseInput(issueIdParamSchema, c.req.param('linkId')),
      await readJson(c, updateIssueLinkSchema)
    )
  )
)

issuesRoutes.get(apiV1Routes.issueRelations, async c =>
  c.json(
    await listIssueRelations(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(issueIdParamSchema, c.req.param('projectId')),
      parseInput(issueIdParamSchema, c.req.param('issueId'))
    )
  )
)

issuesRoutes.get(apiV1Routes.issueSubscribers, async c =>
  c.json(
    await listIssueSubscribers(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(issueIdParamSchema, c.req.param('projectId')),
      parseInput(issueIdParamSchema, c.req.param('issueId'))
    )
  )
)

issuesRoutes.post(apiV1Routes.issueSubscribers, async c =>
  c.json(
    await addIssueSubscriber(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(issueIdParamSchema, c.req.param('projectId')),
      parseInput(issueIdParamSchema, c.req.param('issueId')),
      (await readJson(c, issueSubscriberInputSchema)).subscriber
    ),
    201
  )
)

issuesRoutes.post(apiV1Routes.issueSubscribe, async c =>
  c.json(
    await addIssueSubscriber(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(issueIdParamSchema, c.req.param('projectId')),
      parseInput(issueIdParamSchema, c.req.param('issueId')),
      c.get('actor').userId
    ),
    201
  )
)

issuesRoutes.get(apiV1Routes.issueSubscribe, async c =>
  c.json(
    await issueSubscriptionStatus(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(issueIdParamSchema, c.req.param('projectId')),
      parseInput(issueIdParamSchema, c.req.param('issueId'))
    )
  )
)

issuesRoutes.get(apiV1Routes.issueSubscription, async c =>
  c.json(
    await issueSubscriptionStatus(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      parseInput(issueIdParamSchema, c.req.param('projectId')),
      parseInput(issueIdParamSchema, c.req.param('issueId'))
    )
  )
)

issuesRoutes.delete(apiV1Routes.issueLink, async c => {
  await deleteIssueLink(
    getDb(),
    c.get('actor'),
    c.req.param('slug')!,
    parseInput(issueIdParamSchema, c.req.param('projectId')),
    parseInput(issueIdParamSchema, c.req.param('issueId')),
    parseInput(issueIdParamSchema, c.req.param('linkId'))
  )
  return c.body(null, 204)
})

issuesRoutes.delete(apiV1Routes.issueRelations, async c => {
  await removeIssueRelation(
    getDb(),
    c.get('actor'),
    c.req.param('slug')!,
    parseInput(issueIdParamSchema, c.req.param('projectId')),
    parseInput(issueIdParamSchema, c.req.param('issueId')),
    (await readJson(c, issueRelationRemoveSchema)).related_issue
  )
  return c.body(null, 204)
})

issuesRoutes.delete(apiV1Routes.issueSubscriber, async c => {
  await removeIssueSubscriber(
    getDb(),
    c.get('actor'),
    c.req.param('slug')!,
    parseInput(issueIdParamSchema, c.req.param('projectId')),
    parseInput(issueIdParamSchema, c.req.param('issueId')),
    parseInput(issueIdParamSchema, c.req.param('subscriberId'))
  )
  return c.body(null, 204)
})

issuesRoutes.delete(apiV1Routes.issueSubscribe, async c => {
  await removeIssueSubscriber(
    getDb(),
    c.get('actor'),
    c.req.param('slug')!,
    parseInput(issueIdParamSchema, c.req.param('projectId')),
    parseInput(issueIdParamSchema, c.req.param('issueId')),
    c.get('actor').userId
  )
  return c.body(null, 204)
})
