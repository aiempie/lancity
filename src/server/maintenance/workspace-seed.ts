import { and, eq, isNull, sql } from 'drizzle-orm'
import { projectPages, pages } from '@/db/schema/content'
import { issueActivities, issueLabels, issues, labels, states } from '@/db/schema/issue'
import { issueViews } from '@/db/schema/notification'
import { cycleIssues, cycles, moduleIssues, modules } from '@/db/schema/planning'
import { projectMembers, projects, projectUserProperties, workspaceMembers, workspaces } from '@/db/schema/workspace'
import { createProject } from '@/server/project/service'
import { memberDefaults, userPropertyInsert } from '@/server/project/model-rules'
import { parseLooseJson, readSeedFile, seedProjectNames } from '@/server/maintenance/seed-data'
import { createProjectSchema } from '@/types/project/schema'
import type { LancityDb } from '@/types/database/schema'

/** Job type of the full seed. It replaces `workspace.seed` (see the p4-maintenance handoff for the wiring). */
export const MAINTENANCE_WORKSPACE_SEED_JOB = 'maintenance.workspace_seed'

const DAY_MS = 86_400_000

type Ids = Map<number, number>
type Json = Record<string, unknown>
type Ctx = { workspaceId: number; actorId: number; now: number }

const chunk = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size))

/** Run statements in D1 batches of 50 (one round trip each). */
async function runAll(db: LancityDb, statements: unknown[]) {
  for (const part of chunk(statements, 50)) await db.batch(part as unknown as Parameters<typeof db.batch>[0])
}

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10)

const SEED_DISPLAY_FILTERS = {
  layout: 'list',
  calendar: { layout: 'month', show_weekends: false },
  group_by: 'state',
  order_by: 'sort_order',
  sub_issue: true,
  sub_group_by: null,
  show_empty_groups: true
}
const SEED_DISPLAY_PROPERTIES = {
  key: true,
  link: true,
  cycle: false,
  state: true,
  labels: false,
  modules: false,
  assignee: true,
  due_date: false,
  estimate: true,
  priority: true,
  created_on: true,
  issue_type: true,
  start_date: false,
  updated_on: true,
  customer_count: true,
  sub_issue_count: false,
  attachment_count: false,
  customer_request_count: true
}

/**
 * PD-1239 `create_project_and_member`: one project per seed project, named after the workspace, with every
 * workspace member as a project member (same role) and the seed display properties. Lancity has no bot user, so
 * the workspace owner creates everything. Returns seed project id -> project id.
 */
export async function createProjectAndMember(db: LancityDb, workspace: typeof workspaces.$inferSelect): Promise<Ids> {
  const map: Ids = new Map()
  const seeds = readSeedFile<Json>('projects.json')
  if (!seeds?.length) return map
  const members = await db
    .select({ memberId: workspaceMembers.memberId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.isActive, true), isNull(workspaceMembers.deletedAt)))
  for (const seed of seeds) {
    const { id, description, network, cover_image, logo_props } = seed as Json
    const input = createProjectSchema.parse({
      ...seedProjectNames(workspace.name),
      description,
      network,
      coverImage: cover_image ?? null,
      logoProps: logo_props ?? undefined,
      cycleView: true,
      moduleView: true,
      issueViewsView: true
    })
    const project = await createProject(db, { userId: workspace.ownerId }, workspace.slug, input)
    await runAll(db, [
      ...members.map(m =>
        db
          .insert(projectMembers)
          .values({ projectId: project.id, workspaceId: workspace.id, memberId: m.memberId, role: m.role, ...memberDefaults(), createdById: workspace.ownerId })
          .onConflictDoNothing()
      ),
      ...members.map(m => userPropertyInsert(db, { projectId: project.id, userId: m.memberId, actorId: workspace.ownerId }))
    ])
    await db
      .update(projectUserProperties)
      .set({ displayFilters: SEED_DISPLAY_FILTERS, displayProperties: SEED_DISPLAY_PROPERTIES })
      .where(eq(projectUserProperties.projectId, project.id))
    map.set(Number(id), project.id)
  }
  return map
}

