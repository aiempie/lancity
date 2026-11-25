import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { apiV1Routes } from '@/data/linkto'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import { getProjectApi, listProjectsApi, listProjectsLiteApi } from '@/server/project/api'
import {
  createProjectJoin,
  createProjectInvitations,
  createUserProjectInvitations,
  deleteProjectInvitations,
  getProjectInvitations,
  getProjectJoin,
  listProjectInvitations,
  listUserProjectInvitations
} from '@/server/project/invite'
import {
  addProjectMember,
  createProjectMember,
  deleteProjectMember,
  getProjectMember,
  getProjectMemberPreference,
  getProjectMemberUser,
  getUserProjectRoles,
  joinProject,
  leaveProject,
  listProjectMembers,
  listProjectMembersLiteApi,
  patchProjectMember,
  updateProjectMemberPreference
} from '@/server/project/member'
import {
  createDeployBoard,
  createProject,
  createProjectArchiveUnarchive,
  createProjectFavorites,
  createProjectUserViews,
  deleteDeployBoard,
  deleteProject,
  deleteProjectArchiveUnarchive,
  deleteProjectFavorites,
  deleteProjectIdentifier,
  getDeployBoard,
  getProject,
  getProjectIdentifier,
  getProjectSummary,
  listDeployBoards,
  listDetailProject,
  listProjectFavorites,
  listProjects,
  updateDeployBoard,
  updateProject
} from '@/server/project/service'
import type { ApiEnv } from '@/types/api/schema'
import {
  addProjectMemberSchema,
  addProjectMembersSchema,
  createDeployBoardSchema,
  createProjectInvitationsSchema,
  createProjectSchema,
  favoriteProjectSchema,
  joinProjectsSchema,
  projectIdentifierQuerySchema,
  projectIdSchema,
  projectListQuerySchema,
  projectMemberApiInputSchema,
  projectMemberPreferenceValidatePreferences,
  projectSummaryQuerySchema,
  projectUserViewsSchema,
  respondProjectInvitationSchema,
  updateDeployBoardSchema,
  updateProjectMemberSchema,
  updateProjectSchema
} from '@/types/project/schema'

/** Paths added by the project backend port. Move them to `apiV1Routes` in `@/data/linkto` when merging. */
export const projectApiRoutes = {
  projectsDetails: apiV1Routes.projectsDetails,
  projectsLite: apiV1Routes.projectsLite,
  projectIdentifiers: apiV1Routes.projectIdentifiers,
  favoriteProjects: apiV1Routes.favoriteProjects,
  favoriteProject: apiV1Routes.favoriteProject,
  projectArchive: apiV1Routes.projectArchive,
  projectSummary: apiV1Routes.projectSummary,
  projectViews: apiV1Routes.projectViews,
  projectDeployBoards: apiV1Routes.projectDeployBoards,
  projectDeployBoard: apiV1Routes.projectDeployBoard,
  projectInvitations: apiV1Routes.projectInvitations,
  projectInvitation: apiV1Routes.projectInvitation,
  projectInvitationJoin: apiV1Routes.projectInvitationJoin,
  projectMemberMe: apiV1Routes.projectMemberMe,
  projectMembersLite: apiV1Routes.projectMembersLite,
  projectMemberPreference: apiV1Routes.projectMemberPreference,
  userProjectRoles: apiV1Routes.userProjectRoles,
  userProjectInvitations: apiV1Routes.userProjectInvitations
} as const

type Param = { param: (name: string) => string | undefined }
const id = (req: Param, name: string) => parseInput(projectIdSchema, req.param(name))
const flag = (value: string | undefined) => value === 'true' || value === '1'

/** PD-0766 `ProjectJoinEndpoint.get` is public. Mount it before `projectsRoutes`, which authenticates every route. */
export const projectJoinPublicRoutes = new Hono<ApiEnv>({ strict: false })
projectJoinPublicRoutes.get(projectApiRoutes.projectInvitationJoin, async c =>
  c.json(await getProjectJoin(getDb(), c.req.param('slug'), id(c.req, 'projectId'), id(c.req, 'invitationId'), c.req.query('token')))
)

