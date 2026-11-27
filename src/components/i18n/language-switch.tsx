'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { languages, localeCookie } from '@/data/i18n/config'
import { useRouter } from '@/hooks/use-router'
import type { Locale } from '@/types/i18n/schema'

function saveLocale(locale: Locale) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${localeCookie}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
}

export function LanguageSwitch({ locale }: { locale: Locale }) {
  const router = useRouter()
  const t = useTranslations()

  function changeLanguage(nextLocale: Locale) {
    if (nextLocale === locale) return

    saveLocale(nextLocale)
    router.refresh()
  }

  return (
    <div role='group' aria-label={t('language')} className='flex gap-1'>
      {(Object.keys(languages) as Locale[]).map(code => (
        <Button
          key={code}
          type='button'
          size='sm'
          variant={locale === code ? 'secondary' : 'ghost'}
          aria-pressed={locale === code}
          lang={code}
          onClick={() => changeLanguage(code)}
        >
          {languages[code]}
        </Button>
      ))}
    </div>
  )
}
