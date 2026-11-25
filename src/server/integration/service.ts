import { and, eq, isNull } from 'drizzle-orm'
import { integrations, workspaceIntegrations } from '@/db/schema/integration'
import { projects, workspaces } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import type { InfraEnv } from '@/server/common/env'
import { ROLE, requireProjectRole, requireWorkspaceRole } from '@/server/common/permissions'
import { getConfigurationValues, getLlmConfig, getLlmResponse } from '@/server/integration/llm'
import { getWorkspace } from '@/server/workspace/service'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { AiAssistantInput, UnsplashQuery } from '@/types/integration/p3-integration-schema'

export { getConfigLlmProvider, getLlmConfig, getLlmResponse } from '@/server/integration/llm'

export async function listWorkspaceIntegrations(db: LancityDb, actor: Actor, slug: string) {
  const { workspace } = await getWorkspace(db, actor, slug, 20)
  return db
    .select({
      id: workspaceIntegrations.id,
      title: integrations.title,
      provider: integrations.provider,
      verified: integrations.verified,
      createdAt: workspaceIntegrations.createdAt
    })
    .from(workspaceIntegrations)
    .innerJoin(integrations, eq(integrations.id, workspaceIntegrations.integrationId))
    .where(
      and(
        eq(workspaceIntegrations.workspaceId, workspace.id),
        isNull(workspaceIntegrations.deletedAt),
        isNull(integrations.deletedAt)
      )
    )
    .orderBy(integrations.title)
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)

/** Shared part of both AI endpoints: LLM configuration, task check and the completion. */
async function completion(db: LancityDb, env: InfraEnv, input: AiAssistantInput, fetcher?: typeof fetch) {
  const config = await getLlmConfig(db, env)
  if (!config) throw new ServiceError(400, 'LLM_NOT_CONFIGURED', 'LLM provider API key and model are required')
  if (!input.task) throw new ServiceError(400, 'TASK_REQUIRED', 'Task is required')
  const { text, error } = await getLlmResponse(input.task, input.prompt ?? '', config, fetcher)
  if (!text || error) throw new ServiceError(500, 'INTERNAL_ERROR', 'An internal error has occurred.')
  // Plane returns the raw text with newlines turned into <br/>. Model output is untrusted, so it is escaped first.
  return { response: text, response_html: escapeHtml(text).replaceAll('\n', '<br/>') }
}

/** Plane `WorkspaceGPTIntegrationEndpoint.post` (workspace admins and members). */
export async function createWorkspaceGPTIntegration(
  db: LancityDb,
  actor: Actor,
  env: InfraEnv,
  slug: string,
  input: AiAssistantInput,
  fetcher?: typeof fetch
) {
  await requireWorkspaceRole(db, actor, slug, [ROLE.ADMIN, ROLE.MEMBER])
  return completion(db, env, input, fetcher)
}

/** Plane `GPTIntegrationEndpoint.post` (project admins and members). Adds the lite project and workspace. */
export async function createGptIntegration(
  db: LancityDb,
  actor: Actor,
  env: InfraEnv,
  slug: string,
  projectId: number,
  input: AiAssistantInput,
  fetcher?: typeof fetch
) {
  const { workspaceId } = await requireProjectRole(db, actor, slug, projectId, [ROLE.ADMIN, ROLE.MEMBER])
  const result = await completion(db, env, input, fetcher)
  const [[project], [workspace]] = await Promise.all([
    db
      .select({
        id: projects.id,
        identifier: projects.identifier,
        name: projects.name,
        coverImage: projects.coverImage,
        logoProps: projects.logoProps
      })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)))
      .limit(1),
    db
      .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1)
  ])
  if (!project || !workspace) throw new ServiceError(404, 'NOT_FOUND', 'The required object does not exist.')
  return { ...result, project_detail: project, workspace_detail: workspace }
}

/**
 * Plane `UnsplashEndpoint.get`: proxy the search (`query`) or the photo list. Without `UNSPLASH_ACCESS_KEY` the
 * answer is an empty list. The upstream status and JSON are passed through. Plane builds the URL by string
 * concatenation (and writes `page=$1` for searches); the parameters are encoded here and `page` is plain.
 */
export async function getUnsplash(db: LancityDb, env: InfraEnv, query: UnsplashQuery, fetcher: typeof fetch = fetch) {
  const { UNSPLASH_ACCESS_KEY: accessKey } = await getConfigurationValues(db, env, ['UNSPLASH_ACCESS_KEY'] as const)
  if (!accessKey) return { status: 200, body: [] as unknown }
  const url = new URL(query.query ? 'https://api.unsplash.com/search/photos/' : 'https://api.unsplash.com/photos/')
  if (query.query) url.searchParams.set('query', query.query)
  url.searchParams.set('page', String(query.page))
  url.searchParams.set('per_page', String(query.per_page))
  const response = await fetcher(url, {
    headers: { 'content-type': 'application/json', authorization: `Client-ID ${accessKey}` },
    signal: AbortSignal.timeout(15_000)
  })
  const body = (await response.json().catch(() => ({}))) as unknown
  return { status: response.status, body }
}
