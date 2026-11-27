import { gitHubEmojis } from '@tiptap/extension-emoji'
import { generateHTML, generateJSON } from '@tiptap/html'
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  fragmentToJson,
  getAllDocumentFormatsFromBinary,
  getBinaryDataFromHtml,
  htmlToJson,
  jsonToFragment,
  jsonToHtml
} from '@/server/collaboration/codec'
import { EMOJI_GLYPHS } from '@/server/collaboration/emoji-glyphs'
import { sanitizeHtml } from '@/server/issue/comment-html'
import fixture from '../fixtures/editor-document.json'
import { differences, documentExtensions, documentSchema, normalize } from './schema'

// The server codec (src/server/collaboration/codec.ts) runs on the Worker without a DOM, so it maps the editor
// nodes by hand. These tests hold it to the real editor schema: a page must open, sync, save and reopen unchanged.

const expected = normalize(fixture)

describe('fixture', () => {
  it('is a valid document of the live editor schema and covers every node and mark', () => {
    expect(differences(fixture, expected)).toEqual([])
    const used = new Set<string>()
    const visit = (node: { type: string; marks?: { type: string }[]; content?: unknown[] }) => {
      used.add(node.type)
      for (const mark of node.marks ?? []) used.add(mark.type)
      for (const child of node.content ?? []) visit(child as typeof node)
    }
    visit(expected as Parameters<typeof visit>[0])
    // `textStyle` carries no attribute in this schema (colors are `customColor`), so it changes nothing in a document.
    const missing = [...Object.keys(documentSchema.nodes), ...Object.keys(documentSchema.marks)].filter(
      name => !used.has(name) && name !== 'textStyle'
    )
    expect(missing).toEqual([])
  })
})

describe('Yjs state written by the editor (y-tiptap)', () => {
  it('reads back through the server codec unchanged', () => {
    const doc = new Y.Doc()
    prosemirrorJSONToYXmlFragment(documentSchema, fixture, doc.getXmlFragment('default'))
    expect(differences(expected, normalize(fragmentToJson(doc.getXmlFragment('default'))))).toEqual([])
  })

  it('keeps every format when the page is saved from its binary state', () => {
    const doc = new Y.Doc()
    prosemirrorJSONToYXmlFragment(documentSchema, fixture, doc.getXmlFragment('default'))
    const formats = getAllDocumentFormatsFromBinary(Y.encodeStateAsUpdate(doc))
    expect(differences(expected, normalize(formats.contentJSON))).toEqual([])
    // The stored HTML must bring the same document back (pages without binary state are loaded from it).
    expect(differences(expected, normalize(htmlToJson(formats.contentHTML)))).toEqual([])
  })
})

describe('Yjs state written by the server codec', () => {
  it('opens in the editor (y-tiptap) unchanged', () => {
    const doc = new Y.Doc()
    jsonToFragment(doc.getXmlFragment('default'), expected as Parameters<typeof jsonToFragment>[1])
    const opened = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment('default'), documentSchema)
    expect(differences(expected, normalize(opened.toJSON()))).toEqual([])
  })

  it('round trips HTML that the server stored into the same Yjs document', () => {
    const binary = getBinaryDataFromHtml(jsonToHtml(expected as Parameters<typeof jsonToHtml>[0]), 'Title')
    const doc = new Y.Doc()
    Y.applyUpdate(doc, binary)
    const opened = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment('default'), documentSchema)
    expect(differences(expected, normalize(opened.toJSON()))).toEqual([])
    expect(fragmentToJson(doc.getXmlFragment('title'))).toEqual({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] }]
    })
  })
})

describe('HTML', () => {
  it('written by the editor is parsed by the server codec unchanged', () => {
    const html = generateHTML(fixture, documentExtensions)
    expect(differences(expected, normalize(htmlToJson(html)))).toEqual([])
  })

  it('written by the server codec is parsed by the server codec unchanged', () => {
    const html = jsonToHtml(expected as Parameters<typeof jsonToHtml>[0])
    expect(differences(expected, normalize(htmlToJson(html)))).toEqual([])
  })

  it('written by the server codec opens in the editor as well as the editor HTML does', () => {
    // The editor's own HTML parsing loses some data (see the README), so the reference is the editor reading its
    // own HTML, not the fixture.
    const reference = normalize(generateJSON(generateHTML(fixture, documentExtensions), documentExtensions))
    const html = jsonToHtml(expected as Parameters<typeof jsonToHtml>[0])
    expect(differences(reference, normalize(generateJSON(html, documentExtensions)))).toEqual([])
  })
})

describe('HTML stored for a page (sanitized like every description)', () => {
  // The sanitizer sets `rel="noopener noreferrer"` on every link (Plane nh3 `link_rel`); everything else must survive.
  const withSanitizedRel = (doc: unknown) =>
    JSON.parse(JSON.stringify(doc).replaceAll('"rel":"noopener noreferrer nofollow"', '"rel":"noopener noreferrer"'))

  it.each([
    ['the live save (codec HTML)', () => jsonToHtml(expected as Parameters<typeof jsonToHtml>[0])],
    ['an API client sending editor HTML', () => generateHTML(fixture, documentExtensions)]
  ])('keeps the document for %s, so duplicates and restored versions match', (_label, html) => {
    const stored = sanitizeHtml(html())
    expect(differences(withSanitizedRel(expected), normalize(htmlToJson(stored)))).toEqual([])
  })
})

describe('emoji glyph table of the Worker', () => {
  it('matches the emoji set of the installed editor extension', () => {
    const editorGlyphs = Object.fromEntries(
      gitHubEmojis.filter(emoji => emoji.emoji).map(emoji => [emoji.name, emoji.emoji])
    )
    expect(EMOJI_GLYPHS).toEqual(editorGlyphs)
  })
})