/**
 * PD-1240 `create_project_states`. `createProject` already added Lancity's default states, so a seed state with the
 * same name updates that row (colour, order, group) and any other is inserted. Returns seed state id -> state id.
 */
export async function createProjectStates(db: LancityDb, ctx: Ctx, projectMap: Ids): Promise<Ids> {
  const map: Ids = new Map()
  for (const seed of readSeedFile<Json>('states.json') ?? []) {
    const projectId = projectMap.get(Number(seed.project_id))
    if (!projectId) continue
    const values = {
      name: String(seed.name),
      color: String(seed.color),
      sequence: Number(seed.sequence),
      group: seed.group as typeof states.$inferInsert.group,
      default: Boolean(seed.default)
    }
    const [existing] = await db
      .select({ id: states.id })
      .from(states)
      .where(and(eq(states.projectId, projectId), eq(states.name, values.name), isNull(states.deletedAt)))
    if (existing) {
      await db.update(states).set(values).where(eq(states.id, existing.id))
      map.set(Number(seed.id), existing.id)
      continue
    }
    const [row] = await db
      .insert(states)
      .values({ ...values, slug: values.name.toLowerCase().replaceAll(' ', '-'), projectId, workspaceId: ctx.workspaceId, createdById: ctx.actorId })
      .returning({ id: states.id })
    map.set(Number(seed.id), row.id)
  }
  return map
}

/** PD-1241 `create_project_labels`. Returns seed label id -> label id. */
export async function createProjectLabels(db: LancityDb, ctx: Ctx, projectMap: Ids): Promise<Ids> {
  const map: Ids = new Map()
  for (const seed of readSeedFile<Json>('labels.json') ?? []) {
    const projectId = projectMap.get(Number(seed.project_id))
    if (!projectId) continue
    const [row] = await db
      .insert(labels)
      .values({
        name: String(seed.name),
        color: String(seed.color ?? ''),
        sortOrder: Number(seed.sort_order ?? 65535),
        projectId,
        workspaceId: ctx.workspaceId,
        createdById: ctx.actorId
      })
      .returning({ id: labels.id })
    map.set(Number(seed.id), row.id)
  }
  return map
}

/**
 * PD-1244 `create_cycles`. CURRENT starts now and lasts 14 days. UPCOMING starts the day after the project's last
 * cycle ends (14 days from now when there is none). Returns seed cycle id -> cycle id.
 */
export async function createCycles(db: LancityDb, ctx: Ctx, projectMap: Ids): Promise<Ids> {
  const map: Ids = new Map()
  const lastEnd = new Map<number, number>()
  for (const seed of readSeedFile<Json>('cycles.json') ?? []) {
    const projectId = projectMap.get(Number(seed.project_id))
    if (!projectId) continue
    let start = ctx.now
    if (seed.type === 'UPCOMING') {
      const previous = lastEnd.get(projectId)
      start = previous === undefined ? ctx.now + 14 * DAY_MS : previous + DAY_MS
    }
    const end = start + 14 * DAY_MS
    lastEnd.set(projectId, end)
    const [row] = await db
      .insert(cycles)
      .values({
        name: String(seed.name),
        sortOrder: Number(seed.sort_order ?? 65535),
        timezone: String(seed.timezone ?? 'UTC'),
        startDate: new Date(start),
        endDate: new Date(end),
        projectId,
        workspaceId: ctx.workspaceId,
        ownedById: ctx.actorId,
        createdById: ctx.actorId
      })
      .returning({ id: cycles.id })
    map.set(Number(seed.id), row.id)
  }
  return map
}

