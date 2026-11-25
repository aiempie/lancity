'use server'

import { cookies, headers } from 'next/headers'
import { authResponseCookies } from '@/lib/auth/response-cookies'
import { requireActor } from '@/lib/auth/server-session'
import { ServiceError } from '@/server/common/errors'
import { changePassword, setUserPassword } from '@/server/identity/auth-actions'
import { deactivateUser } from '@/server/identity/account'
import { clientIp } from '@/server/identity/throttle'
import { changePasswordSchema, setPasswordSchema } from '@/types/auth/schema'

export type ActionResult = { ok: true } | { ok: false; error: string }

async function run(task: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await task()
    return { ok: true }
  } catch (error) {
    if (error instanceof ServiceError) return { ok: false, error: error.code }
    console.error('Account action failed', error)
    return { ok: false, error: 'INTERNAL_ERROR' }
  }
}

/** Server Action twin of POST /api/v1/auth/change-password and /set-password (same service). */
export async function changePasswordAction(input: { old_password?: string; new_password: string }): Promise<ActionResult> {
  return run(async () => {
    const requestHeaders = await headers()
    const actor = await requireActor(requestHeaders)
    const body = changePasswordSchema.parse(input)
    const result = await changePassword(actor, body, requestHeaders)
    const cookieStore = await cookies()
    for (const cookie of authResponseCookies(result.cookies)) cookieStore.set(cookie)
  })
}

export async function setPasswordAction(input: { password: string }): Promise<ActionResult> {
  return run(async () => {
    const requestHeaders = await headers()
    const actor = await requireActor(requestHeaders)
    await setUserPassword(actor, setPasswordSchema.parse(input).password, requestHeaders)
  })
}

/** Server Action twin of DELETE /api/v1/users/me. */
export async function deactivateAccountAction(): Promise<ActionResult> {
  return run(async () => {
    const requestHeaders = await headers()
    const actor = await requireActor(requestHeaders)
    await deactivateUser(actor, { ip: clientIp(requestHeaders) })
  })
}
