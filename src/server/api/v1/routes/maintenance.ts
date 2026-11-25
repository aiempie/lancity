import { apiV1Routes } from '@/data/linkto'
import { hashPassword } from 'better-auth/crypto'
import { Hono } from 'hono'
import { getDb } from '@/db/client'
import { authenticate } from '@/server/api/v1/middleware'
import { parseInput, readJson } from '@/server/api/v1/validation'
import { getEnv } from '@/server/common/env'
import { ServiceError } from '@/server/common/errors'
import { enqueueJob } from '@/server/common/jobs'
import { sendMail } from '@/server/common/mail'
import { enqueueIssueDescriptionVersionBackfill, enqueueIssueVersionBackfill } from '@/server/issue/activity/index'
import { encryptData } from '@/server/instance/encryption'
import { queueInstanceMetricsPush } from '@/server/instance/jobs'
import { requireInstanceAdmin } from '@/server/instance/permissions'
import {
  enqueueCleanup,
  enqueueDummyData,
  enqueueHardDelete,
  enqueueMaintenanceWorkspaceSeed,
  MAINTENANCE_JOB
} from '@/server/maintenance/jobs'
import {
  activateUser,
  clearCache,
  configureInstance,
  createProjectMember,
  fixDuplicateSequences,
  reactivateWorkspaceMember,
  registerInstance,
  resetPassword,
  updateDeletedWorkspaceSlug
} from '@/server/maintenance/ops'
import { listRuns, recordRun } from '@/server/maintenance/runs'
import type { ApiEnv } from '@/types/api/schema'
import {
  activateUserSchema,
  cleanupRunSchema,
  clearCacheSchema,
  createProjectMemberSchema,
  dummyDataSchema,
  fixDuplicateSequencesSchema,
  maintenanceRunsQuerySchema,
  reactivateWorkspaceMemberSchema,
  registerInstanceSchema,
  resetPasswordSchema,
  syncVersionSchema,
  testEmailSchema,
  updateDeletedWorkspaceSlugSchema,
  workspaceSeedRunSchema
} from '@/types/instance/p4-maintenance-schema'

/**
 * Instance admin maintenance API: the Django management commands of Plane as HTTP endpoints.
 * Mount under the instance routes, e.g. `app.route(`${linkto.apiInstances}/maintenance`, maintenanceRoutes)`.
 * Paths have no `linkto` key yet; add them when merging (see the p4-maintenance handoff).
 */
const paths = {
  runs: apiV1Routes.maintenanceRuns,
  activateUser: apiV1Routes.maintenanceActivateUser,
  resetPassword: apiV1Routes.maintenanceResetPassword,
  clearCache: apiV1Routes.maintenanceClearCache,
  projectMembers: apiV1Routes.maintenanceProjectMembers,
  reactivateWorkspaceMember: apiV1Routes.maintenanceReactivateWorkspaceMember,
  updateDeletedSlug: apiV1Routes.maintenanceUpdateDeletedSlug,
  fixDuplicateSequences: apiV1Routes.maintenanceFixDuplicateSequences,
  syncIssueVersions: apiV1Routes.maintenanceSyncIssueVersions,
  syncIssueDescriptionVersions: apiV1Routes.maintenanceSyncIssueDescriptionVersions,
  copyCommentDescriptions: apiV1Routes.maintenanceCopyCommentDescriptions,
  testEmail: apiV1Routes.maintenanceTestEmail,
  configureInstance: apiV1Routes.maintenanceConfigureInstance,
  registerInstance: apiV1Routes.maintenanceRegisterInstance,
  dummyData: apiV1Routes.maintenanceDummyData,
  cleanup: apiV1Routes.maintenanceCleanup,
  workspaceSeed: apiV1Routes.maintenanceWorkspaceSeed
} as const

export const maintenanceRoutes = new Hono<ApiEnv>()
const env = () => getEnv() as Record<string, unknown>

// Every endpoint is for instance admins only, and each call is recorded in `maintenance_runs`.
maintenanceRoutes.use('*', authenticate, async (c, next) => {
  await requireInstanceAdmin(getDb(), c.get('actor'))
  await next()
})

maintenanceRoutes.get(paths.runs, async c => {
  const query = parseInput(maintenanceRunsQuerySchema, Object.fromEntries(new URL(c.req.url).searchParams))
  return c.json(await listRuns(getDb(), query))
})

maintenanceRoutes.post(paths.activateUser, async c => {
  const { email } = await readJson(c, activateUserSchema)
  const db = getDb()
  return c.json(await recordRun(db, 'activate_user', () => activateUser(db, email), c.get('actor').userId))
})

