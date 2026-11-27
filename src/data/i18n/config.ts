import type { useTranslations } from 'next-intl'
import type { Locale, MessageError } from '@/types/i18n/schema'

export const localeCookie = 'lancity_locale'
export const defaultLocale: Locale = 'vi'

export const languages = {
  vi: 'Tiếng Việt',
  en: 'English',
  ja: '日本語'
} satisfies Record<Locale, string>

export function resolveLocale(value: string | undefined): Locale {
  return value === 'en' || value === 'ja' ? value : defaultLocale
}

export function getErrorMessage(t: ReturnType<typeof useTranslations<'errors'>>, key: string) {
  const messageKey = key as MessageError
  return t(t.has(messageKey) ? messageKey : 'invalidForm')
}
