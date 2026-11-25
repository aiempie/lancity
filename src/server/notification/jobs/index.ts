import { registerJobHandler, registerScheduled } from '@/server/common/jobs'
import { NOTIFICATION_JOB } from '@/server/notification/events'
import {
  deleteEmailNotificationLogs,
  sendEmailNotification,
  stackEmailNotification
} from '@/server/notification/jobs/email-notification'
import { notifications } from '@/server/notification/jobs/notification'

/**
 * Called once by `job-registry.ts`. Queues deliver at least once. `notification.issue` is deduplicated with a job
 * claim written in the same batch as its notification rows; the email jobs use their own locks and log flags.
 */
export function register(): void {
  // Sent by `issue.activity` (p1-issue-background) when `notification: true`.
  registerJobHandler(NOTIFICATION_JOB.issue, (payload, env, meta) => notifications(env, payload, meta?.jobId))
  registerJobHandler(NOTIFICATION_JOB.emailStack, async (_payload, env) => void (await stackEmailNotification(env)))
  registerJobHandler(NOTIFICATION_JOB.emailSend, (payload, env) => sendEmailNotification(env, payload))
  // Celery beat: every 5 minutes group the unprocessed email logs; daily 02:45 UTC remove old sent logs.
  registerScheduled('*/5 * * * *', async env => void (await stackEmailNotification(env)), 'notification.email_stack')
  registerScheduled('45 2 * * *', env => deleteEmailNotificationLogs(env), 'notification.delete_email_logs')
}
