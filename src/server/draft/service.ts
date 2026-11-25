import { and, eq, isNull } from 'drizzle-orm'
import { draftIssues } from '@/db/schema/planning'
import { ServiceError } from '@/server/common/errors'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { DraftInput } from '@/types/planning/schema'

export async function listDrafts(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId)
  return db
    .select()
    .from(draftIssues)
    .where(
      and(
        eq(draftIssues.workspaceId, workspace.id),
        eq(draftIssues.projectId, projectId),
        eq(draftIssues.createdById, actor.userId),
        isNull(draftIssues.deletedAt)
      )
    )
}
export async function getDraft(db: LancityDb, actor: Actor, slug: string, projectId: number, draftId: number) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId)
  const [draft] = await db
    .select()
    .from(draftIssues)
    .where(
      and(
        eq(draftIssues.id, draftId),
        eq(draftIssues.workspaceId, workspace.id),
        eq(draftIssues.projectId, projectId),
        eq(draftIssues.createdById, actor.userId),
        isNull(draftIssues.deletedAt)
      )
    )
  if (!draft) throw new ServiceError(404, 'DRAFT_NOT_FOUND', 'Draft not found')
  return draft
}
export async function createDraft(db: LancityDb, actor: Actor, slug: string, projectId: number, input: DraftInput) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 15)
  const [draft] = await db
    .insert(draftIssues)
    .values({
      name: input.name,
      descriptionHtml: input.description_html,
      priority: input.priority,
      workspaceId: workspace.id,
      projectId,
      createdById: actor.userId,
      updatedById: actor.userId
    })
    .returning()
  return draft
}
export async function updateDraft(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  draftId: number,
  input: DraftInput
) {
  await getDraft(db, actor, slug, projectId, draftId)
  await requireProjectAccess(db, actor, slug, projectId, 15)
  const [draft] = await db
    .update(draftIssues)
    .set({
      name: input.name,
      descriptionHtml: input.description_html,
      priority: input.priority,
      updatedById: actor.userId
    })
    .where(
      and(
        eq(draftIssues.id, draftId),
        eq(draftIssues.projectId, projectId),
        eq(draftIssues.createdById, actor.userId),
        isNull(draftIssues.deletedAt)
      )
    )
    .returning()
  return draft
}
export async function deleteDraft(db: LancityDb, actor: Actor, slug: string, projectId: number, draftId: number) {
  await getDraft(db, actor, slug, projectId, draftId)
  await db
    .update(draftIssues)
    .set({ deletedAt: new Date(), updatedById: actor.userId })
    .where(
      and(
        eq(draftIssues.id, draftId),
        eq(draftIssues.projectId, projectId),
        eq(draftIssues.createdById, actor.userId),
        isNull(draftIssues.deletedAt)
      )
    )
}

export {
  canWriteProject,
  checkCycleAndModules,
  createDraftToIssue,
  createWorkspaceDraftIssue,
  deleteWorkspaceDraftIssue,
  getWorkspaceDraftIssue,
  listWorkspaceDraftIssues,
  updateWorkspaceDraftIssue
} from '@/server/draft/workspace'
