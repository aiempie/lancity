import { translateEditor } from '@/components/editor/i18n'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import type { Extensions } from '@tiptap/core'
import { Placeholder } from '@tiptap/extensions'
import { useEditor } from '@tiptap/react'
import { useImperativeHandle } from 'react'
// constants
import { CORE_EDITOR_META } from '@/components/editor/constants/meta'
// extensions
import { TitleExtensions } from '@/components/editor/extensions/title-extension'
// helpers
import { getEditorRefHelpers } from '@/components/editor/helpers/editor-ref'
// types
import type { IEditorPropsExtended, IEditorProps } from '@/components/editor/types'
import type { EditorTitleRefApi, ICollaborativeDocumentEditorProps } from '@/components/editor/types/editor'

type TUseTitleEditorProps = {
  editable?: boolean
  provider: HocuspocusProvider
  titleRef?: React.MutableRefObject<EditorTitleRefApi | null>
  extensions?: Extensions
  initialValue?: string
  field?: string
  placeholder?: string
  updatePageProperties?: ICollaborativeDocumentEditorProps['updatePageProperties']
  id: string
  extendedEditorProps?: IEditorPropsExtended
  getEditorMetaData?: IEditorProps['getEditorMetaData']
}

/**
 * A hook that creates a title editor with collaboration features
 * Uses the same Y.Doc as the main editor but a different field
 */
export const useTitleEditor = (props: TUseTitleEditorProps) => {
  const {
    editable = true,
    id,
    initialValue = '',
    extensions,
    provider,
    updatePageProperties,
    titleRef,
    getEditorMetaData
  } = props

  // Force editor recreation when Y.Doc changes (provider.document.guid)
  const docKey = provider?.document?.guid ?? id

  const editor = useEditor(
    {
      onUpdate: ({ editor: titleEditor }) => {
        updatePageProperties?.(id, 'property_updated', { name: titleEditor?.getText() })
      },
      editable,
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      extensions: [
        ...TitleExtensions,
        ...(extensions ?? []),
        Placeholder.configure({
          placeholder: () => translateEditor('title.placeholder'),
          includeChildren: true,
          showOnlyWhenEditable: false
        })
      ],
      content: typeof initialValue === 'string' && initialValue.trim() !== '' ? initialValue : '<h1></h1>'
    },
    [editable, initialValue, docKey]
  )

  useImperativeHandle(titleRef, () => ({
    ...getEditorRefHelpers({
      editor,
      provider,
      getEditorMetaData: getEditorMetaData ?? (() => ({ file_assets: [], user_mentions: [] }))
    }),
    clearEditor: (emitUpdate = false) => {
      editor
        ?.chain()
        .setMeta(CORE_EDITOR_META.SKIP_FILE_DELETION, true)
        .setMeta(CORE_EDITOR_META.INTENTIONAL_DELETION, true)
        .clearContent(emitUpdate)
        .run()
    },
    setEditorValue: (content: string) => {
      editor?.commands.setContent(content, { emitUpdate: false })
    }
  }))

  return editor
}
