import { useEditorTranslations } from '@/components/editor/i18n'
import type { Editor } from '@tiptap/core'
import { useState } from 'react'
// plane imports
import { Toolbar } from '@/components/editor/propel/elements/toolbar'
import { cn } from '@/lib/utils'
// local imports
import type { TCustomImageAlignment } from '../../types'
import { ImageAlignmentAction } from './alignment'
import { ImageDownloadAction } from './download'
import { ImageFullScreenActionRoot } from './full-screen'

type Props = {
  alignment: TCustomImageAlignment
  editor: Editor
  aspectRatio: number
  downloadSrc: string
  handleAlignmentChange: (alignment: TCustomImageAlignment) => void
  height: string
  isTouchDevice: boolean
  src: string
  width: string
}

export function ImageToolbarRoot(props: Props) {
  const { alignment, editor, downloadSrc, handleAlignmentChange, isTouchDevice } = props
  const t = useEditorTranslations()
  // states
  const [shouldShowToolbar, setShouldShowToolbar] = useState(false)
  // derived values
  const isEditable = editor.isEditable

  return (
    <>
      <div
        className={cn(
          'pointer-events-none absolute top-1 right-1 z-20 opacity-0 transition-opacity group-hover/image-component:pointer-events-auto group-hover/image-component:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
          {
            'pointer-events-auto opacity-100': shouldShowToolbar
          }
        )}
      >
        <Toolbar size='sm' elevation='raised' role='group' aria-label={t('image.controls')}>
          {!isTouchDevice && <ImageDownloadAction src={downloadSrc} />}
          {isEditable && (
            <ImageAlignmentAction
              activeAlignment={alignment}
              handleChange={handleAlignmentChange}
              isTouchDevice={isTouchDevice}
              toggleToolbarViewStatus={setShouldShowToolbar}
            />
          )}
          <ImageFullScreenActionRoot
            image={props}
            isTouchDevice={isTouchDevice}
            toggleToolbarViewStatus={setShouldShowToolbar}
          />
        </Toolbar>
      </div>
    </>
  )
}