/** PD-1245 `create_modules`: module n starts 2n days from now and runs 14 days. Returns seed module id -> module id. */
export async function createModules(db: LancityDb, ctx: Ctx, projectMap: Ids): Promise<Ids> {
  const map: Ids = new Map()
  const seeds = readSeedFile<Json>('modules.json') ?? []
  for (const [index, seed] of seeds.entries()) {
    const projectId = projectMap.get(Number(seed.project_id))
    if (!projectId) continue
    const start = ctx.now + index * 2 * DAY_MS
    const [row] = await db
      .insert(modules)
      .values({
        name: String(seed.name),
        description: String(seed.description ?? ''),
        status: (seed.status as typeof modules.$inferInsert.status) ?? 'planned',
        sortOrder: Number(seed.sort_order ?? 65535),
        startDate: ymd(start),
        targetDate: ymd(start + 14 * DAY_MS),
        projectId,
        workspaceId: ctx.workspaceId,
        createdById: ctx.actorId
      })
      .returning({ id: modules.id })
    map.set(Number(seed.id), row.id)
  }
  return map
}

/**
 * PD-1242 `create_project_issues`: each issue is inserted with its sequence, "created" activity, labels, cycle and
 * modules in one batch. Sequences follow file order per project, as `Issue.save` assigned them in Plane.
 */
export async function createProjectIssues(
  db: LancityDb,
  ctx: Ctx,
  maps: { projects: Ids; states: Ids; labels: Ids; cycles: Ids; modules: Ids }
): Promise<number> {
  const counters = new Map<number, number>()
  let created = 0
  for (const seed of readSeedFile<Json>('issues.json') ?? []) {
    const projectId = maps.projects.get(Number(seed.project_id))
    const stateId = maps.states.get(Number(seed.state_id))
    if (!projectId || !stateId || !seed.name) continue
    const sequence = (counters.get(projectId) ?? 0) + 1
    counters.set(projectId, sequence)
    const issueId = sql<number>`(select id from issues where project_id = ${projectId} and sequence_id = ${sequence})`
    const base = { projectId, workspaceId: ctx.workspaceId, createdById: ctx.actorId }
    const labelIds = ((seed.labels as number[] | undefined) ?? []).map(id => maps.labels.get(id)).filter((id): id is number => !!id)
    const cycleId = seed.cycle_id ? maps.cycles.get(Number(seed.cycle_id)) : undefined
    const moduleIds = ((seed.module_ids as number[] | undefined) ?? []).map(id => maps.modules.get(id)).filter((id): id is number => !!id)
    await db.batch([
      db.insert(issues).values({
        ...base,
        name: String(seed.name).slice(0, 255),
        descriptionHtml: String(seed.description_html ?? '<p></p>'),
        descriptionStripped: (seed.description_stripped as string | undefined) ?? null,
        priority: (seed.priority as typeof issues.$inferInsert.priority) ?? 'none',
        sortOrder: Number(seed.sort_order ?? 65535),
        sequenceId: sequence,
        stateId
      }),
      db.run(
        sql`insert into issue_sequences (issue_id, sequence, project_id, workspace_id, created_by_id)
          values (${issueId}, ${sequence}, ${projectId}, ${ctx.workspaceId}, ${ctx.actorId})`
      ),
      db.insert(issueActivities).values({
        ...base,
        issueId: issueId as unknown as number,
        comment: 'created the issue',
        verb: 'created',
        actorId: ctx.actorId,
        epoch: ctx.now / 1000
      }),
      ...labelIds.map(labelId => db.insert(issueLabels).values({ ...base, issueId: issueId as unknown as number, labelId })),
      ...(cycleId ? [db.insert(cycleIssues).values({ ...base, issueId: issueId as unknown as number, cycleId })] : []),
      ...moduleIds.map(moduleId => db.insert(moduleIssues).values({ ...base, issueId: issueId as unknown as number, moduleId }))
    ] as unknown as Parameters<typeof db.batch>[0])
    created++
  }
  for (const [projectId, lastSequence] of counters)
    await db.run(
      sql`insert into project_issue_counters (project_id, last_sequence) values (${projectId}, ${lastSequence})
        on conflict (project_id) do update set last_sequence = max(last_sequence, excluded.last_sequence)`
    )
  return created
}

