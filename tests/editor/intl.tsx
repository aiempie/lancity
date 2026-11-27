import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import en from '@/data/i18n/en.json'
import ja from '@/data/i18n/ja.json'
import vi from '@/data/i18n/vi.json'
import type { Locale } from '@/types/i18n/schema'

const messages = { en, ja, vi }

/** The editor reads its UI strings through next-intl, like the app layout provides them. */
export function withIntl(node: ReactNode, locale: Locale = 'en') {
  return (
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone='UTC'>
      {node}
    </NextIntlClientProvider>
  )
}
