import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { user } from '@/db/schema/auth'
import { pageLabels, pages, projectPages } from '@/db/schema/content'
import { issueActivities, issueAssignees, issueLabels, issueSequences, issues, labels, states } from '@/db/schema/issue'
import { cycleIssues, cycles, intakeIssues, intakes, moduleIssues, modules } from '@/db/schema/planning'
import { projectIdentifiers, projectMembers, projects, workspaces } from '@/db/schema/workspace'
import { memberDefaults, userPropertyInsert } from '@/server/project/model-rules'
import type { LancityDb } from '@/types/database/schema'
import type { DummyDataInput } from '@/types/instance/p4-maintenance-schema'

/** Seedable random source so tests are repeatable (Plane uses `random` and Faker). */
export type Rng = () => number

export function createRng(seed = Date.now()): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Ctx = { workspaceId: number; userId: number; rng: Rng; now: number }
type Project = { id: number }

const FIRST = ['Ada', 'Grace', 'Alan', 'Linus', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Radia', 'Tim', 'Hedy', 'Edsger']
const LAST = ['Lovelace', 'Hopper', 'Turing', 'Torvalds', 'Hamilton', 'Ritchie', 'Liskov', 'Thompson', 'Perlman', 'Berners', 'Lamarr', 'Dijkstra']
const COLORS = ['Red', 'Blue', 'Green', 'Amber', 'Teal', 'Violet', 'Indigo', 'Coral', 'Olive', 'Navy', 'Crimson', 'Cyan', 'Gold', 'Lime', 'Plum']
const WORDS = 'work item cycle module page state label project member issue plan review release sprint backlog design build test ship track update scope risk goal team'.split(' ')
const DAY_MS = 86_400_000

const randint = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1))
const pick = <T>(rng: Rng, items: readonly T[]) => items[randint(rng, 0, items.length - 1)]
/** Random subset of `count` items (Python `random.sample`). */
const sample = <T>(rng: Rng, items: readonly T[], count: number) => {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randint(rng, 0, i)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, Math.max(0, Math.min(count, copy.length)))
}
const fakeName = (rng: Rng) => `${pick(rng, FIRST)} ${pick(rng, LAST)}`
const fakeHex = (rng: Rng) => `#${randint(rng, 0, 0xffffff).toString(16).padStart(6, '0')}`
const fakeText = (rng: Rng, maxChars: number) => {
  let text = ''
  while (text.length < maxChars - 12) text += `${pick(rng, WORDS)}${rng() < 0.12 ? '. ' : ' '}`
  return text.trim()
}
const dateOnly = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const endOfYear = (now: number) => Date.UTC(new Date(now).getUTCFullYear(), 11, 31)
/** A date range that starts this year, or no range at all (the `[None, fake.date_this_year()]` choice in Plane). */
function randomRange(ctx: Ctx): { start: number; end: number } | null {
  if (ctx.rng() < 0.5) return null
  const year = new Date(ctx.now).getUTCFullYear()
  const start = Date.UTC(year, 0, 1) + Math.floor(ctx.rng() * (ctx.now - Date.UTC(year, 0, 1) + 1))
  const end = start + Math.floor(ctx.rng() * Math.max(DAY_MS, endOfYear(ctx.now) - start))
  return { start, end: Math.max(end, start + DAY_MS) }
}

const chunk = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size))

/** Run statements in D1 batches of 50. Returns the result of every statement. */
async function batchAll(db: LancityDb, statements: unknown[]): Promise<unknown[]> {
  const results: unknown[] = []
  for (const part of chunk(statements, 50))
    results.push(...(await db.batch(part as unknown as Parameters<typeof db.batch>[0])))
  return results
}

