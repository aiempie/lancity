import { ServiceError } from '@/server/common/errors'

/**
 * Plane `webhook.generate_token` (`"plane_wh_" + uuid4().hex`). Lancity keeps the 64 hex character secret that
 * the existing service already issued, which also carries more entropy than a UUID.
 */
export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Plane `validate_schema`: only http and https URLs. */
export function validateSchema(value: string): void {
  let protocol: string
  try {
    protocol = new URL(value).protocol
  } catch {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Enter a valid URL.')
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid schema. Only HTTP and HTTPS are allowed.')
  }
}

/** Plane `validate_domain`: reject `localhost` and `127.0.0.1` (Plane compares the whole netloc, port included). */
export function validateDomain(value: string): void {
  const { host, hostname } = new URL(value)
  if (['localhost', '127.0.0.1'].includes(host) || ['localhost', '127.0.0.1'].includes(hostname)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Local URLs are not allowed.')
  }
}
