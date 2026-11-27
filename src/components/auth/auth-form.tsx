'use client'

import { useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Link } from '@/components/ui/custom/link'
import { getErrorMessage } from '@/data/i18n/config'
import { linkto } from '@/data/linkto'
import { useRouter } from '@/hooks/use-router'
import { authClient } from '@/lib/auth/auth-client'
import { loginSchema, registerSchema, type AuthFormMode } from '@/types/auth/schema'
import type { MessageError } from '@/types/i18n/schema'
import { MagicCodeForm, ProviderButtons } from './auth-extras'
import { authMessages } from './auth-messages'

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 focus-visible:outline focus-visible:outline-ring'

export function AuthForm({
  mode,
  googleEnabled,
  oauthError,
  providers = [],
  magicEnabled = false
}: {
  mode: AuthFormMode
  googleEnabled: boolean
  oauthError?: MessageError
  /** Other enabled OAuth providers (github, gitlab, gitea). */
  providers?: string[]
  magicEnabled?: boolean
}) {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations()
  const tErrors = useTranslations('errors')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const registering = mode === 'register'
  const title = t(`auth.${mode}`)
  const activeError = error || oauthError

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = Object.fromEntries(new FormData(event.currentTarget))
    const parsed = registering ? registerSchema.safeParse(fields) : loginSchema.safeParse(fields)
    if (!parsed.success) {
      setError(parsed.error.issues[0].message)
      return
    }

    setPending(true)
    setError('')
    try {
      const data = parsed.data
      const result =
        'identifier' in data
          ? data.identifier.includes('@')
            ? await authClient.signIn.email({ email: data.identifier, password: data.password })
            : await authClient.signIn.username({ username: data.identifier, password: data.password })
          : await authClient.signUp.email(data)

      if (result.error) {
        if (!registering) {
          setError('invalidCredentials')
        } else if (result.error.status >= 500) {
          setError('registerFailed')
        } else {
          setError('registerConflict')
        }
        return
      }

      router.replace(linkto.account)
      router.refresh({ showProgress: false })
    } catch {
      setError('connectionFailed')
    } finally {
      setPending(false)
    }
  }

  async function signInWithGoogle() {
    setPending(true)
    setError('')
    try {
      const result = await authClient.signIn.social({
        provider: 'google',
        callbackURL: linkto.account,
        errorCallbackURL: linkto.login
      })
      if (result.error) setError('googleLoginFailed')
    } catch {
      setError('googleConnectionFailed')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className='mx-auto w-full max-w-md space-y-5 px-5 py-12'>
      <h1 className='font-serif text-3xl font-semibold'>{title}</h1>
      <form className='space-y-4' method='post' onSubmit={submit} noValidate>
        <fieldset disabled={pending} className='space-y-4'>
          {registering ? (
            <>
              <label className='block space-y-1'>
                <span>{t('auth.name')}</span>
                <input className={inputClass} name='name' autoComplete='name' maxLength={100} required />
              </label>
              <label className='block space-y-1'>
                <span>{t('auth.username')}</span>
                <input
                  className={inputClass}
                  name='username'
                  autoComplete='username'
                  minLength={3}
                  maxLength={30}
                  required
                />
              </label>
              <label className='block space-y-1'>
                <span>{t('auth.email')}</span>
                <input className={inputClass} name='email' type='email' autoComplete='email' required />
              </label>
            </>
          ) : (
            <label className='block space-y-1'>
              <span>{t('auth.identifier')}</span>
              <input className={inputClass} name='identifier' autoComplete='username' required />
            </label>
          )}
          <label className='block space-y-1'>
            <span>{t('auth.password')}</span>
            <input
              className={inputClass}
              name='password'
              type='password'
              autoComplete={registering ? 'new-password' : 'current-password'}
              minLength={registering ? 8 : undefined}
              maxLength={128}
              required
            />
          </label>
          <Button className='w-full' type='submit'>
            {title}
          </Button>
          {googleEnabled && (
            <Button className='w-full' type='button' variant='outline' onClick={signInWithGoogle}>
              {t('auth.continueWithGoogle')}
            </Button>
          )}
        </fieldset>
        {activeError && (
          <p role='alert' className='text-sm text-destructive'>
            {getErrorMessage(tErrors, activeError)}
          </p>
        )}
      </form>
      {providers.length > 0 && <ProviderButtons providers={providers} />}
      {magicEnabled && !registering && <MagicCodeForm />}
      {!registering && (
        <p className='text-sm'>
          <Link className='text-primary underline' href={`${linkto.login}?forgot=1`}>
            {authMessages[locale].forgotPassword}
          </Link>
        </p>
      )}
      <p className='text-sm'>
        {t(registering ? 'auth.alreadyHaveAccount' : 'auth.needAccount')}{' '}
        <Link className='text-primary underline' href={registering ? linkto.login : linkto.register}>
          {t(registering ? 'auth.login' : 'auth.register')}
        </Link>
      </p>
    </main>
  )
}
