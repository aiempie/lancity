const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

/** Plane `generate_label_token`: the default label of an API token (`uuid4().hex`). */
export function generateLabelToken(): string {
  return crypto.randomUUID().replaceAll('-', '')
}

/**
 * Plane `generate_token`: `"plane_api_" + uuid4().hex`. The prefix stays for client compatibility; the random part
 * is 32 bytes (64 hex characters) from the Workers CSPRNG.
 */
export function generateToken(): string {
  return `plane_api_${hex(crypto.getRandomValues(new Uint8Array(32)))}`
}

/** The value stored in `api_tokens.token`. The plain token is shown once and cannot be recovered afterwards. */
export async function hashApiToken(token: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))))
}
