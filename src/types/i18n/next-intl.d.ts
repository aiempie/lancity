import 'next-intl'
import type { Locale as AppLocale, Messages as AppMessages } from '@/types/i18n/schema'

declare module 'next-intl' {
  interface AppConfig {
    Locale: AppLocale
    Messages: AppMessages
  }
}
