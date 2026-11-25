import { ServiceError } from '@/server/common/errors'
import { parseNetworks, UrlSecurityError, validateUrl, type HostResolver } from '@/server/common/ip-address'
import { validateDomain, validateSchema } from '@/server/webhook/model-rules'

export type WebhookRow = {
  id: number
  url: string
  isActive: boolean
  project: boolean
  issue: boolean
  module: boolean
  cycle: boolean
  issueComment: boolean
  createdAt: Date
  updatedAt: Date
  secretKey?: string
}

/** Environment values that steer webhook URL checks (Plane `WEBHOOK_*` settings). */
export type WebhookUrlEnv = {
  WEBHOOK_ALLOWED_IPS?: unknown
  WEBHOOK_ALLOWED_HOSTS?: unknown
  WEBHOOK_DISALLOWED_DOMAINS?: unknown
  BETTER_AUTH_URL?: unknown
}

const csv = (value: unknown): string[] =>
  typeof value === 'string'
    ? value
        .split(',')
        .map(item => item.trim().replace(/\.$/, '').toLowerCase())
        .filter(Boolean)
    : []

export const webhookAllowedIps = (env: WebhookUrlEnv) =>
  parseNetworks(typeof env.WEBHOOK_ALLOWED_IPS === 'string' ? env.WEBHOOK_ALLOWED_IPS : undefined)
export const webhookAllowedHosts = (env: WebhookUrlEnv) => csv(env.WEBHOOK_ALLOWED_HOSTS)

/** Resolution failures are tolerated at save time; the delivery job validates the target again on every send. */
const UNRESOLVED = /could not be resolved|No IP addresses/

/**
 * Plane `WebhookSerializer._validate_webhook_url`: scheme, local names, SSRF check and the disallowed domains
 * (configured ones plus the host serving the request, a loop-back guard). Hosts in `WEBHOOK_ALLOWED_HOSTS` skip
 * the disallowed-domain check.
 */
export async function validateWebhookUrl(
  url: string,
  env: WebhookUrlEnv,
  options: { requestHost?: string; resolver?: HostResolver } = {}
): Promise<void> {
  validateSchema(url)
  validateDomain(url)
  const allowedHosts = webhookAllowedHosts(env)
  try {
    await validateUrl(url, { allowedIps: webhookAllowedIps(env), allowedHosts, resolver: options.resolver })
  } catch (error) {
    if (!(error instanceof UrlSecurityError) || !UNRESOLVED.test(error.message)) {
      throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid or disallowed webhook URL.', {
        url: 'Invalid or disallowed webhook URL.'
      })
    }
  }
  const hostname = new URL(url).hostname.replace(/\.$/, '').toLowerCase()
  if (allowedHosts.includes(hostname)) return
  const disallowed = csv(env.WEBHOOK_DISALLOWED_DOMAINS)
  const requestHost = options.requestHost?.split(':')[0].replace(/\.$/, '').toLowerCase()
  if (requestHost) disallowed.push(requestHost)
  if (typeof env.BETTER_AUTH_URL === 'string' && env.BETTER_AUTH_URL) {
    try {
      disallowed.push(new URL(env.BETTER_AUTH_URL).hostname.toLowerCase())
    } catch {
      // An invalid base URL only means there is no extra host to guard.
    }
  }
  if (disallowed.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'URL domain or its subdomain is not allowed.', {
      url: 'URL domain or its subdomain is not allowed.'
    })
  }
}

/**
 * Plane `WebhookSerializer.to_representation`: `secretKey` is the HMAC signing secret. It only appears on
 * creation and rotation (`showSecretKey`), never on list, retrieve or update.
 */
export function toWebhookResponse(row: WebhookRow, options: { showSecretKey?: boolean } = {}) {
  const { secretKey, ...rest } = row
  return options.showSecretKey && secretKey !== undefined ? { ...rest, secretKey } : rest
}

/** Plane `Webhook.__str__`. */
export const formatWebhook = (workspaceSlug: string, url: string) => `${workspaceSlug} ${url}`

/** Plane `WebhookLog.__str__`. */
export const formatWebhookLog = (eventType: string | null, webhookId: number) => `${eventType} ${webhookId}`

export type WebhookLogRow = {
  id: number
  eventType: string | null
  requestMethod: string | null
  requestHeaders: string | null
  requestBody: string | null
  responseStatus: string | null
  responseHeaders: string | null
  responseBody: string | null
  retryCount: number
  webhook: number
  createdAt: Date
  updatedAt: Date
}

/** Plane `WebhookLogSerializer`: every field except the workspace. */
export const toWebhookLogResponse = (row: WebhookLogRow) => ({ ...row })
