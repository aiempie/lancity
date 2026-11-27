import React, { useMemo } from 'react'
// plane imports
import { cn } from '@/lib/utils'
// components
import { PageRenderer } from '@/components/editor/components/editors'
// constants
import { DEFAULT_DISPLAY_CONFIG } from '@/components/editor/constants/config'
// contexts
import { CollaborationProvider, useCollaboration } from '@/components/editor/contexts/collaboration-context'
// helpers
import { getEditorClassNames } from '@/components/editor/helpers/common'
// hooks
import { useCollaborativeEditor } from '@/components/editor/hooks/use-collaborative-editor'
// types
import type { EditorRefApi, ICollaborativeDocumentEditorProps } from '@/components/editor/types'

// Inner component that has access to collaboration context
function CollaborativeDocumentEditorInner(props: ICollaborativeDocumentEditorProps) {
  const {
    aiEnabled = false,
    aiHandler,
    bubbleMenuEnabled = true,
    containerClassName,
    documentLoaderClassName,
    extensions = [],
    disabledExtensions,
    displayConfig = DEFAULT_DISPLAY_CONFIG,
    editable,
    editorClassName = '',
    editorProps,
    extendedEditorProps,
    fileHandler,
    flaggedExtensions,
    forwardedRef,
    getEditorMetaData,
    handleEditorReady,
    id,
    dragDropEnabled = true,
    isTouchDevice,
    mentionHandler,
    onAssetChange,
    onChange,
    onEditorFocus,
    onTransaction,
    placeholder,
    tabIndex,
    user,
    extendedDocumentEditorProps,
    titleRef,
    updatePageProperties,
    isFetchingFallbackBinary
  } = props

  // Get non-null provider from context
  const { provider, state, actions } = useCollaboration()

  // Editor initialization with guaranteed non-null provider
  const { editor, titleEditor } = useCollaborativeEditor({
    aiEnabled,
    provider,
    disabledExtensions,
    editable,
    editorClassName,
    editorProps,
    extendedEditorProps,
    extensions,
    fileHandler,
    flaggedExtensions,
    getEditorMetaData,
    forwardedRef,
    handleEditorReady,
    id,
    dragDropEnabled,
    isTouchDevice,
    mentionHandler,
    onAssetChange,
    onChange,
    onEditorFocus,
    onTransaction,
    placeholder,
    tabIndex,
    titleRef,
    updatePageProperties,
    user,
    actions
  })

  const editorContainerClassNames = getEditorClassNames({
    noBorder: true,
    borderOnFocus: false,
    containerClassName
  })

  // Show loader ONLY when cache is known empty and server hasn't synced yet
  const shouldShowSyncLoader = state.isCacheReady && !state.hasCachedContent && !state.isServerSynced
  const shouldWaitForFallbackBinary = isFetchingFallbackBinary && !state.hasCachedContent && state.isServerDisconnected
  const isLoading = shouldShowSyncLoader || shouldWaitForFallbackBinary

  // Gate content rendering on isDocReady to prevent empty editor flash
  const showContentSkeleton = !state.isDocReady

  if (!editor || !titleEditor) return null

  return (
    <>
      <div
        className={cn(
          'transition-opacity duration-200',
          showContentSkeleton && !isLoading && 'pointer-events-none opacity-0'
        )}
      >
        <PageRenderer
          aiEnabled={aiEnabled}
          aiHandler={aiHandler}
          bubbleMenuEnabled={bubbleMenuEnabled}
          displayConfig={displayConfig}
          documentLoaderClassName={documentLoaderClassName}
          disabledExtensions={disabledExtensions}
          extendedDocumentEditorProps={extendedDocumentEditorProps}
          editor={editor}
          flaggedExtensions={flaggedExtensions}
          titleEditor={titleEditor}
          editorContainerClassName={cn(editorContainerClassNames, 'document-editor')}
          extendedEditorProps={extendedEditorProps}
          id={id}
          isLoading={isLoading}
          isTouchDevice={!!isTouchDevice}
          tabIndex={tabIndex}
          provider={provider}
          state={state}
        />
      </div>
    </>
  )
}

// Outer component that provides collaboration context
function CollaborativeDocumentEditor(props: ICollaborativeDocumentEditorProps) {
  const { id, realtimeConfig, serverHandler, user } = props

  const token = useMemo(() => JSON.stringify(user), [user])

  return (
    <CollaborationProvider
      docId={id}
      serverUrl={realtimeConfig.url}
      WebSocketPolyfill={realtimeConfig.WebSocketPolyfill}
      authToken={token}
      onStateChange={serverHandler?.onStateChange}
    >
      <CollaborativeDocumentEditorInner {...props} />
    </CollaborationProvider>
  )
}

const CollaborativeDocumentEditorWithRef = React.forwardRef(function CollaborativeDocumentEditorWithRef(
  props: ICollaborativeDocumentEditorProps,
  ref: React.ForwardedRef<EditorRefApi>
) {
  return (
    <CollaborativeDocumentEditor key={props.id} {...props} forwardedRef={ref as React.MutableRefObject<EditorRefApi>} />
  )
})

CollaborativeDocumentEditorWithRef.displayName = 'CollaborativeDocumentEditorWithRef'

export { CollaborativeDocumentEditorWithRef }
