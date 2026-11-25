import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { Link } from '@/components/ui/custom/link'
import { linkto } from '@/data/linkto'
import { getDb } from '@/db/client'
import { getActor } from '@/lib/auth/server-session'
import { listWorkspaces } from '@/server/workspace/service'
import { CreateWorkspaceForm } from './create-form'

async function WorkspaceContent() {
  const actor = await getActor()
  if (!actor) redirect(linkto.login)
  const items = await listWorkspaces(getDb(), actor)
  return (
    <main className='mx-auto w-full max-w-2xl space-y-8 px-5 py-12'>
      <h1 className='font-serif text-3xl font-semibold'>Workspaces</h1>
      <Link className='text-primary underline' href={linkto.projects}>
        Projects
      </Link>
      <section className='space-y-3'>
        <h2 className='text-xl font-semibold'>Your workspaces</h2>
        {items.length ? (
          <ul className='space-y-2'>
            {items.map(({ workspace, role }) => (
              <li key={workspace.id} className='rounded-lg border p-3'>
                <strong>{workspace.name}</strong>{' '}
                <span className='text-sm text-muted-foreground'>
                  ({workspace.slug}) · {role === 20 ? 'Admin' : role === 15 ? 'Member' : 'Guest'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>You have no workspaces yet.</p>
        )}
      </section>
      <section className='space-y-3'>
        <h2 className='text-xl font-semibold'>Create workspace</h2>
        <CreateWorkspaceForm />
      </section>
    </main>
  )
}

export default function WorkspacesPage() {
  return (
    <Suspense>
      <WorkspaceContent />
    </Suspense>
  )
}
