import { renderEmail, type MailContent } from '@/server/common/mail-templates'

/** Plane `magic_link` task: "Your unique Plane login code is {token}". */
export const magicCodeEmail = (code: string): MailContent =>
  renderEmail({
    subject: `Your unique Lancity login code is ${code}`,
    heading: 'Your login code',
    paragraphs: ['Use this code to sign in to Lancity:', code, 'The code expires in 10 minutes. Ignore this email if you did not request it.']
  })

/** Plane `forgot_password` task. */
export const forgotPasswordEmail = (firstName: string | null, url: string): MailContent =>
  renderEmail({
    subject: 'A new password to your Lancity account has been requested',
    heading: `Hello${firstName ? ` ${firstName}` : ''}`,
    paragraphs: ['We received a request to set a new password for your Lancity account.', 'If you did not make this request, you can ignore this email.'],
    action: { label: 'Reset password', url }
  })

/** Plane `send_email_update_magic_code`. */
export const emailUpdateCodeEmail = (code: string): MailContent =>
  renderEmail({
    subject: 'Verify your new email address',
    heading: 'Verify your new email address',
    paragraphs: ['Use this code to confirm your new Lancity email address:', code, 'The code expires in 10 minutes.']
  })

/** Plane `send_email_update_confirmation`. */
export const emailUpdateConfirmationEmail = (): MailContent =>
  renderEmail({
    subject: 'Lancity email address successfully updated',
    heading: 'Your email address was updated',
    paragraphs: ['The email address of your Lancity account was changed. If this was not you, contact your instance admin right away.']
  })

/** Plane `user_deactivation_email`. */
export const deactivationEmail = (name: string): MailContent =>
  renderEmail({
    subject: `${name} has been deactivated on Lancity`,
    heading: 'Account deactivated',
    paragraphs: [`The account of ${name} has been deactivated. Contact your instance admin to reactivate it.`]
  })

/** Plane `user_activation_email`. */
export const activationEmail = (name: string): MailContent =>
  renderEmail({
    subject: `${name} has been activated on Lancity`,
    heading: 'Account activated',
    paragraphs: [`The account of ${name} has been activated.`]
  })
