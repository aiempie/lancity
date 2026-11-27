import type { Extensions } from '@tiptap/core'
// types
import type { IEditorProps } from '@/components/editor/types'

export type TCoreAdditionalExtensionsProps = Pick<
  IEditorProps,
  'disabledExtensions' | 'flaggedExtensions' | 'fileHandler' | 'extendedEditorProps'
>

export const CoreEditorAdditionalExtensions = (props: TCoreAdditionalExtensionsProps): Extensions => {
  const {} = props
  return []
}
