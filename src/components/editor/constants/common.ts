import { translateEditor } from '@/components/editor/i18n'
import type { ComponentType, SVGProps } from 'react'
import {
  AlignCenterOutline,
  AlignLeftOutline,
  AlignRightOutline,
  BoldOutline,
  CodeOutline,
  H1Outline,
  H2Outline,
  H3Outline,
  H4Outline,
  H5Outline,
  H6Outline,
  ImageOutline,
  ItalicOutline,
  ListOutline,
  NumberedListOutline,
  QuoteOutline,
  StrikethroughOutline,
  TableEditorOutline,
  TextOutline,
  ToDoOutline,
  UnderlineOutline
} from '@/components/editor/icons'
import { MonospaceIcon, SansSerifIcon, SerifIcon } from '@/components/editor/icons'
import type { TCommandExtraProps, TEditorCommands, TEditorFontStyle } from '@/components/editor/types'

export type TEditorTypes = 'lite' | 'document' | 'sticky'

// Utility type to enforce the necessary extra props or make extraProps optional
export type ExtraPropsForCommand<T extends TEditorCommands> = T extends keyof TCommandExtraProps
  ? TCommandExtraProps[T]
  : object // Default to empty object for commands without extra props

export type ToolbarMenuItem<T extends TEditorCommands = TEditorCommands> = {
  itemKey: T
  renderKey: string
  name: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  shortcut?: string[]
  editors: TEditorTypes[]
  extraProps?: ExtraPropsForCommand<T>
}

export const TYPOGRAPHY_ITEMS: ToolbarMenuItem<'text' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'>[] = [
  {
    itemKey: 'text',
    renderKey: 'text',
    get name() {
      return translateEditor('blocks.text')
    },
    icon: TextOutline,
    editors: ['document']
  },
  {
    itemKey: 'h1',
    renderKey: 'h1',
    get name() {
      return translateEditor('blocks.heading1')
    },
    icon: H1Outline,
    editors: ['document']
  },
  {
    itemKey: 'h2',
    renderKey: 'h2',
    get name() {
      return translateEditor('blocks.heading2')
    },
    icon: H2Outline,
    editors: ['document']
  },
  {
    itemKey: 'h3',
    renderKey: 'h3',
    get name() {
      return translateEditor('blocks.heading3')
    },
    icon: H3Outline,
    editors: ['document']
  },
  {
    itemKey: 'h4',
    renderKey: 'h4',
    get name() {
      return translateEditor('blocks.heading4')
    },
    icon: H4Outline,
    editors: ['document']
  },
  {
    itemKey: 'h5',
    renderKey: 'h5',
    get name() {
      return translateEditor('blocks.heading5')
    },
    icon: H5Outline,
    editors: ['document']
  },
  {
    itemKey: 'h6',
    renderKey: 'h6',
    get name() {
      return translateEditor('blocks.heading6')
    },
    icon: H6Outline,
    editors: ['document']
  }
]

export const TEXT_ALIGNMENT_ITEMS: ToolbarMenuItem<'text-align'>[] = [
  {
    itemKey: 'text-align',
    renderKey: 'text-align-left',
    get name() {
      return translateEditor('alignment.left')
    },
    icon: AlignLeftOutline,
    shortcut: ['Cmd', 'Shift', 'L'],
    editors: ['lite', 'document'],
    extraProps: {
      alignment: 'left'
    }
  },
  {
    itemKey: 'text-align',
    renderKey: 'text-align-center',
    get name() {
      return translateEditor('alignment.center')
    },
    icon: AlignCenterOutline,
    shortcut: ['Cmd', 'Shift', 'E'],
    editors: ['lite', 'document'],
    extraProps: {
      alignment: 'center'
    }
  },
  {
    itemKey: 'text-align',
    renderKey: 'text-align-right',
    get name() {
      return translateEditor('alignment.right')
    },
    icon: AlignRightOutline,
    shortcut: ['Cmd', 'Shift', 'R'],
    editors: ['lite', 'document'],
    extraProps: {
      alignment: 'right'
    }
  }
]

const BASIC_MARK_ITEMS: ToolbarMenuItem<'bold' | 'italic' | 'underline' | 'strikethrough'>[] = [
  {
    itemKey: 'bold',
    renderKey: 'bold',
    get name() {
      return translateEditor('marks.bold')
    },
    icon: BoldOutline,
    shortcut: ['Cmd', 'B'],
    editors: ['lite', 'document']
  },
  {
    itemKey: 'italic',
    renderKey: 'italic',
    get name() {
      return translateEditor('marks.italic')
    },
    icon: ItalicOutline,
    shortcut: ['Cmd', 'I'],
    editors: ['lite', 'document']
  },
  {
    itemKey: 'underline',
    renderKey: 'underline',
    get name() {
      return translateEditor('marks.underline')
    },
    icon: UnderlineOutline,
    shortcut: ['Cmd', 'U'],
    editors: ['lite', 'document']
  },
  {
    itemKey: 'strikethrough',
    renderKey: 'strikethrough',
    get name() {
      return translateEditor('marks.strikethrough')
    },
    icon: StrikethroughOutline,
    shortcut: ['Cmd', 'Shift', 'S'],
    editors: ['lite', 'document']
  }
]

const LIST_ITEMS: ToolbarMenuItem<'bulleted-list' | 'numbered-list' | 'to-do-list'>[] = [
  {
    itemKey: 'bulleted-list',
    renderKey: 'bulleted-list',
    get name() {
      return translateEditor('blocks.bulletedList')
    },
    icon: ListOutline,
    shortcut: ['Cmd', 'Shift', '7'],
    editors: ['lite', 'document']
  },
  {
    itemKey: 'numbered-list',
    renderKey: 'numbered-list',
    get name() {
      return translateEditor('blocks.numberedList')
    },
    icon: NumberedListOutline,
    shortcut: ['Cmd', 'Shift', '8'],
    editors: ['lite', 'document']
  },
  {
    itemKey: 'to-do-list',
    renderKey: 'to-do-list',
    get name() {
      return translateEditor('blocks.todoList')
    },
    icon: ToDoOutline,
    shortcut: ['Cmd', 'Shift', '9'],
    editors: ['lite', 'document']
  }
]

