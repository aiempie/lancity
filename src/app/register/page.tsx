import { Suspense } from 'react'
import { headers } from 'next/headers'
import { AuthForm } from '@/components/auth/auth-form'
import { getDb } from '@/db/client'
import { loadAuthPageSettings } from '@/server/identity/settings'
import { enabledProviders, isGoogleEnabled } from '@/lib/auth/auth'

async function RegisterContent() {
  await headers()
  const settings = await loadAuthPageSettings(getDb())
  return <AuthForm mode='register' googleEnabled={isGoogleEnabled(settings)} providers={enabledProviders(settings).filter(id => id !== 'google')} />
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterContent />
    </Suspense>
  )
}
