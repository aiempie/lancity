import { describe, expect, it } from 'vitest'
import { isValidAssetId } from './asset-id'
import { convertHTMLToMarkdown } from './markdown-parser'
import { sanitizeHTML } from './sanitize-html'

describe('isValidAssetId', () => {
  it('accepts Lancity numeric file asset ids', () => {
    for (const id of ['1', '42', '9007199254740991']) expect(isValidAssetId(id), id).toBe(true)
  })

  it('rejects URLs, UUIDs, zero and other strings', () => {
    for (const id of [
      '',
      '0',
      '01',
      '-1',
      '1.5',
      ' 1',
      'https://example.com/a.png',
      'blob:http://x/1',
      '2b8d3c2e-6a43-4c5c-9a2b-4f1d5f1c9a10'
    ])
      expect(isValidAssetId(id), id).toBe(false)
  })
})

describe('sanitizeHTML', () => {
  it('drops every tag and trims', () => {
    expect(sanitizeHTML('  <p>Hello <strong>world</strong></p><script>alert(1)</script> ')).toBe('Hello world')
  })

  it('drops non-text elements and escapes the text like sanitize-html', () => {
    expect(sanitizeHTML('<style>p{}</style><p>a &amp; b &lt;c&gt; "d"</p><noscript>x</noscript>')).toBe(
      'a &amp; b &lt;c&gt; &quot;d&quot;'
    )
    expect(sanitizeHTML('plain 😀 text')).toBe('plain 😀 text')
  })
})

describe('convertHTMLToMarkdown', () => {
  const metaData = {
    file_assets: [{ id: '7', name: 'diagram.png', url: 'https://cdn.example/7.png' }],
    user_mentions: [{ id: '3', display_name: 'An', url: '/users/3' }]
  }

  it('converts headings, marks, lists and the page title', () => {
    const markdown = convertHTMLToMarkdown({
      name: 'Plan <b>v2</b>',
      description_html:
        '<p>Some <strong>bold</strong> and <em>italic</em> text</p><ul><li><p>one</p></li><li><p>two</p></li></ul>',
      metaData
    })
    // The title is escaped before parsing, so its markup stays literal text instead of becoming bold.
    expect(markdown).toContain('# Plan <b>v2</b>')
    expect(markdown).not.toContain('**v2**')
    expect(markdown).toContain('**bold**')
    expect(markdown).toContain('_italic_')
    expect(markdown).toContain('* one\n\n* two')
  })

  it('resolves image assets and user mentions through the metadata', () => {
    const markdown = convertHTMLToMarkdown({
      description_html:
        '<image-component src="7"></image-component><p>Hi <mention-component entity_name="user_mention" entity_identifier="3"></mention-component></p>',
      metaData
    })
    expect(markdown).toContain('![diagram.png](https://cdn.example/7.png)')
    expect(markdown).toContain('[@An](/users/3)')
  })

  it('drops images and mentions that the metadata does not know', () => {
    const markdown = convertHTMLToMarkdown({
      description_html:
        '<image-component src="99"></image-component><p><mention-component entity_name="user_mention" entity_identifier="8"></mention-component>x</p>',
      metaData
    })
    expect(markdown).not.toContain('99')
    expect(markdown).not.toContain('@')
  })
})