/** PD-1243 `create_pages`: workspace pages, linked to their project when the seed says `PROJECT`. */
export async function createPages(db: LancityDb, ctx: Ctx, projectMap: Ids): Promise<number> {
  let created = 0
  for (const seed of readSeedFile<Json>('pages.json') ?? []) {
    const [page] = await db
      .insert(pages)
      .values({
        workspaceId: ctx.workspaceId,
        isGlobal: false,
        access: Number(seed.access ?? 0),
        name: String(seed.name ?? ''),
        descriptionJson: parseLooseJson(seed.description) as never,
        descriptionHtml: String(seed.description_html ?? '<p></p>'),
        descriptionStripped: (seed.description_stripped as string | undefined) ?? null,
        logoProps: parseLooseJson(seed.logo_props) as never,
        ownedById: ctx.actorId,
        createdById: ctx.actorId,
        updatedById: ctx.actorId
      })
      .returning({ id: pages.id })
    created++
    const projectId = projectMap.get(Number(seed.project_id))
    if (projectId && seed.type === 'PROJECT')
      await db
        .insert(projectPages)
        .values({ workspaceId: ctx.workspaceId, projectId, pageId: page.id, createdById: ctx.actorId, updatedById: ctx.actorId })
  }
  return created
}

/** PD-1246 `create_views`. */
export async function createViews(db: LancityDb, ctx: Ctx, projectMap: Ids): Promise<number> {
  let created = 0
  for (const seed of readSeedFile<Json>('views.json') ?? []) {
    const projectId = projectMap.get(Number(seed.project_id))
    if (!projectId) continue
    await db.insert(issueViews).values({
      name: String(seed.name),
      description: String(seed.description ?? ''),
      access: Number(seed.access ?? 1),
      query: {} as never,
      filters: (seed.filters ?? {}) as never,
      displayFilters: (seed.display_filters ?? {}) as never,
      displayProperties: (seed.display_properties ?? {}) as never,
      richFilters: (seed.rich_filters ?? {}) as never,
      sortOrder: Number(seed.sort_order ?? 65535),
      projectId,
      workspaceId: ctx.workspaceId,
      ownedById: ctx.actorId,
      createdById: ctx.actorId
    })
    created++
  }
  return created
}

export type WorkspaceSeedResult = { projectIds: number[]; issues: number; pages: number; views: number } | null

/**
 * PD-1247 `workspace_seed`: sample project, states, labels, cycles, modules, issues, views and pages for a new
 * workspace. Idempotent: it does nothing when the workspace already has a project, so a Queues redelivery cannot
 * duplicate the data. A failure after the project exists leaves a partial seed that a rerun skips; the error is
 * thrown so the failure is visible in the logs and in `maintenance_runs`.
 */
export async function workspaceSeed(db: LancityDb, workspaceId: number, now = Date.now()): Promise<WorkspaceSeedResult> {
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (!workspace || workspace.deletedAt) return null
  const [existing] = await db.select({ id: projects.id }).from(projects).where(eq(projects.workspaceId, workspaceId)).limit(1)
  if (existing) return null
  const ctx: Ctx = { workspaceId, actorId: workspace.ownerId, now }
  const projectMap = await createProjectAndMember(db, workspace)
  const stateMap = await createProjectStates(db, ctx, projectMap)
  const labelMap = await createProjectLabels(db, ctx, projectMap)
  const cycleMap = await createCycles(db, ctx, projectMap)
  const moduleMap = await createModules(db, ctx, projectMap)
  const issueCount = await createProjectIssues(db, ctx, {
    projects: projectMap,
    states: stateMap,
    labels: labelMap,
    cycles: cycleMap,
    modules: moduleMap
  })
  const views = await createViews(db, ctx, projectMap)
  const pageCount = await createPages(db, ctx, projectMap)
  return { projectIds: [...projectMap.values()], issues: issueCount, pages: pageCount, views }
}
