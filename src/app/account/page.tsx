import { Suspense } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { AccountActions } from '@/components/auth/account-actions'
import { PasswordSettings } from '@/components/auth/password-settings'
import { Link } from '@/components/ui/custom/link'
import { getDb } from '@/db/client'
import { loadAuthSettings } from '@/server/identity/settings'
import { linkto } from '@/data/linkto'
import { createAuth, isGoogleEnabled } from '@/lib/auth/auth'
import { getServerSession } from '@/lib/auth/server-session'
import { findUser } from '@/server/identity/queries'

async function AccountContent({ searchParams }: PageProps<'/account'>) {
  const requestHeaders = await headers()
  const auth = createAuth()
  const session = await getServerSession(requestHeaders)
  if (!session) redirect(linkto.login)

  const [accounts, { error }, t] = await Promise.all([
    auth.api.listUserAccounts({ headers: requestHeaders }),
    searchParams,
    getTranslations()
  ])
  const { isPasswordAutoset } = await findUser({ userId: Number(session.user.id) })
  const googleLinked = accounts.some(account => account.providerId === 'google')
  const canLinkGoogle =
    isGoogleEnabled(await loadAuthSettings(getDb())) && !googleLinked && accounts.some(account => account.providerId === 'credential')

  return (
    <main className='mx-auto w-full max-w-md space-y-5 px-5 py-12'>
      <h1 className='font-serif text-3xl font-semibold'>{t('auth.account')}</h1>
      <div>
        <p className='font-semibold'>{session.user.name}</p>
        <p>{session.user.email}</p>
        {session.user.username && <p>@{session.user.username}</p>}
      </div>
      {error && (
        <p role='alert' className='text-sm text-destructive'>
          {t('errors.googleLinkSameEmail')}
        </p>
      )}
      <Link href={linkto.workspaces}>{t('auth.workspaces')}</Link>
      <AccountActions canLinkGoogle={canLinkGoogle} googleLinked={googleLinked} />
      <PasswordSettings passwordAutoset={isPasswordAutoset ?? !accounts.some(account => account.providerId === 'credential')} />
    </main>
  )
}

export default function AccountPage(props: PageProps<'/account'>) {
  return (
    <Suspense>
      <AccountContent {...props} />
    </Suspense>
  )
}
