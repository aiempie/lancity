import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { account, session, user } from '@/db/schema/auth'
import { descriptions } from '@/db/schema/content'
import { userSecurity } from '@/db/schema/ext-p1-auth'
import { cacheEntries } from '@/db/schema/ext-p1-platform'
import { instanceConfigurations, instances } from '@/db/schema/instance'
import { issueComments, issues } from '@/db/schema/issue'
import { projectMembers, projects, workspaceMembers, workspaces } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import { isPasswordStrong } from '@/server/identity/password'
import { changes } from '@/server/maintenance/cascade'
import { userPropertyInsert } from '@/server/project/model-rules'
import type { LancityDb } from '@/types/database/schema'
import type { CreateProjectMemberInput, FixDuplicateSequencesInput } from '@/types/instance/p4-maintenance-schema'

const notFound = (message: string) => new ServiceError(404, 'NOT_FOUND', message)
const bad = (code: string, message: string) => new ServiceError(400, code, message)
const normalizeEmail = (email: string) => email.trim().toLowerCase()

async function findUser(db: LancityDb, email: string) {
  const [row] = await db.select({ id: user.id, email: user.email }).from(user).where(eq(user.email, normalizeEmail(email)))
  if (!row) throw notFound(`User with ${normalizeEmail(email)} does not exist`)
  return row
}

/** PD-1251/1252 `activate_user`: mark the account active again (Better Auth has no flag, so `user_security.is_active`). */
export async function activateUser(db: LancityDb, email: string) {
  const person = await findUser(db, email)
  await db
    .insert(userSecurity)
    .values({ userId: person.id, isActive: true })
    .onConflictDoUpdate({ target: userSecurity.userId, set: { isActive: true } })
  return { userId: person.id, message: 'User activated successfully' }
}

/**
 * PD-1274/1275 `reset_password`: set a new password for the account. `hash` must be Better Auth's password hasher
 * (`hashPassword` from `better-auth/crypto`) so the user can sign in with it. Existing sessions are revoked.
 * Weak passwords are refused like Plane's `is_password_strong`.
 */
export async function resetPassword(db: LancityDb, email: string, password: string, hash: (plain: string) => Promise<string>) {
  if (!password.trim()) throw bad('BLANK_PASSWORD', "Blank passwords aren't allowed.")
  if (!isPasswordStrong(password)) throw bad('PASSWORD_TOO_WEAK', 'Password is too common please set a complex password')
  const person = await findUser(db, email)
  const hashed = await hash(password)
  const updated = changes(
    await db
      .update(account)
      .set({ password: hashed, updatedAt: new Date() })
      .where(and(eq(account.userId, person.id), eq(account.providerId, 'credential')))
  )
  const now = new Date()
  await db.batch([
    ...(updated
      ? []
      : [
          db.insert(account).values({
            accountId: String(person.id),
            providerId: 'credential',
            userId: person.id,
            password: hashed,
            createdAt: now,
            updatedAt: now
          })
        ]),
    db.insert(userSecurity).values({ userId: person.id, isPasswordAutoset: false }).onConflictDoUpdate({
      target: userSecurity.userId,
      set: { isPasswordAutoset: false }
    }),
    db.delete(session).where(eq(session.userId, person.id))
  ] as unknown as Parameters<typeof db.batch>[0])
  return { userId: person.id, message: 'User password updated successfully' }
}

/** PD-1253/1254 `clear_cache`: delete one cache key, or every entry. Plane's Redis cache is `cache_entries` here. */
export async function clearCache(db: LancityDb, key?: string) {
  if (key) {
    await db.delete(cacheEntries).where(eq(cacheEntries.key, key))
    return { message: `Cache Cleared for key: ${key}` }
  }
  await db.delete(cacheEntries)
  return { message: 'Cache Cleared' }
}

