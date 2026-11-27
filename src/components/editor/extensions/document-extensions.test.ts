import type { AnyExtension, NodeConfig } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { DocumentEditorAdditionalExtensions } from './document-extensions'

const base = {
  disabledExtensions: [],
  flaggedExtensions: [],
  fileHandler: {} as never,
  isEditable: true,
  userDetails: { id: '1', name: 'An', color: '#000' }
}
const widgetCallback = () => null
const hasNodeView = (extensions: AnyExtension[]) =>
  Boolean((extensions.find(extension => extension.name === 'issue-embed-component')!.config as NodeConfig).addNodeView)
const names = (props: Parameters<typeof DocumentEditorAdditionalExtensions>[0]) =>
  DocumentEditorAdditionalExtensions(props).map(extension => extension.name)

describe('document editor additional extensions', () => {
  it('always keep the work item embed node in the schema, so stored embeds are not deleted', () => {
    expect(names({ ...base, extendedEditorProps: {} })).toContain('issue-embed-component')
    expect(names({ ...base, disabledExtensions: ['issue-embed', 'slash-commands'], extendedEditorProps: {} })).toEqual([
      'issue-embed-component'
    ])
  })

  it('use the embed handler unless issue-embed is disabled', () => {
    const extendedEditorProps = { embedHandler: { issue: { widgetCallback, searchCallback: async () => [] } } }
    expect(hasNodeView(DocumentEditorAdditionalExtensions({ ...base, extendedEditorProps }))).toBe(true)
    const disabled = { ...base, disabledExtensions: ['issue-embed' as const], extendedEditorProps }
    expect(hasNodeView(DocumentEditorAdditionalExtensions(disabled))).toBe(false)
  })
})
