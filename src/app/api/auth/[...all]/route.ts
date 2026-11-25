import { getDb } from '@/db/client'
import { createAuth } from '@/lib/auth/auth'
import { loadAuthSettings } from '@/server/identity/settings'

async function handle(request: Request) {
  return createAuth(await loadAuthSettings(getDb())).handler(request)
}

export const GET = handle
export const POST = handle
