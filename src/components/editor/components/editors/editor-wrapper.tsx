import type { Editor, Extensions } from '@tiptap/core'
// components
import { EditorContainer } from '@/components/editor/components/editors'
// constants
import { DEFAULT_DISPLAY_CONFIG } from '@/components/editor/constants/config'
// hooks
import { getEditorClassNames } from '@/components/editor/helpers/common'
import { useEditor } from '@/components/editor/hooks/use-editor'
// types
import type { IEditorProps } from '@/components/editor/types'
import { EditorContentWrapper } from './editor-content'

type Props = IEditorProps & {
  children?: (editor: Editor) => React.ReactNode
  editable: boolean
  extensions: Extensions
}

export function EditorWrapper(props: Props) {
  const {
    children,
    containerClassName,
    disabledExtensions,
    displayConfig = DEFAULT_DISPLAY_CONFIG,
    editable,
    editorClassName = '',
    editorProps,
    extendedEditorProps,
    extensions,
    getEditorMetaData,
    id,
    initialValue,
    isTouchDevice,
    fileHandler,
    flaggedExtensions,
    forwardedRef,
    mentionHandler,
    onChange,
    onEditorFocus,
    onTransaction,
    handleEditorReady,
    autofocus,
    placeholder,
    showPlaceholderOnEmpty,
    tabIndex,
    value
  } = props

  const editor = useEditor({
    editable,
    disabledExtensions,
    editorClassName,
    editorProps,
    enableHistory: true,
    extendedEditorProps,
    extensions,
    fileHandler,
    flaggedExtensions,
    forwardedRef,
    getEditorMetaData,
    id,
    isTouchDevice,
    initialValue,
    mentionHandler,
    onChange,
    onEditorFocus,
    onTransaction,
    handleEditorReady,
    autofocus,
    placeholder,
    showPlaceholderOnEmpty,
    tabIndex,
    value
  })

  const editorContainerClassName = getEditorClassNames({
    noBorder: true,
    borderOnFocus: false,
    containerClassName
  })

  if (!editor) return null

  return (
    <EditorContainer
      displayConfig={displayConfig}
      editor={editor}
      editorContainerClassName={editorContainerClassName}
      id={id}
      isTouchDevice={!!isTouchDevice}
    >
      {children?.(editor)}
      <div className='flex flex-col'>
        <EditorContentWrapper editor={editor} id={id} tabIndex={tabIndex} />
      </div>
    </EditorContainer>
  )
}
