'use client'

import type { ReactNode } from 'react'
import { ProgressProvider as AppProgressProvider } from '@bprogress/next/app'

export function ProgressProvider({ children }: { children: ReactNode }) {
  return (
    <AppProgressProvider
      height='4px'
      color='var(--primary)'
      options={{ showSpinner: false }}
      shallowRouting
      disableAnchorClick
    >
      {children}
    </AppProgressProvider>
  )
}
