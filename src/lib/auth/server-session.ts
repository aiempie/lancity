import 'server-only'

import { headers } from 'next/headers'
import { createAuth } from '@/lib/auth/auth'
import { ServiceError } from '@/server/common/errors'
import { sessionUserIdSchema, type Actor } from '@/types/auth/schema'

/** Resolve the session through Better Auth; request headers are never an identity themselves. */
export async function getServerSession(requestHeaders?: Headers) {
  const session = await createAuth().api.getSession({ headers: requestHeaders ?? (await headers()) })
  return session && sessionUserIdSchema.safeParse(session.user.id).success ? session : null
}

export async function getActor(requestHeaders?: Headers): Promise<Actor | null> {
  const session = await getServerSession(requestHeaders)
  if (!session) return null
  const result = sessionUserIdSchema.safeParse(session.user.id)
  return result.success ? { userId: result.data } : null
}

export async function requireActor(requestHeaders?: Headers): Promise<Actor> {
  const actor = await getActor(requestHeaders)
  if (!actor) throw new ServiceError(401, 'UNAUTHORIZED', 'Authentication required')
  return actor
}