/** PD-1107 `create_project`: random name, identifier from its letters, the creator as admin member. */
export async function createProject(db: LancityDb, ctx: Ctx): Promise<Project> {
  const name = fakeName(ctx.rng)
  const letters = name.replace(/[^A-Za-z]/g, '').toUpperCase()
  const used = new Set(
    (await db.select({ name: projectIdentifiers.name }).from(projectIdentifiers).where(eq(projectIdentifiers.workspaceId, ctx.workspaceId))).map(
      r => r.name
    )
  )
  let identifier = letters.slice(0, randint(ctx.rng, 2, Math.min(12, letters.length - 1)))
  for (let attempt = 0; used.has(identifier) && attempt < 50; attempt++)
    identifier = `${letters.slice(0, 3)}${randint(ctx.rng, 10, 9999)}`.slice(0, 12)
  const unique = crypto.randomUUID().slice(0, 5)
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: ctx.workspaceId,
      name: `${name}_${unique}`,
      identifier,
      intakeView: true,
      createdById: ctx.userId,
      updatedById: ctx.userId
    })
    .returning({ id: projects.id })
  await batchAll(db, [
    db.insert(projectIdentifiers).values({ name: identifier, projectId: project.id, workspaceId: ctx.workspaceId, createdById: ctx.userId }),
    db.insert(projectMembers).values({
      projectId: project.id,
      workspaceId: ctx.workspaceId,
      memberId: ctx.userId,
      role: 20,
      ...memberDefaults(),
      createdById: ctx.userId
    })
  ])
  // A raw `db.run` statement has no prepared handle, so it cannot join a Drizzle D1 batch.
  await userPropertyInsert(db, { projectId: project.id, userId: ctx.userId, actorId: ctx.userId })
  return project
}

/** PD-1108 `create_project_members`: every given e-mail that has an account joins as admin (conflicts ignored). */
export async function createProjectMembers(db: LancityDb, ctx: Ctx, project: Project, emails: string[]): Promise<number> {
  if (!emails.length) return 0
  const people = await db.select({ id: user.id }).from(user).where(inArray(user.email, emails.map(e => e.trim().toLowerCase())))
  await batchAll(
    db,
    people.map(person =>
      db
        .insert(projectMembers)
        .values({
          projectId: project.id,
          workspaceId: ctx.workspaceId,
          memberId: person.id,
          role: 20,
          ...memberDefaults(),
          sortOrder: randint(ctx.rng, 0, 65535)
        })
        .onConflictDoNothing()
    )
  )
  return people.length
}

const DUMMY_STATES = [
  { name: 'Backlog', color: '#A3A3A3', sequence: 15000, group: 'backlog', default: true },
  { name: 'Todo', color: '#3A3A3A', sequence: 25000, group: 'unstarted', default: false },
  { name: 'In Progress', color: '#F59E0B', sequence: 35000, group: 'started', default: false },
  { name: 'Done', color: '#16A34A', sequence: 45000, group: 'completed', default: false },
  { name: 'Cancelled', color: '#EF4444', sequence: 55000, group: 'cancelled', default: false }
] as const

/** PD-1109 `create_states`. */
export async function createStates(db: LancityDb, ctx: Ctx, project: Project): Promise<void> {
  await batchAll(
    db,
    DUMMY_STATES.map(state =>
      db.insert(states).values({
        ...state,
        slug: state.name.toLowerCase().replaceAll(' ', '-'),
        projectId: project.id,
        workspaceId: ctx.workspaceId,
        createdById: ctx.userId
      })
    )
  )
}

/** PD-1110 `create_labels`: 50 labels (name and colour are random, duplicates ignored). */
export async function createLabels(db: LancityDb, ctx: Ctx, project: Project): Promise<void> {
  await batchAll(
    db,
    Array.from({ length: 50 }, (_, i) =>
      db
        .insert(labels)
        .values({
          name: `${pick(ctx.rng, COLORS)} ${i + 1}`,
          color: fakeHex(ctx.rng),
          projectId: project.id,
          workspaceId: ctx.workspaceId,
          createdById: ctx.userId,
          sortOrder: randint(ctx.rng, 0, 65535)
        })
        .onConflictDoNothing()
    )
  )
}

/** PD-1111 `create_cycles`. Plane loops `while len(cycles) <= cycle_count`, so it creates one more than asked. */
export async function createCycles(db: LancityDb, ctx: Ctx, project: Project, cycleCount: number): Promise<void> {
  await batchAll(
    db,
    Array.from({ length: cycleCount + 1 }, () => {
      const range = randomRange(ctx)
      return db
        .insert(cycles)
        .values({
          name: fakeName(ctx.rng),
          ownedById: ctx.userId,
          sortOrder: randint(ctx.rng, 0, 65535),
          startDate: range ? new Date(range.start) : null,
          endDate: range ? new Date(range.end) : null,
          projectId: project.id,
          workspaceId: ctx.workspaceId
        })
        .onConflictDoNothing()
    })
  )
}

