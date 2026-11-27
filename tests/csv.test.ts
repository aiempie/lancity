import assert from 'node:assert/strict'
import { test } from 'vitest'
import { sanitizeCsvRow, sanitizeCsvValue } from '../src/server/export/csv-utils'

test('spreadsheet exports quote Plane formula triggers and preserve scalar types', () => {
  for (const trigger of ['=', '+', '-', '@', '\t', '\r', '\n']) {
    assert.equal(sanitizeCsvValue(`${trigger}text`), `'${trigger}text`)
  }
  assert.equal(sanitizeCsvValue('  @SUM(A1)'), "'  @SUM(A1)")
  assert.deepEqual(sanitizeCsvRow(['name', '', 0, -5, null, false, '-5']), ['name', '', 0, -5, null, false, "'-5"])
})
