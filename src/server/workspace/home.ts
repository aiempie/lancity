import { and, eq, isNull } from 'drizzle-orm'
import { workspaceHomePreferences } from '@/db/schema/workspace'
import { ServiceError } from '@/server/common/errors'
import { getWorkspace } from '@/server/workspace/service'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { UpdateWorkspaceHomePreference } from '@/types/workspace/schema'

// WorkspaceHomePreference.HomeWidgetKeys without quick_tutorial and new_at_plane, which Plane never auto-creates.
const DEFAULT_KEYS = ['quick_links', 'recents', 'my_stickies'] as const

const owned = (workspaceId: number, userId: number) =>
  and(
    eq(workspaceHomePreferences.workspaceId, workspaceId),
    eq(workspaceHomePreferences.userId, userId),
    isNull(workspaceHomePreferences.deletedAt)
  )

const publicFields = {
  key: workspaceHomePreferences.key,
  is_enabled: workspaceHomePreferences.isEnabled,
  config: workspaceHomePreferences.config,
  sort_order: workspaceHomePreferences.sortOrder
}

/** WorkspaceHomePreferenceViewSet.get: create the missing default widgets, then list every widget of the user. */
export async function getWorkspaceHomePreference(db: LancityDb, actor: Actor, slug: string) {
  const { workspace } = await getWorkspace(db, actor, slug)
  const existing = await db
    .select({ key: workspaceHomePreferences.key })
    .from(workspaceHomePreferences)
    .where(owned(workspace.id, actor.userId))
  const have = new Set(existing.map(row => row.key))
  const missing = DEFAULT_KEYS.filter(key => !have.has(key))
  if (missing.length)
    await db
      .insert(workspaceHomePreferences)
      .values(
        missing.map((key, index) => ({
          key,
          userId: actor.userId,
          workspaceId: workspace.id,
          sortOrder: 1000 - (index + 1),
          createdById: actor.userId,
          updatedById: actor.userId
        }))
      )
      .onConflictDoNothing()
  return db.select(publicFields).from(workspaceHomePreferences).where(owned(workspace.id, actor.userId))
}

/** WorkspaceHomePreferenceViewSet.patch: update one widget by key. */
export async function updateWorkspaceHomePreference(
  db: LancityDb,
  actor: Actor,
  slug: string,
  key: string,
  input: UpdateWorkspaceHomePreference
) {
  const { workspace } = await getWorkspace(db, actor, slug)
  const [updated] = await db
    .update(workspaceHomePreferences)
    .set({ isEnabled: input.is_enabled, sortOrder: input.sort_order, updatedById: actor.userId })
    .where(and(owned(workspace.id, actor.userId), eq(workspaceHomePreferences.key, key)))
    .returning({
      key: workspaceHomePreferences.key,
      is_enabled: workspaceHomePreferences.isEnabled,
      sort_order: workspaceHomePreferences.sortOrder
    })
  if (!updated) throw new ServiceError(400, 'PREFERENCE_NOT_FOUND', 'Preference not found')
  return updated
}
