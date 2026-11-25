import { and, eq, isNull } from 'drizzle-orm'
import { intakes } from '@/db/schema/planning'
import { ServiceError } from '@/server/common/errors'
import { getDescriptionVersion, listDescriptionVersionsPage } from '@/server/issue/version'
import { queryIntake } from '@/server/intake/queries'
import { requireProjectAccess } from '@/server/project/permissions'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import type { CreateIntakeInput, UpdateIntakeInput } from '@/types/planning/schema'

export {
  createIntakeIssue,
  createIntakeIssueApi,
  deleteIntakeIssue,
  deleteIntakeIssueApi,
  getIntakeIssue,
  getIntakeIssueApi,
  listIntakeIssues,
  listIntakeIssuesApi,
  updateIntakeIssue,
  updateIntakeIssueApi
} from '@/server/intake/issue'

/** Every live intake of the project with its pending issue count (`IntakeViewSet.get_queryset`, PD-0544). */
export async function listIntakes(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 15)
  const rows = await queryIntake(db, workspace.id, projectId)
  return rows.map(row => ({ ...row.intake, pendingIssueCount: row.pendingIssueCount }))
}
/** PD-0545 `IntakeViewSet.list`: Plane answers with the first intake of the project, not a list. */
export async function getProjectIntake(db: LancityDb, actor: Actor, slug: string, projectId: number) {
  return (await listIntakes(db, actor, slug, projectId))[0] ?? null
}
export async function getIntake(db: LancityDb, actor: Actor, slug: string, projectId: number, intakeId: number) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 15)
  const [intake] = await db
    .select()
    .from(intakes)
    .where(
      and(
        eq(intakes.id, intakeId),
        eq(intakes.workspaceId, workspace.id),
        eq(intakes.projectId, projectId),
        isNull(intakes.deletedAt)
      )
    )
  if (!intake) throw new ServiceError(404, 'INTAKE_NOT_FOUND', 'Intake not found')
  return intake
}
/** PD-0546 `IntakeViewSet.perform_create`: the persistence step is `createIntake`. */
export async function createIntake(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  input: CreateIntakeInput
) {
  const { workspace } = await requireProjectAccess(db, actor, slug, projectId, 15)
  const [intake] = await db
    .insert(intakes)
    .values({ ...input, workspaceId: workspace.id, projectId, createdById: actor.userId, updatedById: actor.userId })
    .returning()
  return intake
}
export async function updateIntake(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  intakeId: number,
  input: UpdateIntakeInput
) {
  await getIntake(db, actor, slug, projectId, intakeId)
  const [intake] = await db
    .update(intakes)
    .set({ ...input, updatedById: actor.userId })
    .where(and(eq(intakes.id, intakeId), eq(intakes.projectId, projectId), isNull(intakes.deletedAt)))
    .returning()
  return intake
}
export async function deleteIntake(db: LancityDb, actor: Actor, slug: string, projectId: number, intakeId: number) {
  const intake = await getIntake(db, actor, slug, projectId, intakeId)
  if (intake.isDefault) throw new ServiceError(400, 'DEFAULT_INTAKE', 'Cannot delete the default intake')
  await db
    .update(intakes)
    .set({ deletedAt: new Date(), updatedById: actor.userId })
    .where(and(eq(intakes.id, intakeId), eq(intakes.projectId, projectId), isNull(intakes.deletedAt)))
}
export { createIntake as persistIntake }

/** PD-0556 `IntakeWorkItemDescriptionVersionEndpoint.get` (list). A restricted guest only reads items they created. */
export function listIntakeWorkItemDescriptionVersions(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  workItemId: number,
  query: Record<string, string | undefined> = {}
) {
  return listDescriptionVersionsPage(db, actor, slug, projectId, workItemId, query)
}
/** PD-0556 `IntakeWorkItemDescriptionVersionEndpoint.get` (one version, `pk`). */
export function getIntakeWorkItemDescriptionVersion(
  db: LancityDb,
  actor: Actor,
  slug: string,
  projectId: number,
  workItemId: number,
  versionId: number
) {
  return getDescriptionVersion(db, actor, slug, projectId, workItemId, versionId)
}
