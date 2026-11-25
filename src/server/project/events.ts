import type { MailContent } from '@/server/common/mail-templates'

/** Job types owned by this domain. The handler lives in `jobs.ts`. */
export const PROJECT_SEND_MAIL = 'project.send_mail'
/** Plane `webhook_activity` and `model_activity` tasks. The webhook domain registers these handlers. */
export const WEBHOOK_ACTIVITY_JOB = 'webhook.activity'
export const MODEL_ACTIVITY_JOB = 'webhook.model_activity'

/** Public origin used in email links. */
export async function appOrigin(): Promise<string> {
  const { getEnv } = await import('@/server/common/env')
  return (getEnv().BETTER_AUTH_URL ?? '').replace(/\/$/, '')
}

/** Queue one email. Imports are lazy so the member service stays loadable outside the Worker runtime. */
export async function queueProjectMail(to: string, content: MailContent) {
  await emit(PROJECT_SEND_MAIL, { to, ...content })
}

/** Queue a webhook or model-activity job. A failure to queue must never fail the request that already wrote data. */
export async function emitProjectEvent(type: typeof WEBHOOK_ACTIVITY_JOB | typeof MODEL_ACTIVITY_JOB, payload: unknown) {
  await emit(type, payload)
}

async function emit(type: string, payload: unknown) {
  try {
    const [{ enqueueJob }, { getEnv }] = await Promise.all([import('@/server/common/jobs'), import('@/server/common/env')])
    await enqueueJob(getEnv(), { type, payload })
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', label: type, message: error instanceof Error ? error.message : String(error) }))
  }
}
