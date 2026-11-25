'use server'

import { revalidatePath } from 'next/cache'
import { linkto } from '@/data/linkto'
import { getDb } from '@/db/client'
import { requireActor } from '@/lib/auth/server-session'
import { ServiceError } from '@/server/common/errors'
import { enqueueWorkspaceSeed } from '@/server/workspace/jobs'
import { createWorkspaceWithSeed } from '@/server/workspace/seed'
import { createWorkspaceInputSchema, type WorkspaceActionState } from '@/types/workspace/schema'

export async function createWorkspaceAction(
  _state: WorkspaceActionState,
  formData: FormData
): Promise<WorkspaceActionState> {
  const parsed = createWorkspaceInputSchema.safeParse({
    name: formData.get('name'),
    slug: formData.get('slug'),
    seed: formData.get('seed') === 'on' ? true : undefined
  })
  if (!parsed.success)
    return {
      error:
        'Enter a valid name and slug. The slug must be available and contain only letters, numbers, hyphens or underscores.'
    }
  try {
    await createWorkspaceWithSeed(getDb(), await requireActor(), parsed.data, enqueueWorkspaceSeed)
  } catch (error) {
    if (error instanceof ServiceError && error.status === 409)
      return { error: 'This workspace slug is already in use.' }
    if (error instanceof ServiceError && error.status === 403) return { error: error.message }
    if (error instanceof ServiceError && error.status === 401)
      return { error: 'Your session has expired. Sign in and try again.' }
    throw error
  }
  revalidatePath(linkto.workspaces)
  return { success: true }
}
