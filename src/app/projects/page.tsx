import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { Link } from '@/components/ui/custom/link'
import { linkto } from '@/data/linkto'
import { getDb } from '@/db/client'
import { getActor } from '@/lib/auth/server-session'
import { listProjects } from '@/server/project/service'
import { listWorkspaces } from '@/server/workspace/service'
import { Button } from '@/components/ui/button'
import { archiveProjectAction, leaveProjectAction, toggleFavoriteProjectAction } from './actions'
import { CreateProjectForm } from './create-form'

async function ProjectContent() {
  const actor = await getActor()
  if (!actor) redirect(linkto.login)
  const db = getDb()
  const workspaces = await listWorkspaces(db, actor)
  const entries = await Promise.all(
    workspaces.map(async ({ workspace, role }) => ({
      workspace,
      role,
      projects: await listProjects(db, actor, workspace.slug)
    }))
  )
  return (
    <main className='mx-auto w-full max-w-2xl space-y-8 px-5 py-12'>
      <h1 className='font-serif text-3xl font-semibold'>Projects</h1>
      {entries.map(({ workspace, role, projects }) => (
        <section key={workspace.id} className='space-y-2'>
          <h2 className='text-xl font-semibold'>{workspace.name}</h2>
          {projects.length ? (
            <ul className='space-y-2'>
              {projects.map(project => (
                <li key={project.id} className='rounded-lg border p-3'>
                  {project.memberRole !== null ? (
                    <Link href={linkto.issuesForProject(workspace.slug, project.id)}>{project.name}</Link>
                  ) : (
                    project.name
                  )}{' '}
                  <span className='text-sm text-muted-foreground'>({project.identifier})</span>
                  {project.memberRole !== null && (
                    <Link
                      className='ml-3 text-primary underline'
                      href={linkto.pagesForProject(workspace.slug, project.id)}
                    >
                      Pages
                    </Link>
                  )}
                  {project.memberRole !== null && (
                    <div className='mt-2 flex flex-wrap gap-2'>
                      {[
                        { action: toggleFavoriteProjectAction, name: 'favorite', value: project.isFavorite, label: project.isFavorite ? 'Unfavorite' : 'Favorite', variant: 'secondary' as const },
                        ...(project.memberRole >= 15 || role === 20
                          ? [{ action: archiveProjectAction, name: 'archived', value: false, label: 'Archive', variant: 'secondary' as const }]
                          : []),
                        { action: leaveProjectAction, name: 'left', value: false, label: 'Leave', variant: 'destructive' as const }
                      ].map(item => (
                        <form key={item.label} action={item.action}>
                          <input type='hidden' name='workspace' value={workspace.slug} />
                          <input type='hidden' name='projectId' value={project.id} />
                          <input type='hidden' name={item.name} value={String(item.value)} />
                          <Button type='submit' size='sm' variant={item.variant}>
                            {item.label}
                          </Button>
                        </form>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>No projects yet.</p>
          )}
        </section>
      ))}
      <section className='space-y-3'>
        <h2 className='text-xl font-semibold'>Create project</h2>
        <CreateProjectForm
          workspaces={entries
            .filter(entry => entry.role >= 15)
            .map(({ workspace }) => ({ slug: workspace.slug, name: workspace.name }))}
        />
      </section>
    </main>
  )
}
export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectContent />
    </Suspense>
  )
}
