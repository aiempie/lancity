import type { Extensions } from '@tiptap/core'
import type { MutableRefObject } from 'react'
import { forwardRef, useMemo } from 'react'
// plane imports
import { cn } from '@/lib/utils'
// components
import { PageRenderer } from '@/components/editor/components/editors'
// constants
import { DEFAULT_DISPLAY_CONFIG } from '@/components/editor/constants/config'
// extensions
import { HeadingListExtension, SideMenuExtension } from '@/components/editor/extensions'
// helpers
import { getEditorClassNames } from '@/components/editor/helpers/common'
// hooks
import { useEditor } from '@/components/editor/hooks/use-editor'
// plane editor extensions
import { DocumentEditorAdditionalExtensions } from '@/components/editor/extensions/document-extensions'
// types
import type { EditorRefApi, IDocumentEditorProps } from '@/components/editor/types'

function DocumentEditor(props: IDocumentEditorProps) {
  const {
    aiEnabled = false,
    aiHandler,
    bubbleMenuEnabled = false,
    containerClassName,
    disabledExtensions,
    displayConfig = DEFAULT_DISPLAY_CONFIG,
    editable,
    editorClassName = '',
    extendedEditorProps,
    fileHandler,
    flaggedExtensions,
    forwardedRef,
    getEditorMetaData,
    handleEditorReady,
    id,
    isTouchDevice,
    mentionHandler,
    onChange,
    user,
    value
  } = props
  const extensions: Extensions = useMemo(() => {
    const additionalExtensions: Extensions = []
    additionalExtensions.push(
      SideMenuExtension({
        aiEnabled,
        dragDropEnabled: true
      }),
      HeadingListExtension,
      ...DocumentEditorAdditionalExtensions({
        disabledExtensions,
        extendedEditorProps,
        flaggedExtensions,
        isEditable: editable,
        fileHandler,
        userDetails: user ?? {
          id: '',
          name: '',
          color: ''
        }
      })
    )
    return additionalExtensions
  }, [aiEnabled, disabledExtensions, editable, extendedEditorProps, fileHandler, flaggedExtensions, user])

  const editor = useEditor({
    disabledExtensions,
    editable,
    editorClassName,
    enableHistory: true,
    extendedEditorProps,
    extensions,
    fileHandler,
    flaggedExtensions,
    forwardedRef,
    getEditorMetaData,
    handleEditorReady,
    id,
    initialValue: value,
    mentionHandler,
    onChange
  })

  const editorContainerClassName = getEditorClassNames({
    containerClassName
  })

  if (!editor) return null

  return (
    <PageRenderer
      aiEnabled={aiEnabled}
      aiHandler={aiHandler}
      bubbleMenuEnabled={bubbleMenuEnabled}
      displayConfig={displayConfig}
      editor={editor}
      editorContainerClassName={cn(editorContainerClassName, 'document-editor')}
      extendedEditorProps={extendedEditorProps}
      id={id}
      flaggedExtensions={flaggedExtensions}
      disabledExtensions={disabledExtensions}
      isTouchDevice={!!isTouchDevice}
    />
  )
}

const DocumentEditorWithRef = forwardRef(function DocumentEditorWithRef(
  props: IDocumentEditorProps,
  ref: React.ForwardedRef<EditorRefApi>
) {
  return <DocumentEditor {...props} forwardedRef={ref as MutableRefObject<EditorRefApi | null>} />
})

DocumentEditorWithRef.displayName = 'DocumentEditorWithRef'

export { DocumentEditorWithRef }
