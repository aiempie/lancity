import { getSchema, type JSONContent } from '@tiptap/core'
import { Node } from '@tiptap/pm/model'
import {
  CoreEditorExtensionsWithoutProps,
  DocumentEditorExtensionsWithoutProps
} from '@/components/editor/extensions/core-without-props'
import { UniqueID } from '@/components/editor/extensions/unique-id/extension'

/**
 * Node and mark set of the live document editor as stored in pages: the Plane storage extensions plus the block ids
 * (`UniqueID`) that the live editors add to every block.
 */
export const documentExtensions = [
  ...CoreEditorExtensionsWithoutProps,
  ...DocumentEditorExtensionsWithoutProps,
  UniqueID
]
export const documentSchema = getSchema(documentExtensions)

/** Parse with the editor schema (fills defaults, sorts marks, rejects unknown nodes and attributes) and back. */
export function normalize(doc: unknown): JSONContent {
  const node = Node.fromJSON(documentSchema, doc)
  node.check()
  return node.toJSON() as JSONContent
}

/** Paths where two documents differ, with both values: readable failures instead of one huge JSON diff. */
export function differences(expected: unknown, actual: unknown, path = ''): string[] {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return []
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)])
    return [...keys].flatMap(key =>
      differences(
        (expected as Record<string, unknown>)[key],
        (actual as Record<string, unknown>)[key],
        `${path}.${key}`
      )
    )
  }
  return [`${path || '.'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`]
}