maintenanceRoutes.post(paths.resetPassword, async c => {
  const { email, password } = await readJson(c, resetPasswordSchema)
  const db = getDb()
  // The password never reaches the run record: only the user id and message are stored.
  return c.json(await recordRun(db, 'reset_password', () => resetPassword(db, email, password, hashPassword), c.get('actor').userId))
})

maintenanceRoutes.post(paths.clearCache, async c => {
  const { key } = await readJson(c, clearCacheSchema)
  const db = getDb()
  return c.json(await recordRun(db, 'clear_cache', () => clearCache(db, key), c.get('actor').userId))
})

maintenanceRoutes.post(paths.projectMembers, async c => {
  const input = await readJson(c, createProjectMemberSchema)
  const db = getDb()
  return c.json(await recordRun(db, 'create_project_member', () => createProjectMember(db, input), c.get('actor').userId))
})

maintenanceRoutes.post(paths.reactivateWorkspaceMember, async c => {
  const input = await readJson(c, reactivateWorkspaceMemberSchema)
  const db = getDb()
  return c.json(await recordRun(db, 'reactivate_workspace_member', () => reactivateWorkspaceMember(db, input), c.get('actor').userId))
})

maintenanceRoutes.post(paths.updateDeletedSlug, async c => {
  const input = await readJson(c, updateDeletedWorkspaceSlugSchema)
  const db = getDb()
  return c.json(await recordRun(db, 'update_deleted_workspace_slug', () => updateDeletedWorkspaceSlug(db, input), c.get('actor').userId))
})

maintenanceRoutes.post(paths.fixDuplicateSequences, async c => {
  const input = await readJson(c, fixDuplicateSequencesSchema)
  const db = getDb()
  return c.json(await recordRun(db, 'fix_duplicate_sequences', () => fixDuplicateSequences(db, input), c.get('actor').userId))
})

// sync_issue_version / sync_issue_description_version: queue the backfill that the issue group implements.
maintenanceRoutes.post(paths.syncIssueVersions, async c => {
  await enqueueIssueVersionBackfill(getEnv(), await readJson(c, syncVersionSchema))
  return c.json({ message: 'Successfully created issue version task' }, 202)
})
maintenanceRoutes.post(paths.syncIssueDescriptionVersions, async c => {
  await enqueueIssueDescriptionVersionBackfill(getEnv(), await readJson(c, syncVersionSchema))
  return c.json({ message: 'Successfully created issue description version task' }, 202)
})
maintenanceRoutes.post(paths.copyCommentDescriptions, async c => {
  await enqueueJob(getEnv(), { type: MAINTENANCE_JOB.copyCommentDescriptions })
  return c.json({ message: 'Queued: copy issue comments to descriptions' }, 202)
})

// test_email: sends through `sendMail` (Gmail SMTP secrets). The stored-settings check is `email-credentials-check`.
maintenanceRoutes.post(paths.testEmail, async c => {
  const { to } = await readJson(c, testEmailSchema)
  const result = await sendMail({
    to,
    subject: 'Test email from Lancity',
    text: 'This is a test email from your Lancity instance. Email delivery works.',
    html: '<p>This is a test email from your Lancity instance. Email delivery works.</p>'
  })
  if (!result.sent)
    throw new ServiceError(400, 'EMAIL_NOT_SENT', 'Email could not be delivered. Check GMAIL_USER and GMAIL_APP_PASSWORD.')
  return c.json({ message: 'Email successfully sent' })
})

maintenanceRoutes.post(paths.configureInstance, async c => {
  const db = getDb()
  return c.json(await recordRun(db, 'configure_instance', () => configureInstance(db, env(), encryptData), c.get('actor').userId))
})

maintenanceRoutes.post(paths.registerInstance, async c => {
  const db = getDb()
  // `machineSignature` is validated for parity with Plane; the instance row does not store it.
  await readJson(c, registerInstanceSchema)
  const result = await recordRun(db, 'register_instance', () => registerInstance(db, { env: env() }), c.get('actor').userId)
  await queueInstanceMetricsPush()
  return c.json(result)
})

maintenanceRoutes.post(paths.dummyData, async c => {
  await enqueueDummyData(await readJson(c, dummyDataSchema))
  return c.json({ message: 'Data is pushed to the queue' }, 202)
})

maintenanceRoutes.post(paths.cleanup, async c => {
  const { task } = await readJson(c, cleanupRunSchema)
  if (task === 'hard_delete') await enqueueHardDelete()
  else await enqueueCleanup(task)
  return c.json({ message: `Queued ${task}` }, 202)
})

maintenanceRoutes.post(paths.workspaceSeed, async c => {
  await enqueueMaintenanceWorkspaceSeed((await readJson(c, workspaceSeedRunSchema)).workspaceId)
  return c.json({ message: 'Workspace seed queued' }, 202)
})

export default maintenanceRoutes
