import assert from 'node:assert/strict'
import { test } from 'vitest'
import * as Y from 'yjs'
import { fragmentToJson, htmlToJson, jsonToHtml } from '../src/server/collaboration/codec'
import fixture from './fixtures/editor-document.json'

// Needs the isolated Worker of the other integration tests (`pnpm dev --port 4198`) and LIVE_SERVER_SECRET_KEY.
// The editor-schema checks of the codec live in tests/editor/codec-roundtrip.test.ts; this file checks the deployed
// route: the Worker must answer with the same document for editor HTML that carries callouts and work item embeds.
const base = new URL(process.env.LANCITY_TEST_URL ?? 'http://localhost:4198')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use an isolated local Worker')
const secret = process.env.LIVE_SERVER_SECRET_KEY

const find = (node, type) =>
  node.type === type ? node : (node.content ?? []).map(child => find(child, type)).find(Boolean)

test.skipIf(!secret)('convert-document keeps callouts, work item embeds, images and block ids', async () => {
  const html = jsonToHtml(fixture)
  const response = await fetch(new URL('/api/v1/live/convert-document', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'live-server-secret-key': secret },
    body: JSON.stringify({ description_html: html, variant: 'document' })
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(body.description_json, htmlToJson(html))

  const callout = find(body.description_json, 'calloutComponent')
  assert.deepEqual(callout.attrs, {
    id: 'b-callout',
    'data-icon-color': '#6d7b8a',
    'data-icon-name': 'AlertCircle',
    'data-emoji-unicode': '128161',
    'data-emoji-url': 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f4a1.png',
    'data-logo-in-use': 'icon',
    'data-background': 'light-blue',
    'data-block-type': 'callout-component'
  })
  assert.equal(find(callout, 'bulletList').attrs.id, 'b-callout-list')
  assert.deepEqual(find(body.description_json, 'issue-embed-component').attrs, {
    id: 'b-embed',
    entity_identifier: '42',
    project_identifier: '7',
    workspace_identifier: 'acme',
    entity_name: 'issue'
  })
  assert.equal(find(body.description_json, 'imageComponent').attrs.src, '12')

  // The binary state is what the live editor opens: it holds the same document.
  const doc = new Y.Doc()
  Y.applyUpdate(doc, new Uint8Array(Buffer.from(body.description_binary, 'base64')))
  assert.deepEqual(fragmentToJson(doc.getXmlFragment('default')), body.description_json)
})
