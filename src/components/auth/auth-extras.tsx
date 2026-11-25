'use client'

import { useState, type FormEvent } from 'react'
import { useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Link } from '@/components/ui/custom/link'
import { linkto } from '@/data/linkto'
import { useRouter } from '@/hooks/use-router'
import { authClient } from '@/lib/auth/auth-client'
import { authMessages, type AuthMessageKey } from './auth-messages'

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 focus-visible:outline focus-visible:outline-ring'

function useCopy() {
  const locale = useLocale()
  const messages = authMessages[locale === 'en' ? 'en' : 'vi']
  return (key: AuthMessageKey) => messages[key]
}

/** Providers that start through Better Auth's social sign-in; Gitea uses the generic OAuth route. */
export function ProviderButtons({ providers }: { providers: string[] }) {
  const copy = useCopy()
  const [error, setError] = useState('')
  async function start(provider: string) {
    setError('')
    const options = { callbackURL: linkto.account, errorCallbackURL: linkto.login }
    if (provider === 'gitea') {
      // Gitea uses the server-side generic OAuth route, which has no typed client plugin.
      const result = await authClient.$fetch<{ url?: string }>('/sign-in/oauth2', {
        method: 'POST',
        body: { providerId: 'gitea', ...options }
      })
      if (result.error || !result.data?.url) setError(copy('codeUnavailable'))
      else window.location.assign(result.data.url)
      return
    }
    const result = await authClient.signIn.social({ provider: provider as 'github', ...options })
    if (result.error) setError(copy('codeUnavailable'))
  }
  return (
    <div className='space-y-2'>
      {providers.map(provider => (
        <Button key={provider} className='w-full' type='button' variant='outline' onClick={() => start(provider)}>
          {copy('continueWith')} {provider.charAt(0).toUpperCase() + provider.slice(1)}
        </Button>
      ))}
      {error && (
        <p role='alert' className='text-sm text-destructive'>
          {error}
        </p>
      )}
    </div>
  )
}

type Step = 'email' | 'code'

/** Magic code sign-in (PD-1045..1047): request an 8-digit code, then verify it. */
export function MagicCodeForm() {
  const copy = useCopy()
  const router = useRouter()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setPending(true)
    setError('')
    try {
      if (step === 'email') {
        const value = String(data.get('email') ?? '').trim().toLowerCase()
        const result = await authClient.emailOtp.sendVerificationOtp({ email: value, type: 'sign-in' })
        if (result.error) return setError(copy('codeUnavailable'))
        setEmail(value)
        setMessage(copy('codeSent'))
        setStep('code')
        return
      }
      const result = await authClient.signIn.emailOtp({ email, otp: String(data.get('code') ?? '').trim() })
      if (result.error) return setError(copy('codeFailed'))
      router.replace(linkto.account)
      router.refresh({ showProgress: false })
    } finally {
      setPending(false)
    }
  }

  return (
    <form className='space-y-3' onSubmit={submit} noValidate>
      <fieldset disabled={pending} className='space-y-3'>
        {step === 'email' ? (
          <input className={inputClass} name='email' type='email' autoComplete='email' required />
        ) : (
          <input className={inputClass} name='code' inputMode='numeric' autoComplete='one-time-code' maxLength={8} required placeholder={copy('code')} />
        )}
        <Button className='w-full' type='submit' variant='outline'>
          {copy(step === 'email' ? 'sendCode' : 'verifyCode')}
        </Button>
      </fieldset>
      {message && <p className='text-sm'>{message}</p>}
      {error && (
        <p role='alert' className='text-sm text-destructive'>
          {error}
        </p>
      )}
    </form>
  )
}

/** Forgot password request (PD-1049) or, with a `token`, the reset form (PD-1050). */
export function PasswordResetForm({ token }: { token?: string }) {
  const copy = useCopy()
  const router = useRouter()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setPending(true)
    setError('')
    try {
      if (token) {
        const result = await authClient.resetPassword({ newPassword: String(data.get('password') ?? ''), token })
        if (result.error) return setError(copy(result.error.status === 400 && /weak|PASSWORD/i.test(result.error.message ?? '') ? 'weakPassword' : 'resetInvalid'))
        setMessage(copy('resetDone'))
        router.replace(linkto.login)
        return
      }
      const result = await authClient.requestPasswordReset({ email: String(data.get('email') ?? '').trim(), redirectTo: `${window.location.origin}${linkto.login}` })
      if (result.error) return setError(copy('resetFailed'))
      setMessage(copy('resetSent'))
    } finally {
      setPending(false)
    }
  }

  return (
    <form className='space-y-3' onSubmit={submit} noValidate>
      <fieldset disabled={pending} className='space-y-3'>
        {token ? (
          <input className={inputClass} name='password' type='password' autoComplete='new-password' minLength={8} maxLength={128} required placeholder={copy('newPassword')} />
        ) : (
          <input className={inputClass} name='email' type='email' autoComplete='email' required />
        )}
        <Button className='w-full' type='submit'>
          {copy(token ? 'resetPassword' : 'sendReset')}
        </Button>
      </fieldset>
      {message && <p className='text-sm'>{message}</p>}
      {error && (
        <p role='alert' className='text-sm text-destructive'>
          {error}
        </p>
      )}
      <Link className='text-sm text-primary underline' href={linkto.login}>
        {copy('backToLogin')}
      </Link>
    </form>
  )
}