/** PD-1260/1261 `create_project_member`: add (or reactivate) a workspace member in a project. */
export async function createProjectMember(db: LancityDb, input: CreateProjectMemberInput) {
  const person = await findUser(db, input.email)
  const [project] = await db
    .select({ id: projects.id, workspaceId: projects.workspaceId })
    .from(projects)
    .where(and(eq(projects.id, input.projectId), isNull(projects.deletedAt)))
  if (!project) throw notFound('Project not found')
  const [member] = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, project.workspaceId),
        eq(workspaceMembers.memberId, person.id),
        eq(workspaceMembers.isActive, true),
        isNull(workspaceMembers.deletedAt)
      )
    )
  if (!member) throw bad('NOT_WORKSPACE_MEMBER', 'User not member in workspace')
  const [existing] = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.memberId, person.id), isNull(projectMembers.deletedAt)))
  if (existing) await db.update(projectMembers).set({ isActive: true, role: input.role }).where(eq(projectMembers.id, existing.id))
  else
    await db
      .insert(projectMembers)
      .values({ projectId: project.id, workspaceId: project.workspaceId, memberId: person.id, role: input.role })
  await userPropertyInsert(db, { projectId: project.id, userId: person.id, actorId: person.id })
  return { message: `User ${normalizeEmail(input.email)} added to project ${project.id}` }
}

/** PD-1272/1273 `reactivate_workspace_member`. Reports what it left inactive instead of printing warnings. */
export async function reactivateWorkspaceMember(db: LancityDb, input: { slug: string; email: string }) {
  const person = await findUser(db, input.email)
  const [workspace] = await db
    .select({ id: workspaces.id, slug: workspaces.slug })
    .from(workspaces)
    .where(and(eq(workspaces.slug, input.slug.trim()), isNull(workspaces.deletedAt)))
  if (!workspace) throw notFound(`Workspace with slug ${input.slug} does not exist`)
  const [membership] = await db
    .select({ id: workspaceMembers.id, isActive: workspaceMembers.isActive, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.memberId, person.id), isNull(workspaceMembers.deletedAt)))
  if (!membership) throw notFound(`User ${person.email} is not a member of workspace ${workspace.slug}`)
  const notes: string[] = []
  if (!membership.isActive) await db.update(workspaceMembers).set({ isActive: true }).where(eq(workspaceMembers.id, membership.id))
  const [inactive] = await db
    .select({ count: sql<number>`count(*)` })
    .from(projectMembers)
    .where(and(eq(projectMembers.workspaceId, workspace.id), eq(projectMembers.memberId, person.id), eq(projectMembers.isActive, false)))
  if (inactive?.count)
    notes.push(`${inactive.count} project membership(s) remain inactive; removing a member also deactivates their project memberships`)
  const [security] = await db.select({ isActive: userSecurity.isActive }).from(userSecurity).where(eq(userSecurity.userId, person.id))
  if (security && !security.isActive) notes.push(`The account for ${person.email} is deactivated and cannot sign in. Activate it first.`)
  return {
    status: membership.isActive ? ('already_active' as const) : ('reactivated' as const),
    role: membership.role,
    notes
  }
}

/** PD-1285/1286 `update_deleted_workspace_slug`: free the slug of a soft deleted workspace by appending `__<epoch seconds>`. */
export type DeletedSlugResult = {
  status: 'not_found' | 'not_deleted' | 'already_updated' | 'dry_run' | 'updated'
  message: string
  slug?: string
}

export async function updateDeletedWorkspaceSlug(db: LancityDb, input: { slug: string; dryRun?: boolean }): Promise<DeletedSlugResult> {
  const [workspace] = await db
    .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, deletedAt: workspaces.deletedAt })
    .from(workspaces)
    .where(eq(workspaces.slug, input.slug))
  if (!workspace) return { status: 'not_found', message: `Workspace with slug '${input.slug}' not found.` }
  if (!workspace.deletedAt) return { status: 'not_deleted', message: `Workspace '${workspace.name}' (slug: ${workspace.slug}) is not deleted.` }
  if (/__\d+$/.test(workspace.slug))
    return { status: 'already_updated', message: `Workspace '${workspace.name}' (slug: ${workspace.slug}) already has a timestamp appended.` }
  const slug = `${workspace.slug}__${Math.floor(workspace.deletedAt.getTime() / 1000)}`
  if (!input.dryRun) await db.update(workspaces).set({ slug }).where(eq(workspaces.id, workspace.id))
  return { status: input.dryRun ? 'dry_run' : 'updated', slug, message: `Workspace '${workspace.name}' slug ${workspace.slug} -> ${slug}` }
}

