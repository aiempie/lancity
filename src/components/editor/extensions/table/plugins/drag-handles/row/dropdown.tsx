import { translateEditor } from '@/components/editor/i18n'
import { useEditorTranslations } from '@/components/editor/i18n'
import type { Editor } from '@tiptap/core'
import { TableMap } from '@tiptap/pm/tables'
import {
  ArrowDownOutline,
  CloseOutline,
  CopyOutline,
  DeleteOutline,
  ToggleFilled,
  TopArrowOutline
} from '@/components/editor/icons'
import { Icon } from '@/components/editor/propel/components/icon'
import {
  MenuItemContent,
  MenuItemTitle,
  MenuItemTrailing,
  MenuSeparator
} from '@/components/editor/propel/elements/menu'
// extensions
import type { ISvgIcons } from '@/components/editor/icons'
import { FloatingMenuItem } from '@/components/editor/components/menus/floating-menu/root'
import { findTable, getSelectedRows } from '@/components/editor/extensions/table/table/utilities/helpers'
// local imports
import { duplicateRows } from '../actions'
import { TableDragHandleDropdownColorSelector } from '../color-selector'

const DROPDOWN_ITEMS: {
  key: string
  label: string
  icon: React.FC<React.SVGProps<SVGSVGElement>> | React.FC<ISvgIcons>
  action: (editor: Editor) => void
}[] = [
  {
    key: 'insert-above',
    get label() {
      return translateEditor('table.insertAbove')
    },
    icon: TopArrowOutline,
    action: editor => editor.chain().focus().addRowBefore().run()
  },
  {
    key: 'insert-below',
    get label() {
      return translateEditor('table.insertBelow')
    },
    icon: ArrowDownOutline,
    action: editor => editor.chain().focus().addRowAfter().run()
  },
  {
    key: 'duplicate',
    get label() {
      return translateEditor('table.duplicate')
    },
    icon: CopyOutline,
    action: editor => {
      const table = findTable(editor.state.selection)
      if (!table) return

      const tableMap = TableMap.get(table.node)
      let tr = editor.state.tr
      const selectedRows = getSelectedRows(editor.state.selection, tableMap)
      tr = duplicateRows(table, selectedRows, tr)
      editor.view.dispatch(tr)
    }
  },
  {
    key: 'clear-contents',
    get label() {
      return translateEditor('table.clearContents')
    },
    icon: CloseOutline,
    action: editor => editor.chain().focus().clearSelectedCells().run()
  },
  {
    key: 'delete',
    get label() {
      return translateEditor('table.delete')
    },
    icon: DeleteOutline,
    action: editor => editor.chain().focus().deleteRow().run()
  }
]

type Props = {
  editor: Editor
  onClose: () => void
}

export function RowOptionsDropdown(props: Props) {
  const { editor, onClose } = props
  const t = useEditorTranslations()

  return (
    <>
      <FloatingMenuItem
        type='button'
        onClick={e => {
          e.preventDefault()
          e.stopPropagation()
          editor.chain().focus().toggleHeaderRow().run()
          onClose()
        }}
      >
        <MenuItemContent>
          <MenuItemTitle>{t('table.headerRow')}</MenuItemTitle>
        </MenuItemContent>
        <MenuItemTrailing>
          <Icon icon={ToggleFilled} tint='secondary' />
        </MenuItemTrailing>
      </FloatingMenuItem>
      <MenuSeparator render={<hr />} />
      <TableDragHandleDropdownColorSelector editor={editor} onSelect={onClose} />
      {DROPDOWN_ITEMS.map(item => (
        <FloatingMenuItem
          key={item.key}
          type='button'
          variant={item.key === 'delete' ? 'danger' : 'neutral'}
          onClick={e => {
            e.preventDefault()
            e.stopPropagation()
            item.action(editor)
            onClose()
          }}
        >
          <Icon icon={item.icon} />
          <MenuItemContent>
            <MenuItemTitle>{item.label}</MenuItemTitle>
          </MenuItemContent>
        </FloatingMenuItem>
      ))}
    </>
  )
}
