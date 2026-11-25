'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { linkto } from '@/data/linkto'
import { useRouter } from '@/hooks/use-router'
import { authClient } from '@/lib/auth/auth-client'
import type { MessageError } from '@/types/i18n/schema'

export function AccountActions({ canLinkGoogle, googleLinked }: { canLinkGoogle: boolean; googleLinked: boolean }) {
  const router = useRouter()
  const t = useTranslations()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<MessageError>()

  async function linkGoogle() {
    setPending(true)
    setError(undefined)
    try {
      const { data, error } = await authClient.linkSocial({
        provider: 'google',
        callbackURL: linkto.account,
        errorCallbackURL: linkto.account
      })
      if (error) {
        setError('googleLinkFailed')
      } else if (!data?.url) {
        router.refresh()
      }
    } catch {
      setError('googleConnectionFailed')
    } finally {
      setPending(false)
    }
  }

  async function signOut() {
    setPending(true)
    setError(undefined)
    try {
      const { error } = await authClient.signOut()
      if (error) {
        setError('signOutFailed')
        return
      }
      router.replace(linkto.login)
      router.refresh({ showProgress: false })
    } catch {
      setError('signOutFailed')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className='space-y-3'>
      {googleLinked && <p className='text-sm'>{t('auth.googleLinked')}</p>}
      <div className='flex flex-wrap gap-2'>
        {canLinkGoogle && (
          <Button variant='outline' disabled={pending} onClick={linkGoogle}>
            {t('auth.linkGoogle')}
          </Button>
        )}
        <Button variant='secondary' disabled={pending} onClick={signOut}>
          {t('auth.signOut')}
        </Button>
      </div>
      {error && (
        <p role='alert' className='text-sm text-destructive'>
          {t(`errors.${error}`)}
        </p>
      )}
    </div>
  )
}
