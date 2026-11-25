import { getClientIp } from '@/server/common/ip-address'

export type HostEnv = {
  WEB_URL?: string
  APP_BASE_URL?: string
  ADMIN_BASE_URL?: string
  SPACE_BASE_URL?: string
  ADMIN_BASE_PATH?: string
  SPACE_BASE_PATH?: string
  /** Lancity fallback when neither WEB_URL nor APP_BASE_URL is set. */
  BETTER_AUTH_URL?: string
}

function withSlashes(path: string | undefined, fallback: string): string {
  let value = typeof path === 'string' ? path : fallback
  if (!value.startsWith('/')) value = `/${value}`
  if (!value.endsWith('/')) value += '/'
  return value
}

/** Plane `base_host`: the origin (or admin/space/app base URL) used to build absolute links. */
export function baseHost(env: HostEnv, options: { isAdmin?: boolean; isSpace?: boolean; isApp?: boolean } = {}): string {
  const baseOrigin = env.WEB_URL || env.APP_BASE_URL || env.BETTER_AUTH_URL
  if (!baseOrigin) throw new Error('APP_BASE_URL or WEB_URL is not set')
  if (options.isAdmin) return (env.ADMIN_BASE_URL || baseOrigin) + withSlashes(env.ADMIN_BASE_PATH, '/god-mode/')
  if (options.isSpace) return (env.SPACE_BASE_URL || baseOrigin) + withSlashes(env.SPACE_BASE_PATH, '/spaces/')
  if (options.isApp) return env.APP_BASE_URL || baseOrigin
  return baseOrigin
}

/** Plane `user_ip`. */
export function userIp(source: Request | Headers): string | null {
  return getClientIp(source)
}
