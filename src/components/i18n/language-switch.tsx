'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { languages, localeCookie } from '@/data/i18n/config'
import { useRouter } from '@/hooks/use-router'
import type { Locale } from '@/types/i18n/schema'

export function LanguageSwitch({ locale }: { locale: Locale }) {
  const router = useRouter()
  const t = useTranslations()

  function changeLanguage(nextLocale: Locale) {
    if (nextLocale === locale) return

    const secure = window.location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `${localeCookie}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
    router.refresh()
  }

  return (
    <div role='group' aria-label={t('language')} className='flex gap-1'>
      <Button
        type='button'
        size='sm'
        variant={locale === 'vi' ? 'secondary' : 'ghost'}
        aria-pressed={locale === 'vi'}
        lang='vi'
        onClick={() => changeLanguage('vi')}
      >
        {languages.vi}
      </Button>
      <Button
        type='button'
        size='sm'
        variant={locale === 'en' ? 'secondary' : 'ghost'}
        aria-pressed={locale === 'en'}
        lang='en'
        onClick={() => changeLanguage('en')}
      >
        {languages.en}
      </Button>
    </div>
  )
}