export const USER_ACTION_ITEMS: ToolbarMenuItem<'quote' | 'code'>[] = [
  {
    itemKey: 'quote',
    renderKey: 'quote',
    get name() {
      return translateEditor('blocks.quote')
    },
    icon: QuoteOutline,
    editors: ['lite', 'document']
  },
  {
    itemKey: 'code',
    renderKey: 'code',
    get name() {
      return translateEditor('blocks.code')
    },
    icon: CodeOutline,
    editors: ['lite', 'document']
  }
]

export const COMPLEX_ITEMS: ToolbarMenuItem<'table' | 'image'>[] = [
  {
    itemKey: 'table',
    renderKey: 'table',
    get name() {
      return translateEditor('blocks.table')
    },
    icon: TableEditorOutline,
    editors: ['document']
  },
  {
    itemKey: 'image',
    renderKey: 'image',
    get name() {
      return translateEditor('blocks.image')
    },
    icon: ImageOutline,
    editors: ['lite', 'document']
  }
]

export const IMAGE_ITEM = COMPLEX_ITEMS.find((item): item is ToolbarMenuItem<'image'> => item.itemKey === 'image')!

export const TOOLBAR_ITEMS: {
  [editorType in TEditorTypes]: {
    [key: string]: ToolbarMenuItem[]
  }
} = {
  lite: {
    basic: BASIC_MARK_ITEMS.filter(item => item.editors.includes('lite')),
    alignment: TEXT_ALIGNMENT_ITEMS.filter(item => item.editors.includes('lite')),
    list: LIST_ITEMS.filter(item => item.editors.includes('lite')),
    userAction: USER_ACTION_ITEMS.filter(item => item.editors.includes('lite')),
    complex: COMPLEX_ITEMS.filter(item => item.editors.includes('lite'))
  },
  document: {
    basic: BASIC_MARK_ITEMS.filter(item => item.editors.includes('document')),
    alignment: TEXT_ALIGNMENT_ITEMS.filter(item => item.editors.includes('document')),
    list: LIST_ITEMS.filter(item => item.editors.includes('document')),
    userAction: USER_ACTION_ITEMS.filter(item => item.editors.includes('document')),
    complex: COMPLEX_ITEMS.filter(item => item.editors.includes('document'))
  },
  sticky: {
    basic: BASIC_MARK_ITEMS.filter(item => ['bold', 'italic'].includes(item.itemKey)),
    list: LIST_ITEMS.filter(item => ['to-do-list'].includes(item.itemKey))
  }
}

export const COLORS_LIST: {
  key: string
  label: string
  textColor: string
  backgroundColor: string
}[] = [
  {
    key: 'gray',
    get label() {
      return translateEditor('colors.gray')
    },
    textColor: 'var(--editor-colors-gray-text)',
    backgroundColor: 'var(--editor-colors-gray-background)'
  },
  {
    key: 'peach',
    get label() {
      return translateEditor('colors.peach')
    },
    textColor: 'var(--editor-colors-peach-text)',
    backgroundColor: 'var(--editor-colors-peach-background)'
  },
  {
    key: 'pink',
    get label() {
      return translateEditor('colors.pink')
    },
    textColor: 'var(--editor-colors-pink-text)',
    backgroundColor: 'var(--editor-colors-pink-background)'
  },
  {
    key: 'orange',
    get label() {
      return translateEditor('colors.orange')
    },
    textColor: 'var(--editor-colors-orange-text)',
    backgroundColor: 'var(--editor-colors-orange-background)'
  },
  {
    key: 'green',
    get label() {
      return translateEditor('colors.green')
    },
    textColor: 'var(--editor-colors-green-text)',
    backgroundColor: 'var(--editor-colors-green-background)'
  },
  {
    key: 'light-blue',
    get label() {
      return translateEditor('colors.lightBlue')
    },
    textColor: 'var(--editor-colors-light-blue-text)',
    backgroundColor: 'var(--editor-colors-light-blue-background)'
  },
  {
    key: 'dark-blue',
    get label() {
      return translateEditor('colors.darkBlue')
    },
    textColor: 'var(--editor-colors-dark-blue-text)',
    backgroundColor: 'var(--editor-colors-dark-blue-background)'
  },
  {
    key: 'purple',
    get label() {
      return translateEditor('colors.purple')
    },
    textColor: 'var(--editor-colors-purple-text)',
    backgroundColor: 'var(--editor-colors-purple-background)'
  }
  // {
  //   key: "pink-blue-gradient",
  //   label: "Pink blue gradient",
  //   textColor: "var(--editor-colors-pink-blue-gradient-text)",
  //   backgroundColor: "var(--editor-colors-pink-blue-gradient-background)",
  // },
]

export const EDITOR_FONT_STYLES: {
  key: TEditorFontStyle
  label: string
  icon: React.FC
}[] = [
  {
    key: 'sans-serif',
    get label() {
      return translateEditor('fonts.sansSerif')
    },
    icon: SansSerifIcon
  },
  {
    key: 'serif',
    get label() {
      return translateEditor('fonts.serif')
    },
    icon: SerifIcon
  },
  {
    key: 'monospace',
    get label() {
      return translateEditor('fonts.mono')
    },
    icon: MonospaceIcon
  }
]
