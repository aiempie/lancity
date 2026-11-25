import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { linkto } from '@/data/linkto'
import { getDb } from '@/db/client'
import { getActor } from '@/lib/auth/server-session'
import { listIssues } from '@/server/issue/service'
import { issueIdParamSchema } from '@/types/issue/schema'
import { CreateIssueForm } from './create-form'

async function IssueContent({ searchParams }: { searchParams: Promise<{ slug?: string; projectId?: string }> }) {
  const actor = await getActor()
  if (!actor) redirect(linkto.login)
  const { slug, projectId: rawId } = await searchParams
  const projectId = issueIdParamSchema.safeParse(rawId)
  if (!slug || !projectId.success) return <main className='p-8'>Choose a project to view issues.</main>
  const items = await listIssues(getDb(), actor, slug, projectId.data)
  return (
    <main className='mx-auto w-full max-w-2xl space-y-8 px-5 py-12'>
      <h1 className='font-serif text-3xl font-semibold'>Issues</h1>
      <ul className='space-y-2'>
        {items.map(issue => (
          <li key={issue.id} className='rounded-lg border p-3'>
            #{issue.sequenceId} {issue.name}
          </li>
        ))}
      </ul>
      <section className='space-y-3'>
        <h2 className='text-xl font-semibold'>Create issue</h2>
        <CreateIssueForm slug={slug} projectId={projectId.data} />
      </section>
    </main>
  )
}
export default function IssuesPage({ searchParams }: { searchParams: Promise<{ slug?: string; projectId?: string }> }) {
  return (
    <Suspense>
      <IssueContent searchParams={searchParams} />
    </Suspense>
  )
}