/** PD-1112 `create_modules`. */
export async function createModules(db: LancityDb, ctx: Ctx, project: Project, moduleCount: number): Promise<void> {
  await batchAll(
    db,
    Array.from({ length: moduleCount }, () => {
      const range = randomRange(ctx)
      return db
        .insert(modules)
        .values({
          name: fakeName(ctx.rng),
          sortOrder: randint(ctx.rng, 0, 65535),
          startDate: range ? dateOnly(range.start) : null,
          targetDate: range ? dateOnly(range.end) : null,
          projectId: project.id,
          workspaceId: ctx.workspaceId
        })
        .onConflictDoNothing()
    })
  )
}

/** PD-1113 `create_pages`. Page text is capped at 5000 characters (Plane allows 60000) to stay inside D1 row limits. */
export async function createPages(db: LancityDb, ctx: Ctx, project: Project, pagesCount: number): Promise<void> {
  for (const part of chunk(Array.from({ length: pagesCount }), 25)) {
    const created = (await batchAll(
      db,
      part.map(() =>
        db
          .insert(pages)
          .values({
            name: fakeName(ctx.rng),
            workspaceId: ctx.workspaceId,
            ownedById: ctx.userId,
            access: randint(ctx.rng, 0, 1),
            color: fakeHex(ctx.rng),
            descriptionHtml: `<p>${fakeText(ctx.rng, 5000)}</p>`,
            isLocked: false
          })
          .returning({ id: pages.id })
      )
    )) as { id: number }[][]
    await batchAll(
      db,
      created.flat().map(page => db.insert(projectPages).values({ pageId: page.id, projectId: project.id, workspaceId: ctx.workspaceId }))
    )
  }
}

/** PD-1114 `create_page_labels`: half of the project's pages get a random subset of its labels. */
export async function createPageLabels(db: LancityDb, ctx: Ctx, project: Project, pagesCount: number): Promise<void> {
  const labelIds = (await db.select({ id: labels.id }).from(labels).where(eq(labels.projectId, project.id))).map(r => r.id)
  const pageIds = (await db.select({ id: projectPages.pageId }).from(projectPages).where(eq(projectPages.projectId, project.id))).map(r => r.id)
  if (!labelIds.length) return
  const rows = sample(ctx.rng, pageIds, Math.floor(pagesCount / 2)).flatMap(pageId =>
    sample(ctx.rng, labelIds, randint(ctx.rng, 0, labelIds.length - 1)).map(labelId => ({ pageId, labelId, workspaceId: ctx.workspaceId }))
  )
  await batchAll(db, rows.map(row => db.insert(pageLabels).values(row).onConflictDoNothing()))
}

/** PD-1115 `create_issues`: issues with the next sequences, a "created the issue" activity each. Returns them. */
export async function createIssues(db: LancityDb, ctx: Ctx, project: Project, issueCount: number): Promise<{ id: number; sequenceId: number }[]> {
  const stateIds = (
    await db.select({ id: states.id }).from(states).where(and(eq(states.projectId, project.id), isNull(states.deletedAt)))
  ).map(r => r.id)
  const creators = (await db.select({ id: projectMembers.memberId }).from(projectMembers).where(eq(projectMembers.projectId, project.id)))
    .map(r => r.id)
    .filter((id): id is number => id !== null)
  if (!stateIds.length || !creators.length) return []
  const [last] = await db
    .select({ largest: sql<number | null>`max(${issues.sequenceId})` })
    .from(issues)
    .where(eq(issues.projectId, project.id))
  let sequence = (last?.largest ?? 0) + 1
  let sortOrder = 65535
  const created: { id: number; sequenceId: number }[] = []
  for (const part of chunk(Array.from({ length: issueCount }), 30)) {
    const statements = part.map(() => {
      const range = randomRange(ctx)
      const text = fakeText(ctx.rng, 3000)
      const row = {
        stateId: pick(ctx.rng, stateIds),
        projectId: project.id,
        workspaceId: ctx.workspaceId,
        name: text.slice(0, 254),
        descriptionHtml: `<p>${text}</p>`,
        descriptionStripped: text,
        sequenceId: sequence,
        sortOrder,
        startDate: range ? dateOnly(range.start) : null,
        targetDate: range ? dateOnly(range.end) : null,
        priority: pick(ctx.rng, ['urgent', 'high', 'medium', 'low', 'none'] as const),
        createdById: pick(ctx.rng, creators)
      }
      sequence++
      sortOrder += randint(ctx.rng, 0, 1000)
      return db.insert(issues).values(row).returning({ id: issues.id, sequenceId: issues.sequenceId })
    })
    const rows = (await batchAll(db, statements)) as { id: number; sequenceId: number }[][]
    const inserted = rows.flat()
    await batchAll(db, [
      ...inserted.map(issue =>
        db.insert(issueSequences).values({
          issueId: issue.id,
          sequence: issue.sequenceId,
          projectId: project.id,
          workspaceId: ctx.workspaceId
        })
      ),
      ...inserted.map(issue =>
        db.insert(issueActivities).values({
          issueId: issue.id,
          actorId: ctx.userId,
          projectId: project.id,
          workspaceId: ctx.workspaceId,
          comment: 'created the issue',
          verb: 'created',
          createdById: ctx.userId
        })
      )
    ])
    created.push(...inserted)
  }
  if (created.length)
    await db.run(
      sql`insert into project_issue_counters (project_id, last_sequence) values (${project.id}, ${sequence - 1})
        on conflict (project_id) do update set last_sequence = max(last_sequence, excluded.last_sequence)`
    )
  return created
}