export const projectsRoutes = new Hono<ApiEnv>({ strict: false })
projectsRoutes.use('*', authenticate)

// Projects. The paginated list with counts (public API shape) is served when `per_page` is present.
projectsRoutes.get(apiV1Routes.workspaceProjects, async c => {
  const query = parseInput(projectListQuerySchema, c.req.query())
  const actor = c.get('actor')
  const slug = c.req.param('slug')
  const includeArchived = flag(query.include_archived)
  if (query.per_page)
    return c.json(
      await listProjectsApi(getDb(), actor, slug, {
        cursor: query.cursor,
        perPage: query.per_page,
        orderBy: query.order_by,
        fields: query.fields,
        expand: c.req.query('expand'),
        includeArchived
      })
    )
  return c.json(await listProjects(getDb(), actor, slug, { includeArchived }))
})
projectsRoutes.post(apiV1Routes.workspaceProjects, async c =>
  c.json(await createProject(getDb(), c.get('actor'), c.req.param('slug'), await readJson(c, createProjectSchema)), 201)
)
projectsRoutes.get(projectApiRoutes.projectsDetails, async c => {
  const query = parseInput(projectListQuerySchema, c.req.query())
  return c.json(
    await listDetailProject(getDb(), c.get('actor'), c.req.param('slug'), {
      cursor: query.cursor,
      perPage: query.per_page,
      orderBy: query.order_by,
      fields: query.fields,
      includeArchived: query.include_archived === undefined ? undefined : flag(query.include_archived)
    })
  )
})
projectsRoutes.get(projectApiRoutes.projectsLite, async c => {
  const query = parseInput(projectListQuerySchema, c.req.query())
  return c.json(
    await listProjectsLiteApi(getDb(), c.get('actor'), c.req.param('slug'), {
      cursor: query.cursor,
      perPage: query.per_page,
      orderBy: query.order_by,
      includeArchived: flag(query.include_archived)
    })
  )
})
projectsRoutes.get(projectApiRoutes.projectIdentifiers, async c =>
  c.json(
    await getProjectIdentifier(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      parseInput(projectIdentifierQuerySchema, c.req.query()).name
    )
  )
)
projectsRoutes.delete(projectApiRoutes.projectIdentifiers, async c => {
  const input = await readJson(c, projectIdentifierQuerySchema)
  await deleteProjectIdentifier(getDb(), c.get('actor'), c.req.param('slug'), input.name)
  return c.body(null, 204)
})

// Favorites
projectsRoutes.get(projectApiRoutes.favoriteProjects, async c =>
  c.json(await listProjectFavorites(getDb(), c.get('actor'), c.req.param('slug')))
)
projectsRoutes.post(projectApiRoutes.favoriteProjects, async c => {
  const input = await readJson(c, favoriteProjectSchema)
  await createProjectFavorites(getDb(), c.get('actor'), c.req.param('slug'), input.project)
  return c.body(null, 204)
})
projectsRoutes.delete(projectApiRoutes.favoriteProject, async c => {
  await deleteProjectFavorites(getDb(), c.get('actor'), c.req.param('slug'), id(c.req, 'projectId'))
  return c.body(null, 204)
})

// One project. `fields` or `expand` select the public API shape, otherwise the web shape with membership rules.
projectsRoutes.get(apiV1Routes.workspaceProject, async c => {
  const slug = c.req.param('slug')
  const projectId = id(c.req, 'projectId')
  if (c.req.query('fields') || c.req.query('expand'))
    return c.json(
      await getProjectApi(getDb(), c.get('actor'), slug, projectId, {
        fields: c.req.query('fields'),
        expand: c.req.query('expand')
      })
    )
  return c.json(await getProject(getDb(), c.get('actor'), slug, projectId))
})
const patchProject = async (c: Context<ApiEnv>) =>
  c.json(
    await updateProject(
      getDb(),
      c.get('actor'),
      c.req.param('slug')!,
      id(c.req, 'projectId'),
      await readJson(c, updateProjectSchema)
    )
  )
