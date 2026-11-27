import { useEditorTranslations } from '@/components/editor/i18n'
import { DownloadOutline } from '@/components/editor/icons'
// plane imports
import { Icon } from '@/components/editor/propel/components/icon'
import { ToolbarButton } from '@/components/editor/propel/elements/toolbar'
import { Tooltip } from '@/components/editor/propel/components/tooltip'

type Props = {
  src: string
}

export function ImageDownloadAction(props: Props) {
  const { src } = props
  const t = useEditorTranslations()

  return (
    <Tooltip label={t('image.download')}>
      <ToolbarButton
        type='button'
        size='sm'
        labeled={false}
        onClick={() => window.open(src, '_blank')}
        aria-label={t('image.downloadImage')}
      >
        <Icon icon={DownloadOutline} />
      </ToolbarButton>
    </Tooltip>
  )
}
