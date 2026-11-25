'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { createPageAction } from './actions'

export function CreatePageForm({ slug, projectId }: { slug: string; projectId: number }) {
  const [state, action, pending] = useActionState(createPageAction, {})
  return (
    <form action={action} className='space-y-3'>
      <input type='hidden' name='slug' value={slug} />
      <input type='hidden' name='projectId' value={projectId} />
      <label className='grid gap-1'>
        Name
        <input name='name' required maxLength={255} className='rounded-md border bg-background p-2' />
      </label>
      <label className='grid gap-1'>
        Description
        <textarea name='descriptionText' className='min-h-24 rounded-md border bg-background p-2' />
      </label>
      {state.error && (
        <p className='text-destructive' role='alert'>
          {state.error}
        </p>
      )}
      {state.success && <p role='status'>Page created.</p>}
      <Button type='submit' disabled={pending}>
        {pending ? 'Creating…' : 'Create page'}
      </Button>
    </form>
  )
}
