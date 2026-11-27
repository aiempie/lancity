import { sql, type SQL } from 'drizzle-orm'
import { ServiceError } from '@/server/common/errors'

/**
 * Port of Plane `utils/estimate.py` (#9939). A plain non-negative decimal: no sign, exponent, nan/inf, hex or
 * underscore. Spaces around the number are allowed. {@link numericEstimateExpr} accepts exactly the same strings.
 */
export const NUMERIC_ESTIMATE_PATTERN = /^ *(?:[0-9]+\.?[0-9]*|\.[0-9]+) *$/

export const NON_NUMERIC_ESTIMATE_ERROR = 'Value must be a number for a points estimate'

export function isNumericEstimate(value: unknown): boolean {
  return NUMERIC_ESTIMATE_PATTERN.test(String(value))
}

/** Estimate point value as a number. Anything that is not numeric (for example "M = 2") counts as 0. */
export function estimateToNumber(value: unknown): number {
  return isNumericEstimate(value) ? Number(String(value).trim()) : 0
}

/**
 * SQL twin of {@link estimateToNumber} for a text column: the number, or NULL when the text is not numeric, so `sum`
 * skips it. SQLite has no regex, so the pattern is spelled with GLOB: only digits and dots, at most one dot, at least
 * one digit, after trimming spaces. `column` is interpolated as raw SQL, pass a constant such as `ep.value`.
 */
export function numericEstimateExpr(column: string): string {
  const text = `trim(${column}, ' ')`
  return `(case when ${text} not glob '*[^0-9.]*' and ${text} not glob '*.*.*' and ${text} glob '*[0-9]*' then cast(${text} as real) end)`
}

export const numericEstimateSql = (column: string): SQL => sql.raw(numericEstimateExpr(column))

/** Same as {@link numericEstimateExpr}, with 0 instead of NULL for a value that is not numeric. */
export const numericEstimateOrZeroSql = (column: string): SQL => sql.raw(`coalesce(${numericEstimateExpr(column)}, 0)`)

/** Rejects a points estimate with a value that is not a number. Other estimate types accept any text. */
export function assertNumericEstimateValues(type: string, values: readonly unknown[]) {
  if (type !== 'points') return
  const invalid = values.flatMap((value, index) => (value === undefined || isNumericEstimate(value) ? [] : [index]))
  if (invalid.length) throw new ServiceError(400, 'VALIDATION_ERROR', NON_NUMERIC_ESTIMATE_ERROR, { indexes: invalid })
}
