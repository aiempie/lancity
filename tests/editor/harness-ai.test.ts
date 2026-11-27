import { describe, expect, it } from 'vitest'
import { fakeAIAnswer } from './harness/local-ai'

describe('harness fake AI answers', () => {
  it('summarize and rewrite the selected text deterministically', () => {
    expect(fakeAIAnswer('summarize', '  one two three four five six seven eight ')).toBe(
      'TL;DR: one two three four five six…'
    )
    expect(fakeAIAnswer('rewrite', 'a very  long text')).toBe('a long text')
    expect(fakeAIAnswer('rewrite', 'very')).toBe('very')
  })
})
