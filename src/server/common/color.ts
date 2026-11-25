const HEX_DIGITS = '0123456789abcdefABCDEF'

/** Plane `get_random_color`: `#` followed by six random hex digits (upper or lower case). */
export function getRandomColor(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return `#${Array.from(bytes, byte => HEX_DIGITS[byte % HEX_DIGITS.length]).join('')}`
}
