import assert from 'node:assert/strict'
import test from 'node:test'
import { formatIssueType, formatProjectIssueType } from '../src/server/issue-type/presenters'

test('issue type labels match Plane model strings', () => {
  const issueType = { name: 'Lỗi' }
  assert.equal(formatIssueType(issueType), 'Lỗi')
  assert.equal(formatProjectIssueType({ name: 'Mobile' }, { name: 'Lancity' }, issueType), 'Mobile <Lancity> - Lỗi')
})
