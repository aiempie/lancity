import { useEditorTranslations } from '@/components/editor/i18n'
import type { Editor } from '@tiptap/core'
// plane imports
import { Collapsible } from '@/components/editor/propel/components/collapsible'
import { Icon } from '@/components/editor/propel/components/icon'
import { IconButton } from '@/components/editor/propel/elements/icon-button'
import { MenuLabel, MenuLabelTitle } from '@/components/editor/propel/elements/menu'
import { DeactivatedOutline, PaletteOutline } from '@/components/editor/icons'
// constants
import { COLORS_LIST } from '@/components/editor/constants/common'
import { CORE_EXTENSIONS } from '@/components/editor/constants/extension'

// TODO: implement text color selector

type Props = {
  editor: Editor
  onSelect: (color: string | null) => void
}

const handleBackgroundColorChange = (editor: Editor, color: string | null) => {
  editor
    .chain()
    .focus()
    .updateAttributes(CORE_EXTENSIONS.TABLE_CELL, {
      background: color
    })
    .run()
}

// const handleTextColorChange = (editor: Editor, color: string | null) => {
//   editor
//     .chain()
//     .focus()
//     .updateAttributes(CORE_EXTENSIONS.TABLE_CELL, {
//       textColor: color,
//     })
//     .run();
// };

export function TableDragHandleDropdownColorSelector(props: Props) {
  const { editor, onSelect } = props
  const t = useEditorTranslations()

  return (
    <Collapsible defaultOpen hug icon={<Icon icon={PaletteOutline} />} trigger={t('colors.color')}>
      <div className='pb-2'>
        {/* <div className="space-y-1.5">
          <p className="text-11 text-tertiary font-semibold">Text colors</p>
          <div className="flex items-center flex-wrap gap-2">
            {COLORS_LIST.map((color) => (
              <button
                key={color.key}
                type="button"
                className="flex-shrink-0 size-6 rounded-sm border-[0.5px] border-strong-1 hover:opacity-60 transition-opacity"
                style={{
                  backgroundColor: color.textColor,
                }}
                onClick={() => handleTextColorChange(editor, color.textColor)}
              />
            ))}
            <button
              type="button"
              className="flex-shrink-0 size-6 grid place-items-center rounded-sm text-tertiary border-[0.5px] border-strong-1 hover:bg-layer-1 transition-colors"
              onClick={() => handleTextColorChange(editor, null)}
            >
              <Ban className="size-4" />
            </button>
          </div>
        </div> */}
        <div role='group' aria-label={t('colors.backgroundColors')}>
          <MenuLabel>
            <MenuLabelTitle>{t('colors.backgroundColors')}</MenuLabelTitle>
          </MenuLabel>
          <div className='flex flex-wrap items-center gap-2 px-2 pt-1'>
            {COLORS_LIST.map(color => (
              <button
                key={color.key}
                type='button'
                aria-label={t('colors.backgroundColorOf', { color: color.label })}
                className='size-6 shrink-0 cursor-pointer rounded-sm border-xs border-subtle transition-opacity outline-none hover:opacity-60 focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:ring-offset-1'
                style={{
                  backgroundColor: color.backgroundColor
                }}
                onClick={() => {
                  handleBackgroundColorChange(editor, color.backgroundColor)
                  onSelect(color.backgroundColor)
                }}
              />
            ))}
            <IconButton
              type='button'
              variant='secondary'
              size='sm'
              aria-label={t('colors.clearBackgroundColor')}
              onClick={() => {
                handleBackgroundColorChange(editor, null)
                onSelect(null)
              }}
            >
              <Icon icon={DeactivatedOutline} />
            </IconButton>
          </div>
        </div>
      </div>
    </Collapsible>
  )
}
