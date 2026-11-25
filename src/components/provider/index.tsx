'use client'

import type { ReactNode } from 'react'
import type { Locale, Messages } from '@/types/i18n/schema'
import { LanguageProvider } from './language-provider'
import { ProgressProvider } from './progress-provider'

export function AppProviders({
  children,
  locale,
  messages
}: {
  children: ReactNode
  locale: Locale
  messages: Messages
}) {
  return (
    <LanguageProvider locale={locale} messages={messages}>
      <ProgressProvider>{children}</ProgressProvider>
    </LanguageProvider>
  )
}
