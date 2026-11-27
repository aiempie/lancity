import { cookies } from 'next/headers'
import type { getRequestConfig } from 'next-intl/server'
import { localeCookie, resolveLocale } from '@/data/i18n/config'
import en from '@/data/i18n/en.json'
import ja from '@/data/i18n/ja.json'
import vi from '@/data/i18n/vi.json'
import type { Locale, Messages } from '@/types/i18n/schema'

const dictionaries: Record<Locale, Messages> = { en, ja, vi }

// Keep the import type-only so the Vite dev runner can load this module while next-intl/server initializes.
const requestConfig: Parameters<typeof getRequestConfig>[0] = async () => {
  const locale = resolveLocale((await cookies()).get(localeCookie)?.value)

  return { locale, messages: dictionaries[locale], timeZone: 'UTC' }
}

export default requestConfig