projectsRoutes.patch(apiV1Routes.workspaceProject, patchProject)
projectsRoutes.put(apiV1Routes.workspaceProject, patchProject)
projectsRoutes.delete(apiV1Routes.workspaceProject, async c => {
  await deleteProject(getDb(), c.get('actor'), c.req.param('slug'), id(c.req, 'projectId'))
  return c.body(null, 204)
})
projectsRoutes.post(projectApiRoutes.projectArchive, async c => {
  const { archivedAt } = await createProjectArchiveUnarchive(
    getDb(),
    c.get('actor'),
    c.req.param('slug'),
    id(c.req, 'projectId')
  )
  return c.json({ archivedAt })
})
projectsRoutes.delete(projectApiRoutes.projectArchive, async c => {
  await deleteProjectArchiveUnarchive(getDb(), c.get('actor'), c.req.param('slug'), id(c.req, 'projectId'))
  return c.body(null, 204)
})
projectsRoutes.get(projectApiRoutes.projectSummary, async c =>
  c.json(
    await getProjectSummary(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      id(c.req, 'projectId'),
      parseInput(projectSummaryQuerySchema, c.req.query()).fields
    )
  )
)
projectsRoutes.post(projectApiRoutes.projectViews, async c => {
  await createProjectUserViews(
    getDb(),
    c.get('actor'),
    c.req.param('slug'),
    id(c.req, 'projectId'),
    await readJson(c, projectUserViewsSchema)
  )
  return c.body(null, 204)
})

// Deploy board
projectsRoutes.get(projectApiRoutes.projectDeployBoards, async c =>
  c.json((await listDeployBoards(getDb(), c.get('actor'), c.req.param('slug'), id(c.req, 'projectId'))) ?? {})
)
projectsRoutes.post(projectApiRoutes.projectDeployBoards, async c =>
  c.json(
    await createDeployBoard(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      id(c.req, 'projectId'),
      await readJson(c, createDeployBoardSchema)
    )
  )
)
projectsRoutes.get(projectApiRoutes.projectDeployBoard, async c =>
  c.json(
    await getDeployBoard(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      id(c.req, 'projectId'),
      id(c.req, 'boardId')
    )
  )
)
projectsRoutes.patch(projectApiRoutes.projectDeployBoard, async c =>
  c.json(
    await updateDeployBoard(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      id(c.req, 'projectId'),
      id(c.req, 'boardId'),
      await readJson(c, updateDeployBoardSchema)
    )
  )
)
projectsRoutes.delete(projectApiRoutes.projectDeployBoard, async c => {
  await deleteDeployBoard(
    getDb(),
    c.get('actor'),
    c.req.param('slug'),
    id(c.req, 'projectId'),
    id(c.req, 'boardId')
  )
  return c.body(null, 204)
})

// Invitations
projectsRoutes.get(projectApiRoutes.projectInvitations, async c =>
  c.json(await listProjectInvitations(getDb(), c.get('actor'), c.req.param('slug'), id(c.req, 'projectId')))
)
projectsRoutes.post(projectApiRoutes.projectInvitations, async c =>
  c.json(
    await createProjectInvitations(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      id(c.req, 'projectId'),
      await readJson(c, createProjectInvitationsSchema)
    )
  )
)
projectsRoutes.get(projectApiRoutes.projectInvitation, async c =>
  c.json(
    await getProjectInvitations(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      id(c.req, 'projectId'),
      id(c.req, 'invitationId')
    )
  )
)
projectsRoutes.delete(projectApiRoutes.projectInvitation, async c => {
  await deleteProjectInvitations(
    getDb(),
    c.get('actor'),
    c.req.param('slug'),
    id(c.req, 'projectId'),
    id(c.req, 'invitationId')
  )
  return c.body(null, 204)
})
projectsRoutes.post(projectApiRoutes.projectInvitationJoin, async c =>
  c.json(
    await createProjectJoin(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      id(c.req, 'projectId'),
      id(c.req, 'invitationId'),
      await readJson(c, respondProjectInvitationSchema)
    )
  )
)

