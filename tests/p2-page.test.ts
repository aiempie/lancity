import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  computeHtmlSanitizationDiff,
  hasAlphanumeric,
  validateBinaryData,
  validateHtmlContent
} from '../src/server/page/content-validator'
import { stripTags } from '../src/server/page/html-processor'
import { pageDescriptionStripped } from '../src/server/page/model-rules'
import { checkProjectActionAccess } from '../src/server/page/permissions'
import { extractAllComponents, planPageTransactions } from '../src/server/page/jobs/page-transaction'
import { pageCreateBodySchema, pageUpdateBodySchema } from '../src/types/content/p2-page-schema'

test('stripTags keeps text, decodes entities and drops comments', () => {
  assert.equal(stripTags('<p>Fish &amp; <b>chips</b><!-- x --></p>'), 'Fish & chips')
  assert.equal(stripTags('a &#65; &lt;b&gt;'), 'a A <b>')
  assert.equal(stripTags('<script>if (a<b) {}</script>text'), 'if (a<b) {}text')
  assert.equal(stripTags('1 < 2 and <p'), '1 < 2 and ')
  assert.equal(pageDescriptionStripped(''), null)
  assert.equal(pageDescriptionStripped('<p></p>'), '')
})

test('validateBinaryData follows Plane limits and patterns', () => {
  assert.deepEqual(validateBinaryData(''), { isValid: true, error: null })
  assert.equal(validateBinaryData('!!!').isValid, false)
  assert.equal(validateBinaryData(Buffer.from([1, 2, 3])).error, 'Binary data too short to be valid document format')
  assert.equal(validateBinaryData(Buffer.from('<script>alert(1)</script>').toString('base64')).isValid, false)
  assert.equal(validateBinaryData(Buffer.from([0, 1, 2, 3, 4, 5]).toString('base64')).isValid, true)
  assert.equal(validateBinaryData(new Uint8Array(10 * 1024 * 1024 + 1)).isValid, false)
})

test('validateHtmlContent sanitizes and reports removals', () => {
  assert.deepEqual(validateHtmlContent(''), { isValid: true, error: null, cleanHtml: null })
  const result = validateHtmlContent(
    '<p onclick="x()">Hi</p><script>alert(1)</script><mention-component id="m1"></mention-component>'
  )
  assert.equal(result.isValid, true)
  assert.ok(result.cleanHtml?.includes('<p>Hi</p>'))
  assert.ok(result.cleanHtml?.includes('mention-component'))
  assert.ok(!result.cleanHtml?.includes('script') && !result.cleanHtml?.includes('onclick'))
  const diff = computeHtmlSanitizationDiff('<p onclick="x()">a</p><script></script>', '<p>a</p>')
  assert.deepEqual(diff, { removedTags: { script: 1 }, removedAttributes: { p: ['onclick'] } })
  assert.equal(validateHtmlContent('a'.repeat(10 * 1024 * 1024 + 1)).isValid, false)
  assert.equal(hasAlphanumeric('-_-'), false)
  assert.equal(hasAlphanumeric('-é-'), true)
})

test('page components are extracted and planned like Plane page_transaction', () => {
  const html =
    '<mention-component id="a" entity_name="user_mention" entity_identifier="7"></mention-component><image-component id="b" src="/x.png"></image-component>'
  const components = extractAllComponents(html)
  assert.equal(components['mention-component'][0].entity_identifier, '7')
  assert.equal(components['image-component'][0].src, '/x.png')
  const first = planPageTransactions({ oldIds: new Set(), next: components, hasExistingLogs: false })
  assert.deepEqual(
    first.inserts.map(item => [item.transaction, item.entityName]),
    [
      ['a', 'user_mention'],
      ['b', 'image']
    ]
  )
  const next = extractAllComponents('<mention-component id="a" entity_name="user_mention"></mention-component>')
  const second = planPageTransactions({ oldIds: new Set(['a', 'b']), next, hasExistingLogs: true })
  assert.deepEqual(second, { inserts: [], deletedIds: ['b'] })
})

test('project page action matrix', () => {
  assert.equal(checkProjectActionAccess('GET', 5), true)
  assert.equal(checkProjectActionAccess('POST', 5), false)
  assert.equal(checkProjectActionAccess('PATCH', 15), true)
  assert.equal(checkProjectActionAccess('DELETE', 15), false)
  assert.equal(checkProjectActionAccess('DELETE', 20), true)
})

test('page bodies accept snake_case keys and reject conflicting descriptions', () => {
  const created = pageCreateBodySchema.parse({
    name: ' A ',
    description_html: '<p>x</p>',
    view_props: { full_width: true }
  })
  assert.equal(created.name, 'A')
  assert.equal(created.descriptionHtml, '<p>x</p>')
  assert.equal(pageCreateBodySchema.safeParse({ descriptionText: 'a', descriptionHtml: '<p>a</p>' }).success, false)
  assert.equal(pageUpdateBodySchema.safeParse({}).success, false)
  assert.equal(pageUpdateBodySchema.safeParse({ access: 2 }).success, false)
})
