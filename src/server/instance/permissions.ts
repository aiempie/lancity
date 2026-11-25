import { and, asc, eq, isNull } from 'drizzle-orm'
import { instanceAdmins, instances } from '@/db/schema/instance'
import { ServiceError } from '@/server/common/errors'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

export async function currentInstance(db: LancityDb) {
  const [instance] = await db
    .select()
    .from(instances)
    .where(isNull(instances.deletedAt))
    .orderBy(asc(instances.id))
    .limit(1)
  return instance
}

export async function requireInstanceAdmin(db: LancityDb, actor: Actor) {
  const instance = await currentInstance(db)
  if (!instance) throw new ServiceError(403, 'FORBIDDEN', 'Instance admin access is required')
  const [admin] = await db
    .select()
    .from(instanceAdmins)
    .where(
      and(
        eq(instanceAdmins.instanceId, instance.id),
        eq(instanceAdmins.userId, actor.userId),
        eq(instanceAdmins.role, 20),
        isNull(instanceAdmins.deletedAt)
      )
    )
    .limit(1)
  if (!admin) throw new ServiceError(403, 'FORBIDDEN', 'Instance admin access is required')
  return { instance, admin }
}
