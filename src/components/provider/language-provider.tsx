'use client'

import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import type { Locale, Messages } from '@/types/i18n/schema'

export function LanguageProvider({
  children,
  locale,
  messages
}: {
  children: ReactNode
  locale: Locale
  messages: Messages
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone='UTC'>
      {children}
    </NextIntlClientProvider>
  )
}
