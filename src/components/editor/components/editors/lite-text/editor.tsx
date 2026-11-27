import { forwardRef, useMemo } from 'react'
// components
import { EditorWrapper } from '@/components/editor/components/editors/editor-wrapper'
// extensions
import { EnterKeyExtension } from '@/components/editor/extensions'
// types
import type { EditorRefApi, ILiteTextEditorProps } from '@/components/editor/types'

function LiteTextEditor(props: ILiteTextEditorProps) {
  const { onEnterKeyPress, disabledExtensions, extensions: externalExtensions = [] } = props

  const extensions = useMemo(() => {
    const resolvedExtensions = [...externalExtensions]

    if (!disabledExtensions?.includes('enter-key')) {
      resolvedExtensions.push(EnterKeyExtension(onEnterKeyPress))
    }

    return resolvedExtensions
  }, [externalExtensions, disabledExtensions, onEnterKeyPress])

  return <EditorWrapper {...props} extensions={extensions} />
}

const LiteTextEditorWithRef = forwardRef(function LiteTextEditorWithRef(
  props: ILiteTextEditorProps,
  ref: React.ForwardedRef<EditorRefApi>
) {
  return <LiteTextEditor {...props} forwardedRef={ref as React.MutableRefObject<EditorRefApi | null>} />
})

LiteTextEditorWithRef.displayName = 'LiteTextEditorWithRef'

export { LiteTextEditorWithRef }
