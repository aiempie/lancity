'use server'

import { revalidatePath } from 'next/cache'
import { linkto } from '@/data/linkto'
import { getDb } from '@/db/client'
import { requireActor } from '@/lib/auth/server-session'
import { ServiceError } from '@/server/common/errors'
import { archiveIssue, unarchiveIssue } from '@/server/issue/archive'
import { createIssue, deleteIssue, updateIssue } from '@/server/issue/service'
import {
  createIssueInputSchema,
  issueIdParamSchema,
  updateIssueInputSchema,
  type IssueActionState
} from '@/types/issue/schema'

/** Run a service call for the signed-in user. Expected failures become form errors, anything else is rethrown. */
async function perform(
  formData: FormData,
  fields: string[],
  action: (scope: { slug: string; projectId: number; issueId: number }) => Promise<unknown>
): Promise<IssueActionState> {
  const projectId = issueIdParamSchema.safeParse(formData.get('projectId'))
  const issueId = fields.includes('issueId') ? issueIdParamSchema.safeParse(formData.get('issueId')) : null
  const slug = formData.get('slug')
  if (!projectId.success || (issueId && !issueId.success) || typeof slug !== 'string' || !slug)
    return { error: 'Choose a valid project and issue.' }
  try {
    await action({ slug, projectId: projectId.data, issueId: issueId?.success ? issueId.data : 0 })
  } catch (error) {
    if (error instanceof ServiceError && error.status < 500) return { error: error.message }
    throw error
  }
  revalidatePath(linkto.issues)
  return { success: true }
}

const text = (formData: FormData, key: string) => {
  const value = formData.get(key)
  return typeof value === 'string' && value !== '' ? value : undefined
}

export async function createIssueAction(_state: IssueActionState, formData: FormData): Promise<IssueActionState> {
  const input = createIssueInputSchema.safeParse({
    name: formData.get('name'),
    ...(text(formData, 'priority') ? { priority: text(formData, 'priority') } : {}),
    ...(text(formData, 'descriptionHtml') ? { descriptionHtml: text(formData, 'descriptionHtml') } : {})
  })
  if (!input.success) return { error: 'Enter a valid issue name and project.' }
  const actor = await requireActor()
  return perform(formData, [], ({ slug, projectId }) => createIssue(getDb(), actor, slug, projectId, input.data))
}

export async function updateIssueAction(_state: IssueActionState, formData: FormData): Promise<IssueActionState> {
  const input = updateIssueInputSchema.safeParse({
    ...(text(formData, 'name') ? { name: text(formData, 'name') } : {}),
    ...(text(formData, 'priority') ? { priority: text(formData, 'priority') } : {}),
    ...(text(formData, 'stateId') ? { stateId: Number(text(formData, 'stateId')) } : {})
  })
  if (!input.success) return { error: 'Enter at least one valid field.' }
  const actor = await requireActor()
  return perform(formData, ['issueId'], ({ slug, projectId, issueId }) =>
    updateIssue(getDb(), actor, slug, projectId, issueId, input.data)
  )
}

export async function deleteIssueAction(_state: IssueActionState, formData: FormData): Promise<IssueActionState> {
  const actor = await requireActor()
  return perform(formData, ['issueId'], ({ slug, projectId, issueId }) =>
    deleteIssue(getDb(), actor, slug, projectId, issueId)
  )
}

export async function archiveIssueAction(_state: IssueActionState, formData: FormData): Promise<IssueActionState> {
  const actor = await requireActor()
  return perform(formData, ['issueId'], ({ slug, projectId, issueId }) =>
    archiveIssue(getDb(), actor, slug, projectId, issueId)
  )
}

export async function unarchiveIssueAction(_state: IssueActionState, formData: FormData): Promise<IssueActionState> {
  const actor = await requireActor()
  return perform(formData, ['issueId'], ({ slug, projectId, issueId }) =>
    unarchiveIssue(getDb(), actor, slug, projectId, issueId)
  )
}
