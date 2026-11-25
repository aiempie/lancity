import type { Metadata } from 'next'
import { Be_Vietnam_Pro, Playfair_Display } from 'next/font/google'
import { getLocale, getMessages } from 'next-intl/server'
import './globals.css'
import { LanguageSwitch } from '@/components/i18n/language-switch'
import { AppProviders } from '@/components/provider'
import { cn } from '@/lib/utils'

const beVietnamPro = Be_Vietnam_Pro({
  variable: '--font-be-vietnam-pro',
  subsets: ['latin', 'vietnamese'],
  weight: ['300', '400', '500', '600']
})

const playfairDisplay = Playfair_Display({
  variable: '--font-playfair-display',
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700', '800'],
  style: ['normal', 'italic']
})

export const metadata: Metadata = {
  title: 'Lancity'
}

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()])

  return (
    <html
      lang={locale}
      className={cn('h-full', 'antialiased', 'font-sans', beVietnamPro.variable, playfairDisplay.variable)}
    >
      <body className='min-h-full flex flex-col'>
        <AppProviders locale={locale} messages={messages}>
          <header className='mx-auto flex w-full max-w-md justify-end px-5 pt-4'>
            <LanguageSwitch locale={locale} />
          </header>
          {children}
        </AppProviders>
      </body>
    </html>
  )
}
