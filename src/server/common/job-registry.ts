/// <reference types="vite/client" />

type JobModule = { register?: () => void }

/**
 * Domain job files. Each `src/server/<domain>/jobs.ts` (or `jobs/index.ts`) exports `register()`
 * that calls registerJobHandler / registerScheduled. Files that do not exist yet are skipped,
 * so agents only need to create their file; no edit here is required.
 */
const modules = import.meta.glob<JobModule>(['../*/jobs.ts', '../*/jobs/index.ts', '!../common/*'], { eager: true })

let registered = false

/** Call `register()` of every discovered job module once. */
export function registerAllJobs(): void {
  if (registered) return
  registered = true
  for (const [path, mod] of Object.entries(modules)) {
    if (typeof mod.register === 'function') mod.register()
    else console.warn(JSON.stringify({ level: 'warn', label: 'job-registry', message: `${path} has no register() export` }))
  }
}
