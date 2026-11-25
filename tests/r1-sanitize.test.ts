import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeHtml } from '../src/server/issue/comment-html'
import { assertSafeDescriptionHtml, sanitizeDescriptionHtml } from '../src/server/issue/sequence'
import { validateHtmlContent } from '../src/server/page/content-validator'

const links = [
  '<a href="java&#115;cript:alert(1)">x</a>',
  '<a href="&#x6A;avascript:alert(1)">x</a>',
  '<a href="java&#115cript:alert(1)">x</a>',
  '<a href="javascript&colon;alert(1)">x</a>',
  '<a href="jav&Tab;ascript:alert(1)">x</a>',
  '<a href="jav&#9;ascript:alert(1)">x</a>',
  '<a href="jav\tascript:alert(1)">x</a>',
  '<a href="jav\nascript:alert(1)">x</a>',
  '<a href="  \u0001javascript:alert(1)">x</a>',
  '<a href=javascript:alert(1)>x</a>',
  '<a href="data:text/html;base64,AAAA">x</a>',
  '<a href="vbscript:x">x</a>'
]

for (const html of links)
  test(`sanitizeHtml drops dangerous href: ${JSON.stringify(html)}`, () => {
    const out = sanitizeHtml(html)
    assert.ok(!/href/i.test(out), out)
    assert.ok(out.includes('rel="noopener noreferrer"'), out)
  })

test('sanitizeHtml keeps safe links and adds rel', () => {
  assert.equal(
    sanitizeHtml('<a href="https://a.test/?x=1&amp;y=2" target="_blank">x</a>'),
    '<a href="https://a.test/?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">x</a>'
  )
  assert.ok(sanitizeHtml('<a href="mailto:a@b.c">x</a>').includes('href="mailto:a@b.c"'))
  assert.ok(sanitizeHtml('<a href="/relative/path">x</a>').includes('href="/relative/path"'))
})

test('sanitizeHtml drops dangerous img src and event handlers', () => {
  assert.equal(sanitizeHtml('<img src=x onerror=alert(1)>'), '<img src="x">')
  assert.ok(!sanitizeHtml('<img src="java&#115;cript:alert(1)">').includes('src'))
  assert.ok(!/onload|svg/i.test(sanitizeHtml('<svg/onload=alert(1)>')))
  assert.ok(!/<script|alert/.test(sanitizeHtml('<script>alert(1)</script><p>ok</p>')))
  assert.ok(!/<iframe/.test(sanitizeHtml('<iframe src="https://x.test"></iframe>')))
})

test('sanitizeHtml only allows Plane data-* attributes', () => {
  const out = sanitizeHtml('<div data-type="x" data-evil="1" data-onclick="y" data-block-type="b" data-id="3">t</div>')
  assert.equal(out, '<div data-type="x" data-block-type="b" data-id="3">t</div>')
  for (const key of [
    'tight',
    'node-type',
    'type',
    'checked',
    'background-color',
    'text-color',
    'name',
    'id',
    'icon-name',
    'icon-color',
    'background',
    'emoji-unicode',
    'emoji-url',
    'logo-in-use',
    'block-type'
  ])
    assert.ok(sanitizeHtml(`<p data-${key}="1">x</p>`).includes(`data-${key}="1"`), key)
})

test('sanitizeHtml escapes attribute and text content', () => {
  assert.equal(
    sanitizeHtml('<p title="a&quot;onmouseover=&quot;x">1 &lt; 2 > 0</p>'),
    '<p title="a&quot;onmouseover=&quot;x">1 &lt; 2 &gt; 0</p>'
  )
  assert.ok(!sanitizeHtml('<p style="background:url(javascript:x)">a</p>').includes('style'))
  assert.ok(!sanitizeHtml('<p style="background:u&#114;l(x)">a</p>').includes('style'))
})

test('validateHtmlContent applies the same sanitizer', () => {
  const result = validateHtmlContent('<a href="java&#115;cript:alert(1)">x</a><svg/onload=alert(1)>')
  assert.equal(result.isValid, true)
  assert.ok(!/href|svg|onload/.test(result.cleanHtml ?? ''))
})

test('sanitizeDescriptionHtml returns cleaned HTML and keeps empty values', () => {
  const clean = sanitizeDescriptionHtml('<p>hi</p><img src=x onerror=alert(1)><a href="java&#115;cript:1">l</a>')
  assert.equal(clean, '<p>hi</p><img src="x"><a rel="noopener noreferrer">l</a>')
  assert.equal(sanitizeDescriptionHtml(undefined), undefined)
  assert.equal(sanitizeDescriptionHtml(''), '')
  assert.throws(() => sanitizeDescriptionHtml('a'.repeat(10 * 1024 * 1024 + 1)), /html content is not valid/)
})

test('assertSafeDescriptionHtml still rejects raw script markup', () => {
  assert.throws(() => assertSafeDescriptionHtml('<script>x</script>'))
  assert.doesNotThrow(() => assertSafeDescriptionHtml('<p>plain</p>'))
})
