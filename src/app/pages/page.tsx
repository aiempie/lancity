import { Suspense } from 'react'
import { notFound, redirect } from 'next/navigation'
import { Link } from '@/components/ui/custom/link'
import { linkto } from '@/data/linkto'
import { getDb } from '@/db/client'
import { getActor } from '@/lib/auth/server-session'
import { ServiceError } from '@/server/common/errors'
import { listPages } from '@/server/page/service'
import { contentIdSchema } from '@/types/content/schema'
import { CreatePageForm } from './create-form'

async function PagesContent({ searchParams }: PageProps<'/pages'>) {
  const actor = await getActor()
  if (!actor) redirect(linkto.login)
  const { slug, projectId: rawProjectId } = await searchParams
  const projectId = contentIdSchema.safeParse(rawProjectId)
  if (typeof slug !== 'string' || !projectId.success) redirect(linkto.projects)
  const items = await listPages(getDb(), actor, slug, projectId.data).catch((error: unknown) => {
    if (error instanceof ServiceError && error.status === 404) notFound()
    throw error
  })
  return (
    <main className='mx-auto w-full max-w-2xl space-y-6 px-5 py-12'>
      <Link className='text-primary underline' href={linkto.projects}>
        Projects
      </Link>
      <h1 className='font-serif text-3xl font-semibold'>Project pages</h1>
      <ul className='space-y-2'>
        {items.map(page => (
          <li key={page.id} className='rounded-lg border p-3'>
            {page.name}
          </li>
        ))}
      </ul>
      <CreatePageForm slug={slug} projectId={projectId.data} />
    </main>
  )
}

export default function PagesPage(props: PageProps<'/pages'>) {
  return (
    <Suspense>
      <PagesContent {...props} />
    </Suspense>
  )
}
