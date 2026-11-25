'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { createProjectAction } from './actions'

export function CreateProjectForm({ workspaces }: { workspaces: { slug: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createProjectAction, {})
  return (
    <form action={action} className='grid gap-3'>
      <label className='grid gap-1'>
        Workspace
        <select
          name='workspace'
          required
          defaultValue={workspaces[0]?.slug ?? ''}
          className='rounded-md border bg-background p-2'
        >
          {workspaces.map(workspace => (
            <option key={workspace.slug} value={workspace.slug}>
              {workspace.name}
            </option>
          ))}
        </select>
      </label>
      <label className='grid gap-1'>
        Name
        <input name='name' required maxLength={255} className='rounded-md border bg-background p-2' />
      </label>
      <label className='grid gap-1'>
        Identifier
        <input
          name='identifier'
          required
          maxLength={12}
          pattern='[a-zA-Z0-9_]+'
          className='rounded-md border bg-background p-2'
        />
      </label>
      {state.error && (
        <p role='alert' className='text-sm text-destructive'>
          {state.error}
        </p>
      )}
      {state.success && (
        <p role='status' className='text-sm'>
          Project created.
        </p>
      )}
      <Button type='submit' disabled={pending || !workspaces.length} className='justify-self-start'>
        {pending ? 'Creating…' : 'Create project'}
      </Button>
    </form>
  )
}
