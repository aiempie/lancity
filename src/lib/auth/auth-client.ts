'use client'

import { emailOTPClient, usernameClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { linkto } from '@/data/linkto'

export const authClient = createAuthClient({
  basePath: linkto.authApi,
  plugins: [usernameClient(), emailOTPClient()]
})
