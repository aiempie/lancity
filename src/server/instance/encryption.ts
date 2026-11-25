import { getEnv } from '@/server/common/env'
import { logException } from '@/server/common/exception-logger'
import { ServiceError } from '@/server/common/errors'

const VERSION = 'v1'
const keyCache = new Map<string, Promise<CryptoKey>>()

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const fromBase64Url = (text: string) =>
  Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0))

function secretFromEnv(): string {
  const secret = getEnv().INSTANCE_ENCRYPTION_KEY
  return typeof secret === 'string' ? secret : ''
}

/** Plane `derive_key`: PBKDF2-SHA256 (100,000 rounds, salt "salt") of the secret, here as a WebCrypto AES-GCM key. */
export function deriveKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret)
  if (!key) {
    key = (async () => {
      const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey'])
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode('salt'), iterations: 100_000 },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      )
    })()
    keyCache.set(secret, key)
  }
  return key
}

/**
 * Plane `encrypt_data`: AES-GCM with a random 96-bit IV, stored as `v1:<iv>.<ciphertext>` (base64url).
 * Empty input gives an empty string. Unlike Plane (which swallows errors and returns ""), a missing
 * `INSTANCE_ENCRYPTION_KEY` throws so a secret is never silently erased.
 */
export async function encryptData(data: string | null | undefined, secret = secretFromEnv()): Promise<string> {
  if (!data) return ''
  if (!secret) throw new ServiceError(500, 'ENCRYPTION_KEY_MISSING', 'INSTANCE_ENCRYPTION_KEY is not configured')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(secret), new TextEncoder().encode(data))
  return `${VERSION}:${toBase64Url(iv)}.${toBase64Url(new Uint8Array(cipher))}`
}

const fernetKeyCache = new Map<string, Promise<{ signing: CryptoKey; encryption: CryptoKey }>>()

/** Plane `derive_key` for Fernet: PBKDF2-SHA256 bytes split into a 16-byte signing key and a 16-byte AES-CBC key. */
function deriveFernetKeys(secret: string) {
  let keys = fernetKeyCache.get(secret)
  if (!keys) {
    keys = (async () => {
      const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits'])
      const bits = new Uint8Array(
        await crypto.subtle.deriveBits(
          { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode('salt'), iterations: 100_000 },
          material,
          256
        )
      )
      return {
        signing: await crypto.subtle.importKey('raw', bits.slice(0, 16), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify', 'sign']),
        encryption: await crypto.subtle.importKey('raw', bits.slice(16), { name: 'AES-CBC' }, false, ['encrypt', 'decrypt'])
      }
    })()
    fernetKeyCache.set(secret, keys)
  }
  return keys
}

/** True for a Fernet token as written by Plane (`gAAAA...`: version byte 0x80, base64url). */
export const isFernetToken = (value: string) => /^gAAAA[\w-]*={0,2}$/.test(value)

/** Decrypt a Plane Fernet token (version 0x80, AES-128-CBC + HMAC-SHA256). Throws on any failure. */
export async function decryptFernet(token: string, secret: string): Promise<string> {
  const raw = fromBase64Url(token.trim().replace(/=+$/, ''))
  if (raw.length < 1 + 8 + 16 + 16 + 32 || raw[0] !== 0x80) throw new Error('Invalid Fernet token')
  const { signing, encryption } = await deriveFernetKeys(secret)
  const body = raw.slice(0, raw.length - 32)
  if (!(await crypto.subtle.verify('HMAC', signing, raw.slice(raw.length - 32), body))) throw new Error('Invalid Fernet signature')
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: raw.slice(9, 25) }, encryption, raw.slice(25, raw.length - 32))
  return new TextDecoder('utf-8', { fatal: true }).decode(plain)
}

/** Build a Fernet token (used by tests and migration tooling; new data is written as `v1`). */
export async function encryptFernet(data: string, secret: string, iv = crypto.getRandomValues(new Uint8Array(16)), timestamp = Math.floor(Date.now() / 1000)) {
  const { signing, encryption } = await deriveFernetKeys(secret)
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, encryption, new TextEncoder().encode(data)))
  const body = new Uint8Array(25 + cipher.length)
  body[0] = 0x80
  new DataView(body.buffer).setBigUint64(1, BigInt(timestamp))
  body.set(iv, 9)
  body.set(cipher, 25)
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', signing, body))
  const out = new Uint8Array(body.length + 32)
  out.set(body)
  out.set(mac, body.length)
  return btoa(String.fromCharCode(...out)).replaceAll('+', '-').replaceAll('/', '_')
}

/**
 * Decrypt a stored value in either the `v1:` AES-GCM format or Plane's Fernet format. Empty input gives "".
 * Failures (missing key, wrong key, corrupt data) are logged and rethrown so a secret is never read as "".
 */
export async function decryptValue(encrypted: string | null | undefined, secret = secretFromEnv()): Promise<string> {
  if (!encrypted) return ''
  try {
    if (!secret) throw new Error('INSTANCE_ENCRYPTION_KEY is not configured')
    const match = /^v1:([\w-]+)\.([\w-]+)$/.exec(encrypted)
    if (match) {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(match[1]) }, await deriveKey(secret), fromBase64Url(match[2]))
      return new TextDecoder().decode(plain)
    }
    if (isFernetToken(encrypted)) return await decryptFernet(encrypted, secret)
    throw new Error('Unsupported encrypted value format')
  } catch (error) {
    logException(error)
    throw new ServiceError(500, 'DECRYPTION_FAILED', 'Could not decrypt the stored value')
  }
}

/** Like `decryptValue` but returns null instead of throwing (the failure is still logged). */
export async function decryptData(encrypted: string | null | undefined, secret = secretFromEnv()): Promise<string | null> {
  try {
    return await decryptValue(encrypted, secret)
  } catch {
    return null
  }
}
