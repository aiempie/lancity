import { parseSetCookieHeader, toCookieOptions } from 'better-auth/cookies'

/** Translate Better Auth response cookies into the options accepted by the Next cookie store. */
export function authResponseCookies(headers: string[]) {
  return headers.flatMap(header => Array.from(parseSetCookieHeader(header), ([name, attributes]) => ({
    name,
    value: attributes.value,
    ...toCookieOptions(attributes)
  })))
}
