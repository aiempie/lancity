/**
 * Modified (c) 2026-present Lancity - 2NK Team
 */

'use client'

// editors
export {
  CollaborativeDocumentEditorWithRef,
  DocumentEditorWithRef,
  LiteTextEditorWithRef,
  RichTextEditorWithRef
} from '@/components/editor/components/editors'

// constants
export * from '@/components/editor/constants/common'

// helpers
export * from '@/components/editor/helpers/common'
export * from '@/components/editor/helpers/yjs-utils'

export { CORE_EXTENSIONS } from '@/components/editor/constants/extension'
export { ADDITIONAL_EXTENSIONS } from '@/components/editor/constants/extensions'

// types
export * from '@/components/editor/types'

// additional exports
export { TrailingNode } from '@/components/editor/extensions/trailing-node'