/** PD-1263 `strict_str_to_int`: digits only, optional leading minus. */
export function strictStrToInt(text: string): number {
  if (!/^-?\d+$/.test(text)) throw new Error('Invalid integer string')
  return Number(text)
}

/**
 * PD-1262/1264 `fix_duplicate_sequences`. Lancity's unique index `issues_project_sequence_unique` makes duplicates
 * impossible, so this only matters for data loaded while that index was missing. The first issue keeps the
 * sequence; the others get the next numbers after the project's largest. Plane's advisory lock has no D1
 * equivalent, so the updates run in one `db.batch` (atomic).
 */
export async function fixDuplicateSequences(db: LancityDb, input: FixDuplicateSequencesInput) {
  const [identifier, rawSequence, ...rest] = input.issueIdentifier.split('-')
  if (!identifier || rawSequence === undefined || rest.length) throw bad('INVALID_IDENTIFIER', 'Invalid issue identifier format')
  const sequence = strictStrToInt(rawSequence)
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .where(and(sql`upper(${projects.identifier}) = ${identifier.toUpperCase()}`, eq(workspaces.slug, input.workspaceSlug), isNull(projects.deletedAt)))
  if (!project) throw notFound('Project not found')
  const duplicates = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.projectId, project.id), eq(issues.sequenceId, sequence), isNull(issues.deletedAt)))
    .orderBy(asc(issues.id))
  if (duplicates.length < 2) throw bad('NO_DUPLICATES', 'No duplicate issues found with the given identifier')
  const [largest] = await db
    .select({
      value: sql<number>`max(coalesce((select max(sequence) from issue_sequences where project_id = ${project.id}), 0), coalesce(max(${issues.sequenceId}), 0))`
    })
    .from(issues)
    .where(eq(issues.projectId, project.id))
  const last = largest?.value ?? 0
  const extras = duplicates.slice(1)
  await db.batch(
    extras.flatMap((issue, index) => [
      db.update(issues).set({ sequenceId: last + index + 1 }).where(eq(issues.id, issue.id)),
      db.run(sql`update issue_sequences set sequence = ${last + index + 1} where issue_id = ${issue.id}`)
    ]) as unknown as Parameters<typeof db.batch>[0]
  )
  await db.run(
    sql`insert into project_issue_counters (project_id, last_sequence) values (${project.id}, ${last + extras.length})
      on conflict (project_id) do update set last_sequence = max(last_sequence, excluded.last_sequence)`
  )
  return { found: duplicates.length, reassigned: extras.map((issue, index) => ({ issueId: issue.id, sequenceId: last + index + 1 })) }
}

/**
 * PD-1255 `copy_issue_comment_to_description`: give every comment without a description row one, copying its
 * content. Works in rounds of 100 and stops after `maxRounds`; call again while `done` is false (idempotent).
 */
export async function copyIssueCommentToDescription(db: LancityDb, options: { batchSize?: number; maxRounds?: number } = {}) {
  const batchSize = options.batchSize ?? 100
  let copied = 0
  for (let round = 0; round < (options.maxRounds ?? 10); round++) {
    const comments = await db
      .select()
      .from(issueComments)
      .where(and(isNull(issueComments.descriptionId), isNull(issueComments.deletedAt)))
      .orderBy(asc(issueComments.createdAt), asc(issueComments.id))
      .limit(batchSize)
    if (!comments.length) return { copied, done: true }
    const created = (await db.batch(
      comments.map(comment =>
        db
          .insert(descriptions)
          .values({
            createdAt: comment.createdAt,
            updatedAt: comment.updatedAt,
            descriptionJson: comment.commentJson,
            descriptionHtml: comment.commentHtml,
            descriptionStripped: comment.commentStripped,
            projectId: comment.projectId,
            workspaceId: comment.workspaceId,
            createdById: comment.createdById,
            updatedById: comment.updatedById
          })
          .returning({ id: descriptions.id })
      ) as unknown as Parameters<typeof db.batch>[0]
    )) as unknown as { id: number }[][]
    await db.batch(
      comments.map((comment, i) =>
        db.update(issueComments).set({ descriptionId: created[i][0].id }).where(eq(issueComments.id, comment.id))
      ) as unknown as Parameters<typeof db.batch>[0]
    )
    copied += comments.length
  }
  return { copied, done: false }
}

