import { getTranslations } from 'next-intl/server'
import { Link } from '@/components/ui/custom/link'
import { linkto } from '@/data/linkto'

export default async function Home() {
  const t = await getTranslations()

  return (
    <main className='mx-auto w-full max-w-md space-y-5 px-5 py-12'>
      <h1 className='font-serif text-3xl font-semibold'>Lancity</h1>
      <div className='flex gap-4'>
        <Link className='text-primary underline' href={linkto.login}>
          {t('auth.login')}
        </Link>
        <Link className='text-primary underline' href={linkto.register}>
          {t('auth.register')}
        </Link>
      </div>
    </main>
  )
}
