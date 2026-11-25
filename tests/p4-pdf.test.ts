import assert from 'node:assert/strict'
import test from 'node:test'
import { extractColorKeyFromCssVariable, resolveColorForPdf, safeCssColor } from '../src/server/pdf/colors'
import { recoverWithDefault, tryAsync, withTimeoutAndRetry } from '../src/server/pdf/effect-utils'
import { PdfGenerationError, PdfTimeoutError, mapPdfErrorToHttp } from '../src/server/pdf/errors'
import {
  collectHtmlImageRefs,
  collectHtmlUserMentionIds,
  collectJsonImageRefs,
  collectJsonUserMentionIds,
  renderStoredHtml
} from '../src/server/pdf/html-content'
import { getFileIcon } from '../src/server/pdf/icons'
import { applyMarks } from '../src/server/pdf/mark-renderers'
import { renderNode } from '../src/server/pdf/node-renderers'
import { buildHtml, renderHtmlToPdf } from '../src/server/pdf/plane-pdf-exporter'
import { pdfExportBodySchema, type TipTapNode } from '../src/types/content/p4-pdf-schema'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

test('colors resolve keys, CSS variables and reject unsafe values', () => {
  assert.equal(extractColorKeyFromCssVariable('var(--editor-colors-light-blue-background)'), 'light-blue')
  assert.equal(resolveColorForPdf('var(--editor-colors-gray-text)', 'text'), '#5c5e63')
  assert.equal(resolveColorForPdf('peach', 'background'), '#ffd5d7')
  assert.equal(resolveColorForPdf('#abc123', 'text'), '#abc123')
  assert.equal(resolveColorForPdf('nope', 'text'), null)
  assert.equal(safeCssColor('red; background:url(x)'), null)
  assert.equal(safeCssColor('rgb(1, 2, 3)'), 'rgb(1, 2, 3)')
})

test('marks fold into one style and ignore unknown marks', () => {
  const style = applyMarks([{ type: 'bold' }, { type: 'italic' }, { type: 'unknown' }, { type: 'underline' }])
  assert.equal(style['font-weight'], 'bold')
  assert.equal(style['font-style'], 'italic')
  assert.equal(style['text-decoration'], 'underline')
  const colored = applyMarks([{ type: 'customColor', attrs: { color: 'green', backgroundColor: 'expression(x)' } }])
  assert.equal(colored.color, '#0fc27b')
  assert.equal(colored['background-color'], undefined)
})

test('node renderers cover text, links, headings, lists, tasks and tables', () => {
  const doc: TipTapNode = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 9, textAlign: 'center' }, content: [{ type: 'text', text: 'Tiêu đề <b>' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
          { type: 'text', text: 'ok', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }
        ]
      },
      { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph' }] }] },
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 2, colwidth: [120] } }] },
          { type: 'tableRow', content: [{ type: 'tableCell', attrs: { background: 'pink' } }] }
        ]
      },
      { type: 'codeBlock', content: [{ type: 'text', text: '<script>1</script>' }] },
      { type: 'weird', content: [{ type: 'text', text: 'kept' }] }
    ]
  }
  const html = renderNode(doc)
  assert.match(html, /<h6 style="text-align:center;">Tiêu đề &lt;b&gt;<\/h6>/)
  assert.ok(html.includes('href="#"'))
  assert.ok(html.includes('href="https://example.com"'))
  assert.ok(html.includes('<ol start="3">'))
  assert.ok(html.includes('task-box checked'))
  assert.ok(html.includes('<tr class="header-row">'))
  assert.ok(html.includes('colspan="2"'))
  assert.ok(html.includes('width:120px'))
  assert.ok(html.includes('background-color:#fdd4e3'))
  assert.ok(html.includes('&lt;script&gt;1&lt;/script&gt;'))
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('kept'))
})

test('images use resolved data URIs, honour noAssets and fall back to a placeholder', () => {
  const node: TipTapNode = { type: 'imageComponent', attrs: { src: '42', width: '200', alignment: 'center' } }
  const resolved = renderNode(node, { resolvedImageUrls: { '42': PNG } })
  assert.ok(resolved.includes(`src="${PNG}"`))
  assert.ok(resolved.includes('width:200px'))
  assert.ok(resolved.includes('justify-content:center'))
  assert.ok(renderNode(node, {}).includes('img-placeholder'))
  assert.equal(renderNode(node, { noAssets: true, resolvedImageUrls: { '42': PNG } }), '')
  // A resolved value that is not a raster data URI is never embedded.
  assert.ok(renderNode(node, { resolvedImageUrls: { '42': 'https://evil.test/x.png' } }).includes('img-placeholder'))
})

test('callouts and mentions', () => {
  const callout = renderNode({
    type: 'calloutComponent',
    attrs: { 'data-background': 'green', 'data-logo-in-use': 'emoji', 'data-emoji-unicode': '💡' },
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'note' }] }]
  })
  assert.ok(callout.includes('background-color:#c3f0de'))
  assert.ok(callout.includes('💡'))
  const mention: TipTapNode = { type: 'mention', attrs: { entity_name: 'user_mention', entity_identifier: '7' } }
  assert.ok(
    renderNode(mention, { userMentions: [{ id: '7', display_name: 'Nguyễn <A>' }] }).includes('@Nguyễn &lt;A&gt;')
  )
  assert.ok(renderNode(mention).includes('@user_mention'))
})

