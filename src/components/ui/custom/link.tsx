'use client'

import { useProgress } from '@bprogress/next'
import NextLink from 'next/link'
import type { ComponentProps } from 'react'

export function Link({ href, onNavigate, ...props }: ComponentProps<typeof NextLink>) {
  const { start } = useProgress()

  return (
    <NextLink
      {...props}
      href={href}
      onNavigate={event => {
        let prevented = false
        onNavigate?.({
          preventDefault() {
            prevented = true
            event.preventDefault()
          }
        })
        if (prevented) return

        const target = new URL(typeof href === 'string' ? href : href.pathname || '', window.location.href)
        if (target.pathname !== window.location.pathname) start()
      }}
    />
  )
}