type ConfigItem = { key: string; category: string; encrypted?: boolean; fallback?: string }
/** Plane `instance_config_variables` (core.py; extended.py is empty). `fallback` is the value used when the env var is unset. */
export const INSTANCE_CONFIG_VARIABLES: ConfigItem[] = [
  { key: 'ENABLE_SIGNUP', category: 'AUTHENTICATION', fallback: '1' },
  { key: 'ENABLE_EMAIL_PASSWORD', category: 'AUTHENTICATION', fallback: '1' },
  { key: 'ENABLE_MAGIC_LINK_LOGIN', category: 'AUTHENTICATION', fallback: '0' },
  { key: 'DISABLE_WORKSPACE_CREATION', category: 'WORKSPACE_MANAGEMENT', fallback: '0' },
  { key: 'IS_GOOGLE_ENABLED', category: 'GOOGLE', fallback: '0' },
  { key: 'GOOGLE_CLIENT_ID', category: 'GOOGLE' },
  { key: 'GOOGLE_CLIENT_SECRET', category: 'GOOGLE', encrypted: true },
  { key: 'ENABLE_GOOGLE_SYNC', category: 'GOOGLE', fallback: '0' },
  { key: 'IS_GITHUB_ENABLED', category: 'GITHUB', fallback: '0' },
  { key: 'GITHUB_CLIENT_ID', category: 'GITHUB' },
  { key: 'GITHUB_CLIENT_SECRET', category: 'GITHUB', encrypted: true },
  { key: 'GITHUB_ORGANIZATION_ID', category: 'GITHUB' },
  { key: 'ENABLE_GITHUB_SYNC', category: 'GITHUB', fallback: '0' },
  { key: 'IS_GITLAB_ENABLED', category: 'GITLAB', fallback: '0' },
  { key: 'GITLAB_HOST', category: 'GITLAB' },
  { key: 'GITLAB_CLIENT_ID', category: 'GITLAB' },
  { key: 'GITLAB_CLIENT_SECRET', category: 'GITLAB', encrypted: true },
  { key: 'ENABLE_GITLAB_SYNC', category: 'GITLAB', fallback: '0' },
  { key: 'IS_GITEA_ENABLED', category: 'GITEA', fallback: '0' },
  { key: 'GITEA_HOST', category: 'GITEA' },
  { key: 'GITEA_CLIENT_ID', category: 'GITEA' },
  { key: 'GITEA_CLIENT_SECRET', category: 'GITEA', encrypted: true },
  { key: 'ENABLE_GITEA_SYNC', category: 'GITEA', fallback: '0' },
  { key: 'ENABLE_SMTP', category: 'SMTP', fallback: '0' },
  { key: 'EMAIL_HOST', category: 'SMTP', fallback: '' },
  { key: 'EMAIL_HOST_USER', category: 'SMTP', fallback: '' },
  { key: 'EMAIL_HOST_PASSWORD', category: 'SMTP', encrypted: true, fallback: '' },
  { key: 'EMAIL_PORT', category: 'SMTP', fallback: '587' },
  { key: 'EMAIL_FROM', category: 'SMTP', fallback: '' },
  { key: 'EMAIL_USE_TLS', category: 'SMTP', fallback: '1' },
  { key: 'EMAIL_USE_SSL', category: 'SMTP', fallback: '0' },
  { key: 'LLM_API_KEY', category: 'AI', encrypted: true },
  { key: 'LLM_PROVIDER', category: 'AI', fallback: 'openai' },
  { key: 'LLM_MODEL', category: 'AI', fallback: 'gpt-4o-mini' },
  { key: 'GPT_ENGINE', category: 'AI', fallback: 'gpt-3.5-turbo' },
  { key: 'UNSPLASH_ACCESS_KEY', category: 'UNSPLASH', encrypted: true, fallback: '' }
]

