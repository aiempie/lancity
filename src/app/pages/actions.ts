'use server'

import { revalidatePath } from 'next/cache'
import { linkto } from '@/data/linkto'
import { getDb } from '@/db/client'
import { requireActor } from '@/lib/auth/server-session'
import { ServiceError } from '@/server/common/errors'
import { createPage } from '@/server/page/service'
import { contentIdSchema, createPageInputSchema, type PageFormState } from '@/types/content/schema'

export async function createPageAction(_state: PageFormState, formData: FormData): Promise<PageFormState> {
  const input = createPageInputSchema.safeParse({
    name: formData.get('name'),
    descriptionText: formData.get('descriptionText')
  })
  const projectId = contentIdSchema.safeParse(formData.get('projectId'))
  const slug = formData.get('slug')
  if (!input.success || !projectId.success || typeof slug !== 'string' || !slug)
    return { error: 'Enter a valid page name and project.' }
  try {
    await createPage(getDb(), await requireActor(), slug, projectId.data, input.data)
  } catch (error) {
    if (error instanceof ServiceError && error.status < 500) return { error: error.message }
    throw error
  }
  revalidatePath(linkto.pages)
  return { success: true }
}
