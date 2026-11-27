import { useEditorTranslations } from '@/components/editor/i18n'
import { FullScreenOutline } from '@/components/editor/icons'
import { useEffect, useRef, useState } from 'react'
// plane imports
import { Icon } from '@/components/editor/propel/components/icon'
import { ToolbarButton } from '@/components/editor/propel/elements/toolbar'
import { Tooltip } from '@/components/editor/propel/components/tooltip'
// local imports
import { ImageFullScreenModal } from './modal'

type Props = {
  image: {
    aspectRatio: number
    downloadSrc: string
    height: string
    src: string
    width: string
  }
  isTouchDevice: boolean
  toggleToolbarViewStatus: (val: boolean) => void
}

export function ImageFullScreenActionRoot(props: Props) {
  const t = useEditorTranslations()
  const { image, isTouchDevice, toggleToolbarViewStatus } = props
  const openerRef = useRef<HTMLButtonElement>(null)
  // states
  const [isFullScreenEnabled, setIsFullScreenEnabled] = useState(false)
  // derived values
  const { downloadSrc, src, width, aspectRatio } = image

  useEffect(() => {
    toggleToolbarViewStatus(isFullScreenEnabled)
  }, [isFullScreenEnabled, toggleToolbarViewStatus])

  return (
    <>
      <ImageFullScreenModal
        openerRef={openerRef}
        aspectRatio={aspectRatio}
        downloadSrc={downloadSrc}
        isFullScreenEnabled={isFullScreenEnabled}
        isTouchDevice={isTouchDevice}
        src={src}
        width={width}
        toggleFullScreenMode={setIsFullScreenEnabled}
      />
      <Tooltip label={t('image.viewFullScreen')} disabled={isTouchDevice}>
        <ToolbarButton
          ref={openerRef}
          type='button'
          size='sm'
          labeled={false}
          onClick={e => {
            e.preventDefault()
            e.stopPropagation()
            setIsFullScreenEnabled(true)
          }}
          aria-label={t('image.viewImageFullScreen')}
        >
          <Icon icon={FullScreenOutline} />
        </ToolbarButton>
      </Tooltip>
    </>
  )
}
