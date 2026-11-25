import { eq } from 'drizzle-orm'
import { projects, workspaces } from '@/db/schema/workspace'
import { createProject } from '@/server/project/service'
import { createWorkspace } from '@/server/workspace/service'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'
import { createProjectSchema } from '@/types/project/schema'
import type { CreateWorkspaceInput } from '@/types/workspace/schema'

export const WORKSPACE_SEED_JOB = 'workspace.seed'

// plane/seeds/data/projects.json
const seedDescription =
  'Welcome to the sample project. It gives you a starting point to explore work items, cycles, modules and views.'

/**
 * Port of the project step of workspace_seed_task (create_project_and_member + create_project_states).
 * The project is named after the workspace, owned by the workspace owner (Lancity has no bot users) and gets the
 * default states through createProject. Issues, labels, pages, cycles, modules and views of the Plane seed belong to
 * the maintenance group (PD-1239..PD-1247); registering a handler for WORKSPACE_SEED_JOB there replaces this one.
 * Idempotent: it does nothing when the workspace already has a project.
 */
export async function seedWorkspace(db: LancityDb, workspaceId: number): Promise<{ projectId: number | null }> {
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (!workspace || workspace.deletedAt) return { projectId: null }
  const [existing] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId))
    .limit(1)
  if (existing) return { projectId: null }
  const name =
    workspace.name
      .replace(/[&+,:;$^}{*=?@#|'<>.()%!-]/g, '')
      .trim()
      .slice(0, 255) || 'Workspace'
  const identifier =
    workspace.name
      .replace(/[^\p{L}\p{N}]/gu, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 5) || 'PROJ'
  const input = createProjectSchema.parse({ name, identifier, description: seedDescription })
  const project = await createProject(db, { userId: workspace.ownerId }, workspace.slug, input)
  await db
    .update(projects)
    .set({ cycleView: true, moduleView: true, issueViewsView: true })
    .where(eq(projects.id, project.id))
  return { projectId: project.id }
}

/** Create a workspace and, when the user opted in, queue the sample-data job. */
export async function createWorkspaceWithSeed(
  db: LancityDb,
  actor: Actor,
  input: CreateWorkspaceInput,
  enqueue: (workspaceId: number) => Promise<void>
) {
  const created = await createWorkspace(db, actor, input)
  if (input.seed) await enqueue(created.id)
  return created
}
