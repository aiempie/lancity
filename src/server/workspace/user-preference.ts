import { and, eq, isNull } from 'drizzle-orm'
import { workspaceUserPreferences } from '@/db/schema/workspace'
import { getWorkspace } from '@/server/workspace/service'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { UpdateWorkspacePreferences } from '@/types/workspace/schema'

const keys = ['views', 'active_cycles', 'analytics', 'drafts', 'your_work', 'archives', 'stickies'] as const
export async function getWorkspaceUserPreferences(db: LancityDb, actor: Actor, slug: string) {
  const { workspace } = await getWorkspace(db, actor, slug)
  await db
    .insert(workspaceUserPreferences)
    .values(
      keys.map((key, index) => ({
        key,
        userId: actor.userId,
        workspaceId: workspace.id,
        sortOrder: 65535 + index * 10000,
        isPinned: ['drafts', 'your_work', 'stickies'].includes(key),
        createdById: actor.userId,
        updatedById: actor.userId
      }))
    )
    .onConflictDoNothing()
  const rows = await db
    .select({
      key: workspaceUserPreferences.key,
      is_pinned: workspaceUserPreferences.isPinned,
      sort_order: workspaceUserPreferences.sortOrder
    })
    .from(workspaceUserPreferences)
    .where(
      and(
        eq(workspaceUserPreferences.workspaceId, workspace.id),
        eq(workspaceUserPreferences.userId, actor.userId),
        isNull(workspaceUserPreferences.deletedAt)
      )
    )
    .orderBy(workspaceUserPreferences.sortOrder)
  return Object.fromEntries(rows.map(row => [row.key, { is_pinned: row.is_pinned, sort_order: row.sort_order }]))
}
export async function updateWorkspaceUserPreferences(
  db: LancityDb,
  actor: Actor,
  slug: string,
  input: UpdateWorkspacePreferences
) {
  const { workspace } = await getWorkspace(db, actor, slug)
  await getWorkspaceUserPreferences(db, actor, slug)
  const statements = input.map(value =>
    db
      .update(workspaceUserPreferences)
      .set({ isPinned: value.is_pinned, sortOrder: value.sort_order, updatedById: actor.userId })
      .where(
        and(
          eq(workspaceUserPreferences.workspaceId, workspace.id),
          eq(workspaceUserPreferences.userId, actor.userId),
          eq(workspaceUserPreferences.key, value.key),
          isNull(workspaceUserPreferences.deletedAt)
        )
      )
  )
  if (statements.length) await db.batch(statements as [(typeof statements)[number], ...typeof statements])
  return { message: 'Successfully updated' }
}
