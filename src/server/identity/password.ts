import { ZxcvbnFactory } from '@zxcvbn-ts/core'
import * as zxcvbnCommonPackage from '@zxcvbn-ts/language-common'
import * as zxcvbnEnPackage from '@zxcvbn-ts/language-en'

/** Plane `is_password_strong` scores at most 128 characters from each end of the password. */
const ZXCVBN_MAX_LENGTH = 128
/** Plane accepts a window whose zxcvbn score is at least 3. */
const MIN_STRONG_SCORE = 3

// Built once per isolate. Only the common and English dictionaries are loaded to keep the Worker bundle small.
const zxcvbn = new ZxcvbnFactory({
  translations: zxcvbnEnPackage.translations,
  graphs: zxcvbnCommonPackage.adjacencyGraphs,
  dictionary: { ...zxcvbnCommonPackage.dictionary, ...zxcvbnEnPackage.dictionary }
})

/** zxcvbn score (0-4) of a single window. */
export function passwordScore(password: string): number {
  return zxcvbn.check(password).score
}

/** Plane `is_password_strong`: score >= 3 on the head or the tail window (128 chars each). */
export function isPasswordStrong(password: string): boolean {
  const windows = new Set([password.slice(0, ZXCVBN_MAX_LENGTH), password.slice(-ZXCVBN_MAX_LENGTH)])
  return [...windows].some(window => passwordScore(window) >= MIN_STRONG_SCORE)
}
