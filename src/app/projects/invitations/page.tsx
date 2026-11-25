import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { linkto } from '@/data/linkto'
import { getDb } from '@/db/client'
import { getActor } from '@/lib/auth/server-session'
import { ServiceError } from '@/server/common/errors'
import { getProjectJoin } from '@/server/project/invite'
import { respondInvitationAction } from '../actions'

type Search = Promise<Record<string, string | string[] | undefined>>
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

async function InvitationContent({ searchParams }: { searchParams: Search }) {
  const actor = await getActor()
  if (!actor) redirect(linkto.login)
  const query = await searchParams
  const slug = first(query.slug)
  const projectId = Number(first(query.project_id))
  const invitationId = Number(first(query.invitation_id))
  const token = first(query.token)
  const invitation =
    slug && token && Number.isInteger(projectId) && Number.isInteger(invitationId)
      ? await getProjectJoin(getDb(), slug, projectId, invitationId, token).catch(error => {
          if (error instanceof ServiceError) return null
          throw error
        })
      : null
  return (
    <main className='mx-auto w-full max-w-md space-y-4 px-5 py-12'>
      <h1 className='font-serif text-3xl font-semibold'>Project invitation</h1>
      {!invitation ? (
        <p role='alert'>This invitation was not found.</p>
      ) : invitation.respondedAt ? (
        <p>You have already responded to this invitation.</p>
      ) : (
        <form action={respondInvitationAction} className='space-y-4'>
          <p>
            Join <strong>{invitation.project.name}</strong> in {invitation.workspace.name}?
          </p>
          <input type='hidden' name='workspace' value={invitation.workspace.slug} />
          <input type='hidden' name='projectId' value={invitation.project.id} />
          <input type='hidden' name='invitationId' value={invitation.id} />
          <input type='hidden' name='token' value={token} />
          <div className='flex gap-3'>
            <Button type='submit' name='accepted' value='true'>
              Accept
            </Button>
            <Button type='submit' name='accepted' value='false' variant='secondary'>
              Decline
            </Button>
          </div>
        </form>
      )}
    </main>
  )
}

export default function ProjectInvitationPage({ searchParams }: { searchParams: Search }) {
  return (
    <Suspense>
      <InvitationContent searchParams={searchParams} />
    </Suspense>
  )
}