/**
 * PD-1578 `configure_instance`: create the configuration rows that are missing, with the value of the matching
 * environment variable (or Plane's default). Existing rows are never changed. `encrypt` is `encryptData` from the
 * instance group; it is only called for secrets that have a value.
 */
export async function configureInstance(
  db: LancityDb,
  env: Record<string, unknown>,
  encrypt: (plain: string) => Promise<string>
) {
  if (!env.BETTER_AUTH_SECRET) throw bad('SECRET_REQUIRED', 'BETTER_AUTH_SECRET env variable is required.')
  const existing = new Set(
    (await db.select({ key: instanceConfigurations.key }).from(instanceConfigurations)).map(row => row.key)
  )
  const created: string[] = []
  for (const item of INSTANCE_CONFIG_VARIABLES) {
    if (existing.has(item.key)) continue
    const raw = typeof env[item.key] === 'string' ? (env[item.key] as string) : item.fallback
    const value = item.encrypted && raw ? await encrypt(raw) : (raw ?? null)
    await db
      .insert(instanceConfigurations)
      .values({ key: item.key, category: item.category, isEncrypted: item.encrypted ?? false, value })
      .onConflictDoNothing()
    created.push(item.key)
  }
  return { created, existing: INSTANCE_CONFIG_VARIABLES.filter(item => existing.has(item.key)).map(item => item.key) }
}

export const DEFAULT_APP_VERSION = 'v0.1.0'
export const PLANE_LATEST_RELEASE_URL = 'https://api.github.com/repos/makeplane/plane/releases/latest'

/** PD-1580 `check_for_current_version`: `APP_VERSION`, else `v0.1.0` (a Worker has no package.json to read). */
export const checkForCurrentVersion = (env: Record<string, unknown>) =>
  typeof env.APP_VERSION === 'string' && env.APP_VERSION ? env.APP_VERSION : DEFAULT_APP_VERSION

/** PD-1581 `check_for_latest_version`: the release feed's `tag_name`, or `fallback` on any failure. */
export async function checkForLatestVersion(
  fallback: string,
  env: Record<string, unknown> = {},
  fetcher: typeof fetch = fetch
): Promise<string> {
  const url = typeof env.LATEST_VERSION_URL === 'string' && env.LATEST_VERSION_URL ? env.LATEST_VERSION_URL : PLANE_LATEST_RELEASE_URL
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'lancity' } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = (await response.json()) as { tag_name?: string }
    return data.tag_name || fallback
  } catch {
    return fallback
  }
}

/**
 * PD-1579/1582 `register_instance`: create the instance row, or refresh version fields when it exists.
 * The telemetry push (`push_instance_metrics.delay()`) is queued by the caller.
 */
export async function registerInstance(
  db: LancityDb,
  options: { env: Record<string, unknown>; fetcher?: typeof fetch; name?: string }
) {
  const current = checkForCurrentVersion(options.env)
  const latest = await checkForLatestVersion(current, options.env, options.fetcher)
  const isTest = options.env.IS_TEST === '1'
  const [instance] = await db.select().from(instances).where(isNull(instances.deletedAt)).orderBy(asc(instances.id)).limit(1)
  const now = new Date()
  if (!instance) {
    const bytes = crypto.getRandomValues(new Uint8Array(12))
    const [created] = await db
      .insert(instances)
      .values({
        instanceName: options.name ?? 'Lancity',
        instanceId: Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''),
        currentVersion: current,
        latestVersion: latest,
        lastCheckedAt: now,
        isTest,
        edition: 'PLANE_COMMUNITY'
      })
      .returning({ id: instances.id })
    return { registered: true, instanceId: created.id, currentVersion: current, latestVersion: latest }
  }
  await db
    .update(instances)
    .set({ lastCheckedAt: now, currentVersion: current, latestVersion: latest, isTest, edition: 'PLANE_COMMUNITY' })
    .where(eq(instances.id, instance.id))
  return { registered: false, instanceId: instance.id, currentVersion: current, latestVersion: latest }
}
