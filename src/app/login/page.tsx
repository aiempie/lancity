import { Suspense } from 'react'
import { AuthForm } from '@/components/auth/auth-form'
import { PasswordResetForm } from '@/components/auth/auth-extras'
import { enabledProviders, isGoogleEnabled } from '@/lib/auth/auth'
import { getDb } from '@/db/client'
import { loadAuthPageSettings } from '@/server/identity/settings'

async function LoginContent({ searchParams }: PageProps<'/login'>) {
  const { error, token, forgot } = await searchParams
  const oauthError = error === 'account_not_linked' ? 'googleAccountNotLinked' : error ? 'googleLoginFailed' : undefined

  // `?token=` comes from the emailed reset link; `?forgot=1` asks for one.
  if (typeof token === 'string' && token) {
    return (
      <main className='mx-auto w-full max-w-md space-y-5 px-5 py-12'>
        <PasswordResetForm token={token} />
      </main>
    )
  }
  if (forgot) {
    return (
      <main className='mx-auto w-full max-w-md space-y-5 px-5 py-12'>
        <PasswordResetForm />
      </main>
    )
  }

  const settings = await loadAuthPageSettings(getDb())
  return (
    <AuthForm
      mode='login'
      googleEnabled={isGoogleEnabled(settings)}
      oauthError={oauthError}
      providers={enabledProviders(settings).filter(id => id !== 'google')}
      magicEnabled={settings.magicLinkEnabled && settings.smtpConfigured}
    />
  )
}

export default function LoginPage(props: PageProps<'/login'>) {
  return (
    <Suspense>
      <LoginContent {...props} />
    </Suspense>
  )
}
