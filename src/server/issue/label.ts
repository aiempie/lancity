import { equalsFolded } from '@/server/common/unicode'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { issueLabels, labels } from '@/db/schema/issue'
import { projectMembers, projects } from '@/db/schema/workspace'
import { parseInput } from '@/server/api/v1/validation'
import { ServiceError } from '@/server/common/errors'
import { requireWorkspaceBySlug } from '@/server/issue/access'
import { nextAfterMaxSql } from '@/server/issue/sequence'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import {
  bulkCreateLabelsInputSchema,
  createLabelInputSchema,
  updateLabelInputSchema,
  type BulkCreateLabelsInput,
  type CreateLabelInput,
  type UpdateLabelInput
} from '@/types/issue/schema'

function liveLabels(projectId: number) {
  return and(eq(labels.projectId, projectId), isNull(labels.deletedAt))
}

export async function listLabels(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  await requireProjectAccess(db, actor, slug, projectId, 5)
  return db.select().from(labels).where(liveLabels(projectId)).orderBy(labels.sortOrder, labels.id)
}

export async function getLabel(db: LancityDb, actor: Actor, slug: string, projectId: number, labelId: number) {
  await requireProjectAccess(db, actor, slug, projectId, 5)
  const [label] = await db
    .select()
    .from(labels)
    .where(and(eq(labels.id, labelId), liveLabels(projectId)))
  if (!label) throw new ServiceError(404, 'LABEL_NOT_FOUND', 'Label not found')
  return label
}

/** Port of `LabelSerializer.validate_name` (PD-0326): names are unique per project, ignoring case. */
async function assertLabelName(db: LancityDb, projectId: number, name: string, exceptId?: number) {
  const [existing] = await db
    .select({ id: labels.id })
    .from(labels)
    .where(
      and(
        liveLabels(projectId),
        equalsFolded(sql`${labels.name}`, name),
        exceptId ? sql`${labels.id} <> ${exceptId}` : undefined
      )
    )
    .limit(1)
  if (existing) throw new ServiceError(409, 'LABEL_NAME_EXISTS', 'Label name already exists', { id: existing.id })
}

async function assertLabelExternalId(
  db: LancityDb,
  projectId: number,
  externalId: string | null | undefined,
  externalSource: string | null | undefined,
  exceptId?: number
) {
  if (!externalId || !externalSource) return
  const [existing] = await db
    .select({ id: labels.id })
    .from(labels)
    .where(
      and(
        liveLabels(projectId),
        eq(labels.externalId, externalId),
        eq(labels.externalSource, externalSource),
        exceptId ? sql`${labels.id} <> ${exceptId}` : undefined
      )
    )
    .limit(1)
  if (existing)
    throw new ServiceError(
      409,
      'EXTERNAL_ID_EXISTS',
      'Label with the same external id and external source already exists',
      { id: existing.id }
    )
}

async function assertLabelParent(
  db: LancityDb,
  projectId: number,
  parentId: number | null | undefined,
  selfId?: number
) {
  if (!parentId) return
  if (parentId === selfId) throw new ServiceError(400, 'INVALID_PARENT', 'A label cannot be its own parent')
  const [parent] = await db
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.id, parentId), liveLabels(projectId)))
  if (!parent) throw new ServiceError(400, 'INVALID_PARENT', 'Parent label does not belong to this project')
}

/** Port of `Label.save` (PD-1443): a new label sorts 10000 after the project's largest `sort_order`. */
export async function createLabel(db: LancityDb, actor: Actor, slug: string, projectId: number, raw: CreateLabelInput) {
  const input = parseInput(createLabelInputSchema, raw)
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 20)
  await assertLabelName(db, projectId, input.name)
  await assertLabelExternalId(db, projectId, input.externalId, input.externalSource)
  await assertLabelParent(db, projectId, input.parentId)
  try {
    const [created] = await db
      .insert(labels)
      .values({
        name: input.name,
        color: input.color ?? '',
        description: input.description ?? '',
        parentId: input.parentId ?? null,
        sortOrder: input.sortOrder ?? nextAfterMaxSql('labels', projectId),
        externalId: input.externalId ?? null,
        externalSource: input.externalSource ?? null,
        projectId,
        workspaceId: workspace.id,
        createdById: actor.userId,
        updatedById: actor.userId
      })
      .returning()
    return created
  } catch (error) {
    await assertLabelName(db, projectId, input.name)
    throw error
  }
}

