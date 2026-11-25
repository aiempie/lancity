const HEX32 = /^[0-9a-f]{32}$/i

function normalizeUuid(value: string): string | null {
  const text = value
    .trim()
    .replace(/^urn:uuid:/i, '')
    .replace(/^\{|\}$/g, '')
    .replaceAll('-', '')
  return HEX32.test(text) ? text.toLowerCase() : null
}

/** Any well-formed UUID text, regardless of version (legacy Plane identifiers stored in imported JSON). */
export function isUuidLike(value: unknown): boolean {
  return typeof value === 'string' && normalizeUuid(value) !== null
}

/** Plane `is_valid_uuid`: true only for an RFC 4122 version 4 UUID. */
export function isValidUuid(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const hex = normalizeUuid(value)
  return hex !== null && hex[12] === '4' && '89ab'.includes(hex[16])
}

/** Lancity identifiers are positive auto-increment integers, given as number or digit string. */
export function isEntityId(value: unknown): boolean {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0
  return typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value)
}

/** Plane `convert_uuid_to_integer`: SHA-256 of the text, first 8 bytes read as a big-endian signed 64-bit integer. */
export async function convertUuidToInteger(value: string): Promise<bigint> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  let result = BigInt(0)
  for (const byte of digest.slice(0, 8)) result = (result << BigInt(8)) | BigInt(byte)
  return BigInt.asIntN(64, result)
}
