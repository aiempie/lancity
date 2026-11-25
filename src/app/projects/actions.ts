'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { linkto } from '@/data/linkto'
import { getDb } from '@/db/client'
import { requireActor } from '@/lib/auth/server-session'
import { ServiceError } from '@/server/common/errors'
import { createProjectJoin } from '@/server/project/invite'
import { leaveProject } from '@/server/project/member'
import {
  createProject,
  createProjectArchiveUnarchive,
  createProjectFavorites,
  deleteProjectArchiveUnarchive,
  deleteProjectFavorites
} from '@/server/project/service'
import {
  createProjectSchema,
  respondProjectInvitationSchema,
  type ProjectActionState
} from '@/types/project/schema'

export async function createProjectAction(_state: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const slug = formData.get('workspace')
  const parsed = createProjectSchema.safeParse({
    name: formData.get('name'),
    identifier: formData.get('identifier'),
    network: 2
  })
  if (typeof slug !== 'string' || !slug || !parsed.success)
    return { error: 'Enter a valid workspace, project name, and identifier.' }
  try {
    await createProject(getDb(), await requireActor(), slug, parsed.data)
  } catch (error) {
    if (error instanceof ServiceError) {
      if (error.status === 409) return { error: 'This project name or identifier is already in use.' }
      if (error.status === 401) return { error: 'Your session has expired. Sign in and try again.' }
      if (error.status === 403 || error.status === 404)
        return { error: 'You cannot create projects in this workspace.' }
    }
    throw error
  }
  revalidatePath(linkto.projects)
  return { success: true }
}

function formIds(formData: FormData) {
  const slug = formData.get('workspace')
  const projectId = Number(formData.get('projectId'))
  if (typeof slug !== 'string' || !slug || !Number.isInteger(projectId) || projectId <= 0) return null
  return { slug, projectId }
}

/** Run a project service call from a plain form. Expected failures leave the page unchanged. */
async function runProjectAction(formData: FormData, run: (slug: string, projectId: number) => Promise<unknown>) {
  const ids = formIds(formData)
  if (!ids) return
  try {
    await run(ids.slug, ids.projectId)
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error
  }
  revalidatePath(linkto.projects)
}

export async function toggleFavoriteProjectAction(formData: FormData) {
  const favorite = formData.get('favorite') === 'true'
  await runProjectAction(formData, async (slug, projectId) =>
    favorite
      ? deleteProjectFavorites(getDb(), await requireActor(), slug, projectId)
      : createProjectFavorites(getDb(), await requireActor(), slug, projectId)
  )
}

export async function archiveProjectAction(formData: FormData) {
  const archived = formData.get('archived') === 'true'
  await runProjectAction(formData, async (slug, projectId) =>
    archived
      ? deleteProjectArchiveUnarchive(getDb(), await requireActor(), slug, projectId)
      : createProjectArchiveUnarchive(getDb(), await requireActor(), slug, projectId)
  )
}

export async function leaveProjectAction(formData: FormData) {
  await runProjectAction(formData, async (slug, projectId) => leaveProject(getDb(), await requireActor(), slug, projectId))
}

/** Accept or decline an emailed project invitation. */
export async function respondInvitationAction(formData: FormData) {
  const parsed = respondProjectInvitationSchema.safeParse({
    token: formData.get('token'),
    accepted: formData.get('accepted') === 'true'
  })
  const ids = formIds(formData)
  const invitationId = Number(formData.get('invitationId'))
  if (!parsed.success || !ids || !Number.isInteger(invitationId)) return
  try {
    await createProjectJoin(getDb(), await requireActor(), ids.slug, ids.projectId, invitationId, parsed.data)
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error
  }
  revalidatePath(linkto.projects)
  redirect(linkto.projects)
}
