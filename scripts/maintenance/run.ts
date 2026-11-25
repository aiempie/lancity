import { createInterface } from 'node:readline/promises'
import { hashPassword } from 'better-auth/crypto'
import { createInstanceAdmin } from '../plane/create-instance-admin'
import { processCleanupTask, CLEANUP_TASKS, type CleanupTask } from '../../src/server/maintenance/cleanup'
import { hardDelete } from '../../src/server/maintenance/deletion'
import { createDummyData } from '../../src/server/maintenance/dummy-data'
import {
  activateUser,
  clearCache,
  configureInstance,
  copyIssueCommentToDescription,
  createProjectMember,
  fixDuplicateSequences,
  reactivateWorkspaceMember,
  registerInstance,
  resetPassword,
  updateDeletedWorkspaceSlug
} from '../../src/server/maintenance/ops'
import {
  activateUserSchema,
  createProjectMemberSchema,
  dummyDataSchema,
  fixDuplicateSequencesSchema,
  reactivateWorkspaceMemberSchema,
  updateDeletedWorkspaceSlugSchema
} from '../../src/types/instance/p4-maintenance-schema'
import { openLocalDb } from './d1-shim'

const USAGE = `Usage: pnpm exec tsx scripts/maintenance/run.ts <command> <local D1 SQLite file> [arguments]

Commands (Django management command in brackets):
  activate-user <email>                                   [activate_user]
  reset-password <email>                                  [reset_password] password from NEW_PASSWORD or a prompt
  clear-cache [key]                                       [clear_cache]
  create-instance-admin <email> [instance name]           [create_instance_admin]
  create-project-member <projectId> <email> [role]        [create_project_member]
  reactivate-workspace-member <slug> <email>              [reactivate_workspace_member]
  update-deleted-workspace-slug <slug> [--dry-run]        [update_deleted_workspace_slug]
  fix-duplicate-sequences <workspace slug> <PROJ-12>      [fix_duplicate_sequences]
  copy-issue-comment-to-description                       [copy_issue_comment_to_description]
  create-dummy-data <slug> <email> [--members a@x,b@x] [--issues n] [--cycles n] [--modules n] [--pages n] [--intake n]
  configure-instance                                      [configure_instance] needs BETTER_AUTH_SECRET in the environment
  register-instance                                       [register_instance]
  cleanup <${CLEANUP_TASKS.join('|')}>                    [cleanup_task]
  hard-delete [days]                                      [hard_delete]

For a remote database use the instance admin API (/instances/maintenance/...) instead.`

const flag = (args: string[], name: string) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}

async function readPassword() {
  if (process.env.NEW_PASSWORD) return process.env.NEW_PASSWORD
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const password = await rl.question('Password: ')
    if (password !== (await rl.question('Password (again): '))) throw new Error("Your passwords didn't match.")
    return password
  } finally {
    rl.close()
  }
}

async function main(argv: string[]) {
  const [command, file, ...args] = argv
  if (!command || !file || command === '--help') return console.log(USAGE)
  const { db, close } = openLocalDb(file)
  try {
    const out = (value: unknown) => console.log(JSON.stringify(value, null, 2))
    switch (command) {
      case 'activate-user':
        return out(await activateUser(db, activateUserSchema.parse({ email: args[0] }).email))
      case 'reset-password':
        return out(await resetPassword(db, args[0] ?? '', await readPassword(), hashPassword))
      case 'clear-cache':
        return out(await clearCache(db, args[0]))
      case 'create-instance-admin': {
        // Existing script of the instance group; it works on the raw SQLite file.
        const { DatabaseSync } = await import('node:sqlite')
        const raw = new DatabaseSync(file)
        try {
          createInstanceAdmin(raw, args[0] ?? '', (args[1] ?? 'Lancity').trim())
        } finally {
          raw.close()
        }
        return console.log('Successfully created the admin')
      }
      case 'create-project-member':
        return out(await createProjectMember(db, createProjectMemberSchema.parse({ projectId: args[0], email: args[1], role: args[2] ? Number(args[2]) : undefined })))
      case 'reactivate-workspace-member':
        return out(await reactivateWorkspaceMember(db, reactivateWorkspaceMemberSchema.parse({ slug: args[0], email: args[1] })))
      case 'update-deleted-workspace-slug':
        return out(await updateDeletedWorkspaceSlug(db, updateDeletedWorkspaceSlugSchema.parse({ slug: args[0], dryRun: args.includes('--dry-run') })))
      case 'fix-duplicate-sequences':
        return out(await fixDuplicateSequences(db, fixDuplicateSequencesSchema.parse({ workspaceSlug: args[0], issueIdentifier: args[1] })))
      case 'copy-issue-comment-to-description': {
        let result = await copyIssueCommentToDescription(db)
        while (!result.done) result = await copyIssueCommentToDescription(db)
        return out(result)
      }
      case 'create-dummy-data':
        return out(
          await createDummyData(
            db,
            dummyDataSchema.parse({
              slug: args[0],
              email: args[1],
              members: flag(args, 'members')?.split(',').filter(Boolean) ?? [],
              issueCount: flag(args, 'issues'),
              cycleCount: flag(args, 'cycles'),
              moduleCount: flag(args, 'modules'),
              pagesCount: flag(args, 'pages'),
              intakeIssueCount: flag(args, 'intake')
            })
          )
        )
      case 'configure-instance':
        return out(
          await configureInstance(db, process.env, async () => {
            throw new Error('Secrets are encrypted with INSTANCE_ENCRYPTION_KEY inside the Worker. Use the API for these values.')
          })
        )
      case 'register-instance':
        return out(await registerInstance(db, { env: process.env }))
      case 'cleanup': {
        if (!CLEANUP_TASKS.includes(args[0] as CleanupTask)) throw new Error(`Task must be one of ${CLEANUP_TASKS.join(', ')}`)
        const result = await processCleanupTask(db, args[0] as CleanupTask, { maxBatches: 1000 })
        return out(result)
      }
      case 'hard-delete': {
        let from = 0
        let total = { deleted: {} as Record<string, number>, failed: [] as string[] }
        for (;;) {
          const result = await hardDelete(db, { days: args[0] ? Number(args[0]) : undefined, from, budget: 100_000 })
          total = { deleted: { ...total.deleted, ...result.deleted }, failed: [...total.failed, ...result.failed] }
          if (result.next === null) break
          from = result.next
        }
        return out(total)
      }
      default:
        console.log(USAGE)
        process.exitCode = 1
    }
  } finally {
    close()
  }
}

main(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
