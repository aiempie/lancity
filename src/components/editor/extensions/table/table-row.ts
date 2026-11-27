import { mergeAttributes, Node } from '@tiptap/core'
// constants
import { CORE_EXTENSIONS } from '@/components/editor/constants/extension'
// helpers
import { isValidCssColor } from '@/components/editor/helpers/common'

type TableRowOptions = {
  HTMLAttributes: Record<string, unknown>
}

export const TableRow = Node.create<TableRowOptions>({
  name: CORE_EXTENSIONS.TABLE_ROW,

  addOptions() {
    return {
      HTMLAttributes: {}
    }
  },

  addAttributes() {
    return {
      background: {
        default: null
      },
      textColor: {
        default: null
      }
    }
  },

  content: '(tableCell | tableHeader)*',

  tableRole: 'row',

  parseHTML() {
    return [{ tag: 'tr' }]
  },

  renderHTML({ HTMLAttributes }) {
    const { background, textColor } = HTMLAttributes
    let style = ''
    if (isValidCssColor(background)) {
      style = `background-color: ${background}`
      if (isValidCssColor(textColor)) style += `; color: ${textColor}`
    }

    const attributes = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { style })

    return ['tr', attributes, 0]
  }
})
