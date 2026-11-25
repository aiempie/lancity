import type { ZodType } from 'zod'
import { withJobClaim } from '@/server/common/job-claims'
import { registerJobHandler } from '@/server/common/jobs'
import { logException } from '@/server/common/exception-logger'
import {
  dispatchIssueActivity,
  modelActivity,
  sendWebhookDeactivationEmail,
  webhookActivity,
  webhookSendTask,
  WEBHOOK_JOB
} from '@/server/webhook/jobs/delivery'
import {
  modelActivityJobSchema,
  webhookActivityJobSchema,
  webhookDeactivationEmailJobSchema,
  webhookDispatchJobSchema,
  webhookSendJobSchema
} from '@/types/integration/p3-integration-schema'
import type { InfraEnv } from '@/server/common/env'

/**
 * Validate the payload once. A malformed message is dropped and logged: retrying it would never succeed.
 * The job is claimed by its queue message id before it runs, so a redelivery after success does not fan out or send
 * again. A failed run gives the claim back so the queue retry can repeat it (children have ids derived from `jobId`
 * and dedupe themselves).
 */
function handler<T>(type: string, schema: ZodType<T>, run: (env: InfraEnv, payload: T, jobId?: string) => Promise<void>) {
  registerJobHandler<unknown>(type, async (payload, env, meta) => {
    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      logException(new Error(`Invalid payload for ${type}: ${parsed.error.message}`), {
        warning: true,
        context: { label: type }
      })
      return
    }
    await withJobClaim(env, type, meta?.jobId, () => run(env, parsed.data, meta?.jobId))
  })
}

export { WEBHOOK_JOB }

export function register(): void {
  handler(WEBHOOK_JOB.activity, webhookActivityJobSchema, webhookActivity)
  handler(WEBHOOK_JOB.modelActivity, modelActivityJobSchema, modelActivity)
  handler(WEBHOOK_JOB.dispatch, webhookDispatchJobSchema, dispatchIssueActivity)
  handler(WEBHOOK_JOB.send, webhookSendJobSchema, (env, payload) => webhookSendTask(env, payload))
  handler(WEBHOOK_JOB.deactivationEmail, webhookDeactivationEmailJobSchema, sendWebhookDeactivationEmail)
}
