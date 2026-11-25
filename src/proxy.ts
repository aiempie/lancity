import { getSessionCookie } from 'better-auth/cookies'
import { NextResponse, type NextRequest } from 'next/server'
import { linkto, publicPaths } from '@/data/linkto'
import { authCookiePrefix } from '@/lib/auth/cookies'

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname.replace(/\/$/, '') || '/'
  const isPublic = publicPaths.some(
    ({ path, includeSubpaths }) => pathname === path || (includeSubpaths && pathname.startsWith(`${path}/`))
  )
  if (isPublic) return NextResponse.next()

  if (getSessionCookie(request, { cookiePrefix: authCookiePrefix })) {
    return NextResponse.next()
  }

  const response = NextResponse.redirect(new URL(linkto.login, request.url))
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export const config = {
  matcher: '/((?!_next(?:/|$)|_vinext(?:/|$)).*)'
}
