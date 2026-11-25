'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { createWorkspaceAction } from './actions'

export function CreateWorkspaceForm() {
  const [state, action, pending] = useActionState(createWorkspaceAction, {})
  return (
    <form action={action} className='grid gap-3'>
      <label className='grid gap-1'>
        Name
        <input name='name' required maxLength={80} className='rounded-md border bg-background p-2' />
      </label>
      <label className='grid gap-1'>
        Slug
        <input
          name='slug'
          required
          maxLength={48}
          pattern='[a-zA-Z0-9_-]+'
          className='rounded-md border bg-background p-2'
        />
      </label>
      <label className='flex items-center gap-2'>
        <input type='checkbox' name='seed' />
        Add a sample project
      </label>
      {state.error && (
        <p role='alert' className='text-sm text-destructive'>
          {state.error}
        </p>
      )}
      {state.success && (
        <p role='status' className='text-sm'>
          Workspace created.
        </p>
      )}
      <Button type='submit' disabled={pending} className='justify-self-start'>
        {pending ? 'Creating…' : 'Create workspace'}
      </Button>
    </form>
  )
}