export async function updateLabel(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  labelId: number,
  raw: UpdateLabelInput
) {
  const input = parseInput(updateLabelInputSchema, raw)
  await requireProjectAccess(db, actor, slug, projectId, 20)
  const current = await getLabel(db, actor, slug, projectId, labelId)
  if (input.name !== undefined) await assertLabelName(db, projectId, input.name, labelId)
  await assertLabelExternalId(db, projectId, input.externalId, input.externalSource ?? current.externalSource, labelId)
  await assertLabelParent(db, projectId, input.parentId, labelId)
  const [updated] = await db
    .update(labels)
    .set({
      ...input,
      updatedById: actor.userId,
      updatedAt: sql`max(${labels.updatedAt} + 1, cast(unixepoch('subsec') * 1000 as integer))`
    })
    .where(and(eq(labels.id, labelId), liveLabels(projectId)))
    .returning()
  if (!updated) throw new ServiceError(404, 'LABEL_NOT_FOUND', 'Label not found')
  return updated
}

/** Soft delete a label together with its issue assignments and detach its child labels (Django CASCADE on soft delete). */
export async function deleteLabel(db: LancityDb, actor: Actor, slug: string, projectId: number, labelId: number) {
  await requireProjectAccess(db, actor, slug, projectId, 20)
  await getLabel(db, actor, slug, projectId, labelId)
  const now = new Date()
  const [removed] = await db.batch([
    db
      .update(labels)
      .set({ deletedAt: now, updatedById: actor.userId })
      .where(and(eq(labels.id, labelId), liveLabels(projectId)))
      .returning({ id: labels.id }),
    db
      .update(issueLabels)
      .set({ deletedAt: now, updatedById: actor.userId })
      .where(and(eq(issueLabels.labelId, labelId), isNull(issueLabels.deletedAt))),
    db
      .update(labels)
      .set({ parentId: null, updatedById: actor.userId })
      .where(and(eq(labels.parentId, labelId), isNull(labels.deletedAt)))
  ])
  if (!removed.length) throw new ServiceError(404, 'LABEL_NOT_FOUND', 'Label not found')
}

/** Port of `BulkCreateIssueLabelsEndpoint.post` (PD-0625): labels with a random colour, duplicates skipped. */
export async function bulkCreateIssueLabels(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  raw: BulkCreateLabelsInput
) {
  const input = parseInput(bulkCreateLabelsInputSchema, raw)
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 20)
  const existing = new Set(
    (await db.select({ name: labels.name }).from(labels).where(liveLabels(projectId))).map(row =>
      row.name.toLowerCase()
    )
  )
  const created: (typeof labels.$inferSelect)[] = []
  for (const item of input.labelData) {
    const name = item.name ?? 'Migrated'
    if (existing.has(name.toLowerCase())) continue
    existing.add(name.toLowerCase())
    const color = `#${Math.floor(Math.random() * 0x1000000)
      .toString(16)
      .padStart(6, '0')
      .toUpperCase()}`
    const [row] = await db
      .insert(labels)
      .values({
        name,
        description: item.description ?? 'Migrated Issue',
        color,
        sortOrder: nextAfterMaxSql('labels', projectId),
        projectId,
        workspaceId: workspace.id,
        createdById: actor.userId,
        updatedById: actor.userId
      })
      .onConflictDoNothing()
      .returning()
    if (row) created.push(row)
  }
  return { labels: created }
}

/** Port of `WorkspaceLabelsEndpoint.get` (PD-0911): labels of every active, unarchived project of the actor. */
export async function getWorkspaceLabels(db: LancityDb, actor: Actor, slug: string) {
  const { workspace } = await requireWorkspaceBySlug(db, actor, slug)
  const rows = await db
    .select({ label: labels })
    .from(labels)
    .innerJoin(projects, and(eq(projects.id, labels.projectId), eq(projects.workspaceId, labels.workspaceId)))
    .innerJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, projects.id),
        eq(projectMembers.memberId, actor.userId),
        eq(projectMembers.isActive, true),
        isNull(projectMembers.deletedAt)
      )
    )
    .where(
      and(
        eq(labels.workspaceId, workspace.id),
        isNull(labels.deletedAt),
        isNull(projects.deletedAt),
        isNull(projects.archivedAt)
      )
    )
    .orderBy(labels.projectId, labels.sortOrder, labels.id)
  return rows.map(row => row.label)
}
