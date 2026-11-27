import { translateEditor } from '@/components/editor/i18n'
import { useEditorTranslations } from '@/components/editor/i18n'
import type { Editor } from '@tiptap/core'
import { TableMap } from '@tiptap/pm/tables'
import {
  ArrowNarrowLeftOutline,
  ArrowNarrowRightOutline,
  CloseOutline,
  CopyOutline,
  DeleteOutline,
  ToggleFilled
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
import { findTable, getSelectedColumns } from '@/components/editor/extensions/table/table/utilities/helpers'
// local imports
import { duplicateColumns } from '../actions'
import { TableDragHandleDropdownColorSelector } from '../color-selector'

const DROPDOWN_ITEMS: {
  key: string
  label: string
  icon: React.FC<React.SVGProps<SVGSVGElement>> | React.FC<ISvgIcons>
  action: (editor: Editor) => void
}[] = [
  {
    key: 'insert-left',
    get label() {
      return translateEditor('table.insertLeft')
    },
    icon: ArrowNarrowLeftOutline,
    action: editor => editor.chain().focus().addColumnBefore().run()
  },
  {
    key: 'insert-right',
    get label() {
      return translateEditor('table.insertRight')
    },
    icon: ArrowNarrowRightOutline,
    action: editor => editor.chain().focus().addColumnAfter().run()
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
      const selectedColumns = getSelectedColumns(editor.state.selection, tableMap)
      tr = duplicateColumns(table, selectedColumns, tr)
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
    action: editor => editor.chain().focus().deleteColumn().run()
  }
]

type Props = {
  editor: Editor
  onClose: () => void
}

export function ColumnOptionsDropdown(props: Props) {
  const { editor, onClose } = props
  const t = useEditorTranslations()

  return (
    <>
      <FloatingMenuItem
        type='button'
        onClick={e => {
          e.preventDefault()
          e.stopPropagation()
          editor.chain().focus().toggleHeaderColumn().run()
          onClose()
        }}
      >
        <MenuItemContent>
          <MenuItemTitle>{t('table.headerColumn')}</MenuItemTitle>
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
