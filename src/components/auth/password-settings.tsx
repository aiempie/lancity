'use client'

import { useState, type FormEvent } from 'react'
import { useLocale } from 'next-intl'
import { changePasswordAction, deactivateAccountAction, setPasswordAction } from '@/app/account/actions'
import { Button } from '@/components/ui/button'
import { linkto } from '@/data/linkto'
import { useRouter } from '@/hooks/use-router'
import { authMessages } from './auth-messages'

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 focus-visible:outline focus-visible:outline-ring'

/** Change or set password (PD-1054/1055) and deactivate the account (PD-0821). */
export function PasswordSettings({ passwordAutoset }: { passwordAutoset: boolean }) {
  const locale = useLocale()
  const copy = authMessages[locale === 'en' ? 'en' : 'vi']
  const router = useRouter()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setPending(true)
    setMessage('')
    setError('')
    const result = passwordAutoset
      ? await setPasswordAction({ password: String(data.get('new_password') ?? '') })
      : await changePasswordAction({ old_password: String(data.get('old_password') ?? ''), new_password: String(data.get('new_password') ?? '') })
    setPending(false)
    if (result.ok) {
      form.reset()
      setMessage(copy.passwordUpdated)
    } else setError(result.error === 'PASSWORD_TOO_WEAK' || result.error === 'INVALID_PASSWORD' ? copy.weakPassword : copy.passwordFailed)
  }

  async function deactivate() {
    if (!window.confirm(copy.deactivateConfirm)) return
    setPending(true)
    const result = await deactivateAccountAction()
    setPending(false)
    if (!result.ok) return setError(copy.deactivateFailed)
    router.replace(linkto.login)
    router.refresh({ showProgress: false })
  }

  return (
    <div className='space-y-4'>
      <form className='space-y-3' onSubmit={submit}>
        <fieldset disabled={pending} className='space-y-3'>
          {!passwordAutoset && <input className={inputClass} name='old_password' type='password' autoComplete='current-password' required placeholder={copy.oldPassword} />}
          <input className={inputClass} name='new_password' type='password' autoComplete='new-password' minLength={8} maxLength={128} required placeholder={copy.newPassword} />
          <Button type='submit' variant='secondary'>
            {passwordAutoset ? copy.setPassword : copy.changePassword}
          </Button>
        </fieldset>
        {message && <p className='text-sm'>{message}</p>}
        {error && (
          <p role='alert' className='text-sm text-destructive'>
            {error}
          </p>
        )}
      </form>
      <Button variant='destructive' disabled={pending} onClick={deactivate}>
        {copy.deactivate}
      </Button>
    </div>
  )
}