/** PD-1116 `create_intake_issues`: issues attached to the default intake with a random status. */
export async function createIntakeIssues(db: LancityDb, ctx: Ctx, project: Project, intakeIssueCount: number): Promise<void> {
  const created = await createIssues(db, ctx, project, intakeIssueCount)
  if (!created.length) return
  let [intake] = await db
    .select({ id: intakes.id })
    .from(intakes)
    .where(and(eq(intakes.projectId, project.id), eq(intakes.name, 'Intake'), eq(intakes.isDefault, true), isNull(intakes.deletedAt)))
  if (!intake)
    [intake] = await db
      .insert(intakes)
      .values({ name: 'Intake', projectId: project.id, workspaceId: ctx.workspaceId, isDefault: true })
      .returning({ id: intakes.id })
  await batchAll(
    db,
    created.map(issue => {
      const status = pick(ctx.rng, [-2, -1, 0, 1, 2] as const)
      return db.insert(intakeIssues).values({
        issueId: issue.id,
        intakeId: intake.id,
        status,
        snoozedTill: status === 0 ? new Date(ctx.now + randint(ctx.rng, 1, 30) * DAY_MS) : null,
        source: 'IN_APP',
        workspaceId: ctx.workspaceId,
        projectId: project.id
      })
    })
  )
}

const projectIssueIds = async (db: LancityDb, project: Project) =>
  (await db.select({ id: issues.id }).from(issues).where(eq(issues.projectId, project.id)).orderBy(issues.id)).map(r => r.id)

/**
 * PD-1117 `create_issue_parent`. Plane builds the list of sub issues but never adds them to the one it saves, so
 * nothing is written there. This version applies the evident intent: a quarter of the issues become parents and
 * up to half of the issues get one of them as parent.
 */
export async function createIssueParent(db: LancityDb, ctx: Ctx, project: Project, issueCount: number): Promise<void> {
  const parentCount = Math.floor(issueCount / 4)
  if (parentCount < 1) return
  const ids = await projectIssueIds(db, project)
  const parents = ids.slice(0, parentCount)
  const subs = ids.slice(parentCount, parentCount + Math.floor(issueCount / 2))
  await batchAll(
    db,
    subs.map(id => db.update(issues).set({ parentId: pick(ctx.rng, parents) }).where(eq(issues.id, id)))
  )
}

/** PD-1118 `create_issue_assignees`. */
export async function createIssueAssignees(db: LancityDb, ctx: Ctx, project: Project, issueCount: number): Promise<void> {
  const members = (await db.select({ id: projectMembers.memberId }).from(projectMembers).where(eq(projectMembers.projectId, project.id)))
    .map(r => r.id)
    .filter((id): id is number => id !== null)
  if (!members.length) return
  const rows = sample(ctx.rng, await projectIssueIds(db, project), Math.floor(issueCount / 2)).flatMap(issueId =>
    sample(ctx.rng, members, randint(ctx.rng, 0, members.length - 1)).map(assigneeId => ({
      issueId,
      assigneeId,
      projectId: project.id,
      workspaceId: ctx.workspaceId
    }))
  )
  await batchAll(db, rows.map(row => db.insert(issueAssignees).values(row).onConflictDoNothing()))
}

