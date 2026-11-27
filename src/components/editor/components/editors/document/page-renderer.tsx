import { AIFeaturesMenu } from '@/components/editor/components/menus/ai-menu'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import type { Editor } from '@tiptap/react'
// plane imports
import { cn } from '@/lib/utils'
// components
import { DocumentContentLoader, EditorContainer, EditorContentWrapper } from '@/components/editor/components/editors'
import { BlockMenu, EditorBubbleMenu } from '@/components/editor/components/menus'
// types
import type { TCollabValue } from '@/components/editor/contexts'
import type {
  ICollaborativeDocumentEditorPropsExtended,
  IEditorProps,
  IEditorPropsExtended,
  TAIHandler,
  TDisplayConfig
} from '@/components/editor/types'

type Props = {
  /** Lancity: the AI menu only renders when AI is enabled (see `aiEnabled` of the document editors). */
  aiEnabled?: boolean
  aiHandler?: TAIHandler
  bubbleMenuEnabled: boolean
  disabledExtensions: IEditorProps['disabledExtensions']
  displayConfig: TDisplayConfig
  documentLoaderClassName?: string
  editor: Editor
  titleEditor?: Editor
  editorContainerClassName: string
  extendedDocumentEditorProps?: ICollaborativeDocumentEditorPropsExtended
  extendedEditorProps: IEditorPropsExtended
  flaggedExtensions: IEditorProps['flaggedExtensions']
  id: string
  isLoading?: boolean
  isTouchDevice: boolean
  tabIndex?: number
  provider?: HocuspocusProvider
  state?: TCollabValue['state']
}

export function PageRenderer(props: Props) {
  const {
    aiEnabled = false,
    aiHandler,
    bubbleMenuEnabled,
    disabledExtensions,
    displayConfig,
    documentLoaderClassName,
    editor,
    editorContainerClassName,
    extendedEditorProps,
    flaggedExtensions,
    id,
    isLoading,
    isTouchDevice,
    tabIndex,
    titleEditor,
    provider,
    state
  } = props
  return (
    <div
      className={cn('frame-renderer w-full flex-grow', {
        'wide-layout': displayConfig.wideLayout
      })}
    >
      {isLoading ? (
        <DocumentContentLoader className={documentLoaderClassName} />
      ) : (
        <>
          {titleEditor && (
            <div className='relative w-full py-3'>
              <EditorContainer
                editor={titleEditor}
                id={id + '-title'}
                isTouchDevice={isTouchDevice}
                editorContainerClassName='page-title-editor bg-transparent py-3 border-none'
                displayConfig={displayConfig}
              >
                <EditorContentWrapper
                  editor={titleEditor}
                  id={id + '-title'}
                  tabIndex={tabIndex}
                  className='no-scrollbar placeholder-placeholder w-full resize-none rounded-none border-none bg-transparent p-0 text-[2rem] leading-[2.375rem] font-bold tracking-[-2%] outline-none'
                />
              </EditorContainer>
            </div>
          )}
          <EditorContainer
            displayConfig={displayConfig}
            editor={editor}
            editorContainerClassName={editorContainerClassName}
            id={id}
            isTouchDevice={isTouchDevice}
            provider={provider}
            state={state}
          >
            <EditorContentWrapper editor={editor} id={id} tabIndex={tabIndex} />
            {editor.isEditable && !isTouchDevice && (
              <div>
                {bubbleMenuEnabled && (
                  <EditorBubbleMenu
                    editor={editor}
                    disabledExtensions={disabledExtensions}
                    extendedEditorProps={extendedEditorProps}
                    flaggedExtensions={flaggedExtensions}
                  />
                )}
                {aiEnabled && aiHandler?.menu && <AIFeaturesMenu editor={editor} menu={aiHandler.menu} />}
                <BlockMenu
                  editor={editor}
                  flaggedExtensions={flaggedExtensions}
                  disabledExtensions={disabledExtensions}
                />
              </div>
            )}
          </EditorContainer>
        </>
      )}
    </div>
  )
}
