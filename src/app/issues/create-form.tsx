'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { createIssueAction } from './actions'

export function CreateIssueForm({ slug, projectId }: { slug: string; projectId: number }) {
  const [state, action, pending] = useActionState(createIssueAction, {})
  return (
    <form action={action} className='space-y-3'>
      <input type='hidden' name='slug' value={slug} />
      <input type='hidden' name='projectId' value={projectId} />
      <label className='block'>
        Issue name <input name='name' required maxLength={255} className='block w-full rounded border p-2' />
      </label>
      {state.error && <p role='alert'>{state.error}</p>}
      {state.success && <p role='status'>Issue created.</p>}
      <Button type='submit' disabled={pending}>
        {pending ? 'Creating…' : 'Create issue'}
      </Button>
    </form>
  )
}
