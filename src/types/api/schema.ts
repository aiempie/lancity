import type { Actor } from '@/types/auth/schema'

/** Result of a successful role check, shared with the handler through the Hono context. */
export type PermissionContext = {
  workspaceId: number
  workspaceRole: number
  /** Present when the check ran at project level. Null when only a workspace admin passed. */
  projectRole?: number | null
}

export type ApiEnv = {
  Variables: {
    actor: Actor
    /** IANA timezone of the caller (see `getRequestTimezone`). */
    timezone?: string
    /** Set by the API key authenticator so the token logger knows to record the request. */
    apiKeyAuthenticated?: boolean
    permission?: PermissionContext
  }
}

export type TimezoneEntry = {
  utc_offset: string
  gmt_offset: string
  value: string
  label: string
}
