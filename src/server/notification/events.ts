/** Job types owned by the notification domain. Handlers live in `jobs/index.ts`. */
export const NOTIFICATION_JOB = {
  /** Sent by `issue.activity` when `notification: true` (Plane `notifications` task). */
  issue: 'notification.issue',
  /** Plane `stack_email_notification`: group unprocessed logs and queue one email per receiver and issue. */
  emailStack: 'notification.email.stack',
  /** Plane `send_email_notification`. */
  emailSend: 'notification.email.send'
} as const