test('collectors find images and user mentions in JSON and HTML', () => {
  const doc: TipTapNode = {
    type: 'doc',
    content: [
      { type: 'imageComponent', attrs: { src: '5' } },
      { type: 'image', attrs: { src: 'data:image/png;base64,AA==' } },
      {
        type: 'paragraph',
        content: [{ type: 'mention', attrs: { entity_name: 'user_mention', entity_identifier: '9' } }]
      }
    ]
  }
  assert.deepEqual(collectJsonImageRefs(doc), ['5'])
  assert.deepEqual(collectJsonUserMentionIds(doc), ['9'])
  const html =
    '<p><mention-component entity_name="user_mention" entity_identifier="3"></mention-component></p>' +
    '<image-component src="12" width="100"></image-component><img src="https://example.com/a.png">'
  assert.deepEqual(collectHtmlImageRefs(html), ['12', 'https://example.com/a.png'])
  assert.deepEqual(collectHtmlUserMentionIds(html), ['3'])
})

test('stored HTML is sanitized and editor components are rewritten', () => {
  const html =
    '<p onclick="x()">Hi</p><script>alert(1)</script>' +
    '<mention-component entity_name="user_mention" entity_identifier="3"></mention-component>' +
    '<image-component src="12" width="100" alignment="right"></image-component>' +
    '<image-component src="13"></image-component>'
  const out = renderStoredHtml(html, {
    userMentions: [{ id: '3', display_name: 'An' }],
    resolvedImageUrls: { '12': PNG }
  })
  assert.ok(!out.includes('script'))
  assert.ok(!out.includes('onclick'))
  assert.ok(out.includes('<span class="mention">@An</span>'))
  assert.ok(out.includes(`<img src="${PNG}"`))
  assert.ok(out.includes('justify-content:flex-end'))
  assert.ok(out.includes('[Image: 13...]'))
  assert.ok(!out.includes('image-component'))
  assert.equal(
    renderStoredHtml('<image-component src="12"></image-component>', {
      noAssets: true,
      resolvedImageUrls: { '12': PNG }
    }),
    ''
  )
})

test('print document blocks all network access and escapes the title', () => {
  const html = buildHtml({ html: '<p>x</p>' }, { title: 'A <i>b</i>' }, {})
  assert.ok(html.includes("default-src 'none'"))
  assert.ok(html.includes('<h1 class="title">A &lt;i&gt;b&lt;/i&gt;</h1>'))
  assert.ok(!html.includes('<i>b</i>'))
})

test('renderHtmlToPdf calls Browser Rendering with page options and maps failures', async () => {
  let body: Record<string, unknown> = {}
  const ok = {
    quickAction: async (_action: 'pdf', request: Record<string, unknown>) => {
      body = request
      return new Response(new Uint8Array([37, 80, 68, 70]))
    }
  }
  const bytes = await renderHtmlToPdf(ok, '<p>x</p>', { pageSize: 'LETTER', pageOrientation: 'landscape' })
  assert.deepEqual([...bytes], [37, 80, 68, 70])
  assert.equal(body.html, '<p>x</p>')
  assert.deepEqual((body.pdfOptions as Record<string, unknown>).format, 'letter')
  assert.equal((body.pdfOptions as Record<string, unknown>).landscape, true)
  await assert.rejects(renderHtmlToPdf(undefined, ''), (error: PdfGenerationError) => error.status === 503)
  const busy = { quickAction: async () => new Response('', { status: 429 }) }
  await assert.rejects(renderHtmlToPdf(busy, ''), (error: PdfGenerationError) => error.status === 503)
})

test('withTimeoutAndRetry retries server errors, times out and skips client errors', async () => {
  let calls = 0
  const value = await withTimeoutAndRetry('flaky', async () => {
    calls++
    if (calls < 2) throw new Error('boom')
    return 'ok'
  })
  assert.equal(value, 'ok')
  assert.equal(calls, 2)
  await assert.rejects(
    withTimeoutAndRetry('slow', () => new Promise<void>(() => undefined), { timeoutMs: 10, maxRetries: 0 }),
    PdfTimeoutError
  )
  let clientCalls = 0
  await assert.rejects(
    withTimeoutAndRetry('client', async () => {
      clientCalls++
      throw new PdfGenerationError('bad', 400)
    })
  )
  assert.equal(clientCalls, 1)
  assert.equal(await recoverWithDefault(async () => Promise.reject(new Error('x')), 'fallback'), 'fallback')
  await assert.rejects(
    tryAsync(
      () => Promise.reject(new Error('x')),
      () => new PdfGenerationError('wrapped')
    ),
    /wrapped/
  )
})

test('error mapping and request schema', () => {
  assert.deepEqual(mapPdfErrorToHttp(new PdfTimeoutError('late', 'render')), { status: 504, error: 'late' })
  assert.deepEqual(mapPdfErrorToHttp(new Error('secret')), { status: 500, error: 'Failed to generate PDF' })
  assert.equal(pdfExportBodySchema.safeParse({ pageSize: 'A5' }).success, false)
  assert.equal(
    pdfExportBodySchema.safeParse({ pageSize: 'A3', pageOrientation: 'landscape', async: true }).success,
    true
  )
  assert.ok(getFileIcon('application/pdf').includes('#dc2626'))
})