/** PD-1119 `create_issue_labels`: each issue gets 0 to 5 labels. */
export async function createIssueLabels(db: LancityDb, ctx: Ctx, project: Project): Promise<void> {
  const labelIds = (await db.select({ id: labels.id }).from(labels).where(eq(labels.projectId, project.id))).map(r => r.id)
  const rows = (await projectIssueIds(db, project)).flatMap(issueId =>
    sample(ctx.rng, labelIds, randint(ctx.rng, 0, 5)).map(labelId => ({ issueId, labelId, projectId: project.id, workspaceId: ctx.workspaceId }))
  )
  await batchAll(db, rows.map(row => db.insert(issueLabels).values(row).onConflictDoNothing()))
}

/** PD-1120 `create_cycle_issues`: half of the issues are added to a random cycle. */
export async function createCycleIssues(db: LancityDb, ctx: Ctx, project: Project, issueCount: number): Promise<void> {
  const cycleIds = (await db.select({ id: cycles.id }).from(cycles).where(eq(cycles.projectId, project.id))).map(r => r.id)
  if (!cycleIds.length) return
  const rows = sample(ctx.rng, await projectIssueIds(db, project), Math.floor(issueCount / 2)).map(issueId => ({
    issueId,
    cycleId: pick(ctx.rng, cycleIds),
    projectId: project.id,
    workspaceId: ctx.workspaceId
  }))
  await batchAll(db, rows.map(row => db.insert(cycleIssues).values(row).onConflictDoNothing()))
}

/** PD-1121 `create_module_issues`: each issue is added to 0 to 5 modules. */
export async function createModuleIssues(db: LancityDb, ctx: Ctx, project: Project): Promise<void> {
  const moduleIds = (await db.select({ id: modules.id }).from(modules).where(eq(modules.projectId, project.id))).map(r => r.id)
  const rows = (await projectIssueIds(db, project)).flatMap(issueId =>
    sample(ctx.rng, moduleIds, randint(ctx.rng, 0, 5)).map(moduleId => ({ issueId, moduleId, projectId: project.id, workspaceId: ctx.workspaceId }))
  )
  await batchAll(db, rows.map(row => db.insert(moduleIssues).values(row).onConflictDoNothing()))
}

/**
 * PD-1122 `create_dummy_data`: one project with members, states, labels, cycles, modules, pages, issues, intake
 * issues and their links, owned by `email`. The workspace and the user must exist.
 */
export async function createDummyData(db: LancityDb, input: DummyDataInput, options: { rng?: Rng; now?: number } = {}) {
  const [workspace] = await db.select({ id: workspaces.id }).from(workspaces).where(and(eq(workspaces.slug, input.slug), isNull(workspaces.deletedAt)))
  if (!workspace) throw new Error(`Workspace ${input.slug} does not exist`)
  const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, input.email.trim().toLowerCase()))
  if (!owner) throw new Error(`User ${input.email} does not exist`)
  const ctx: Ctx = { workspaceId: workspace.id, userId: owner.id, rng: options.rng ?? createRng(), now: options.now ?? Date.now() }
  const project = await createProject(db, ctx)
  await createProjectMembers(db, ctx, project, input.members)
  await createStates(db, ctx, project)
  await createLabels(db, ctx, project)
  await createCycles(db, ctx, project, input.cycleCount)
  await createModules(db, ctx, project, input.moduleCount)
  await createPages(db, ctx, project, input.pagesCount)
  await createPageLabels(db, ctx, project, input.pagesCount)
  await createIssues(db, ctx, project, input.issueCount)
  await createIntakeIssues(db, ctx, project, input.intakeIssueCount)
  await createIssueParent(db, ctx, project, input.issueCount)
  await createIssueAssignees(db, ctx, project, input.issueCount)
  await createIssueLabels(db, ctx, project)
  await createCycleIssues(db, ctx, project, input.issueCount)
  await createModuleIssues(db, ctx, project)
  return { projectId: project.id, workspaceId: workspace.id }
}
