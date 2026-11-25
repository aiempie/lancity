const formulaPrefix = /^[=+\-@\t\r\n]|^[\s\u0000-\u001f]+[=+\-@]/

export function sanitizeCsvValue<T>(value: T): T | string {
  return typeof value === 'string' && formulaPrefix.test(value) ? `'${value}` : value
}

export function sanitizeCsvRow<T>(row: readonly T[]) {
  return row.map(sanitizeCsvValue)
}
