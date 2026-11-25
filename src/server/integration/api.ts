import { and, desc, eq, isNull } from 'drizzle-orm'
import { apiTokens } from '@/db/schema/integration'
import { userSecurity } from '@/db/schema/ext-p1-auth'
import { notFoundError } from '@/server/common/errors'
import { generateLabelToken, generateToken, hashApiToken } from '@/server/integration/model-rules'
import { requireWorkspaceMember } from '@/server/workspace/service'
import { toApiTokenResponse } from '@/server/integration/presenters'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { ApiTokenCreate, ApiTokenUpdate } from '@/types/integration/p3-integration-schema'

const columns = {
  id: apiTokens.id,
  label: apiTokens.label,
  description: apiTokens.description,
  userType: apiTokens.userType,
  userId: apiTokens.userId,
  workspaceId: apiTokens.workspaceId,
  expiredAt: apiTokens.expiredAt,
  isActive: apiTokens.isActive,
  lastUsed: apiTokens.lastUsed,
  createdAt: apiTokens.createdAt,
  updatedAt: apiTokens.updatedAt
}

const owned = (actor: Actor, tokenId?: number) =>
  and(
    eq(apiTokens.userId, actor.userId),
    isNull(apiTokens.deletedAt),
    tokenId === undefined ? undefined : eq(apiTokens.id, tokenId)
  )

const tokenNotFound = () => notFoundError('API token not found', 'API_TOKEN_NOT_FOUND')

/**
 * Plane `ApiTokenEndpoint.post`. The token is returned once and only its SHA-256 digest is stored.
 * `user_type` is 1 for bot users, 0 for people.
 */
export async function createApiToken(db: LancityDb, actor: Actor, input: ApiTokenCreate) {
  await requireWorkspaceMember(db, actor, input.workspaceId)
  const [security] = await db
    .select({ isBot: userSecurity.isBot })
    .from(userSecurity)
    .where(eq(userSecurity.userId, actor.userId))
    .limit(1)
  const token = generateToken()
  const [created] = await db
    .insert(apiTokens)
    .values({
      token: await hashApiToken(token),
      label: input.label ?? generateLabelToken(),
      description: input.description ?? '',
      userId: actor.userId,
      workspaceId: input.workspaceId,
      userType: security?.isBot ? 1 : 0,
      expiredAt: input.expiredAt ?? null,
      createdById: actor.userId
    })
    .returning(columns)
  return toApiTokenResponse(created, { token })
}

/** Plane `ApiTokenEndpoint.get` without a pk: the caller's tokens, newest first, without the token value. */
export async function listApiTokens(db: LancityDb, actor: Actor) {
  const rows = await db
    .select(columns)
    .from(apiTokens)
    .where(owned(actor))
    .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id))
  return rows.map(row => toApiTokenResponse(row))
}

/** Plane `ApiTokenEndpoint.get` with a pk. */
export async function getApiToken(db: LancityDb, actor: Actor, tokenId: number) {
  const [row] = await db.select(columns).from(apiTokens).where(owned(actor, tokenId)).limit(1)
  if (!row) throw tokenNotFound()
  return toApiTokenResponse(row)
}

/** Plane `ApiTokenEndpoint.patch`: only `label` and `description` are writable. */
export async function updateApiToken(db: LancityDb, actor: Actor, tokenId: number, input: ApiTokenUpdate) {
  const [row] = await db
    .update(apiTokens)
    .set({ ...input, updatedById: actor.userId })
    .where(owned(actor, tokenId))
    .returning(columns)
  if (!row) throw tokenNotFound()
  return toApiTokenResponse(row)
}

/** Plane `ApiTokenEndpoint.delete` (a soft delete). The token stops authenticating at once. */
export async function deleteApiToken(db: LancityDb, actor: Actor, tokenId: number) {
  const [row] = await db
    .update(apiTokens)
    .set({ deletedAt: new Date(), isActive: false, updatedById: actor.userId })
    .where(owned(actor, tokenId))
    .returning({ id: apiTokens.id })
  if (!row) throw tokenNotFound()
}