// Join, leave and members
projectsRoutes.post(apiV1Routes.projectJoin, async c =>
  c.json(await joinProject(getDb(), c.get('actor'), c.req.param('slug'), id(c.req, 'projectId')), 201)
)
projectsRoutes.post(apiV1Routes.projectLeave, async c => {
  await leaveProject(getDb(), c.get('actor'), c.req.param('slug'), id(c.req, 'projectId'))
  return c.body(null, 204)
})
projectsRoutes.get(apiV1Routes.projectMembers, async c =>
  c.json(await listProjectMembers(getDb(), c.get('actor'), c.req.param('slug'), id(c.req, 'projectId')))
)
// Accepts a single `{ memberId, role }`, the web `{ members: [...] }` or the public API `{ member, role }`.
projectsRoutes.post(apiV1Routes.projectMembers, async c => {
  const input = await readJson(
    c,
    z.union([addProjectMembersSchema, addProjectMemberSchema, projectMemberApiInputSchema])
  )
  const db = getDb()
  const actor = c.get('actor')
  const slug = c.req.param('slug')
  const projectId = id(c.req, 'projectId')
  if ('members' in input) return c.json(await createProjectMember(db, actor, slug, projectId, input.members), 201)
  if ('member' in input) {
    const [created] = await createProjectMember(db, actor, slug, projectId, [{ memberId: input.member, role: input.role }])
    return c.json({ id: created.id, member: created.memberId, role: created.role }, 201)
  }
  return c.json(await addProjectMember(db, actor, slug, projectId, input.memberId, input.role), 201)
})
projectsRoutes.get(projectApiRoutes.projectMemberMe, async c =>
  c.json(await getProjectMemberUser(getDb(), c.get('actor'), c.req.param('slug'), id(c.req, 'projectId')))
)
projectsRoutes.get(projectApiRoutes.projectMembersLite, async c => {
  const query = parseInput(projectListQuerySchema, c.req.query())
  return c.json(
    await listProjectMembersLiteApi(getDb(), c.get('actor'), c.req.param('slug'), id(c.req, 'projectId'), {
      cursor: query.cursor,
      perPage: query.per_page
    })
  )
})
projectsRoutes.get(projectApiRoutes.projectMemberPreference, async c =>
  c.json(
    await getProjectMemberPreference(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      id(c.req, 'projectId'),
      id(c.req, 'memberId')
    )
  )
)
projectsRoutes.patch(projectApiRoutes.projectMemberPreference, async c =>
  c.json(
    await updateProjectMemberPreference(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      id(c.req, 'projectId'),
      id(c.req, 'memberId'),
      await readJson(c, projectMemberPreferenceValidatePreferences)
    )
  )
)
projectsRoutes.get(apiV1Routes.projectMember, async c =>
  c.json(
    await getProjectMember(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      id(c.req, 'projectId'),
      id(c.req, 'memberId')
    )
  )
)
projectsRoutes.patch(apiV1Routes.projectMember, async c =>
  c.json(
    await patchProjectMember(
      getDb(),
      c.get('actor'),
      c.req.param('slug'),
      id(c.req, 'projectId'),
      id(c.req, 'memberId'),
      await readJson(c, updateProjectMemberSchema)
    )
  )
)
projectsRoutes.delete(apiV1Routes.projectMember, async c => {
  await deleteProjectMember(
    getDb(),
    c.get('actor'),
    c.req.param('slug'),
    id(c.req, 'projectId'),
    id(c.req, 'memberId')
  )
  return c.body(null, 204)
})

/** Routes under `/users` (mount at `linkto.users`): the caller's roles and invitations across a workspace. */
export const projectUserRoutes = new Hono<ApiEnv>({ strict: false })
projectUserRoutes.get(projectApiRoutes.userProjectRoles, authenticate, async c =>
  c.json(await getUserProjectRoles(getDb(), c.get('actor'), c.req.param('slug')))
)
projectUserRoutes.get(projectApiRoutes.userProjectInvitations, authenticate, async c =>
  c.json(await listUserProjectInvitations(getDb(), c.get('actor'), c.req.param('slug')))
)
projectUserRoutes.post(projectApiRoutes.userProjectInvitations, authenticate, async c => {
  const input = await readJson(c, joinProjectsSchema)
  return c.json(await createUserProjectInvitations(getDb(), c.get('actor'), c.req.param('slug'), input.projectIds), 201)
})
