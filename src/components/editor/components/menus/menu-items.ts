import { translateEditor } from '@/components/editor/i18n'
import type { Editor } from '@tiptap/react'
import {
  AlignCenterOutline,
  BoldOutline,
  CheckSquareOutline,
  CodeOutline,
  H1Outline,
  H2Outline,
  H3Outline,
  H4Outline,
  H5Outline,
  H6Outline,
  ImageOutline,
  ItalicOutline,
  LinkOutline,
  ListOutline,
  MinusSquareOutline,
  NumberedListOutline,
  PaletteOutline,
  QuoteOutline,
  StrikethroughOutline,
  TableOutline,
  TextOutline,
  UnderlineOutline
} from '@/components/editor/icons'
import type { ComponentType, SVGProps } from 'react'
// constants
import { CORE_EXTENSIONS } from '@/components/editor/constants/extension'
// helpers
import {
  insertHorizontalRule,
  insertImage,
  insertTableCommand,
  setLinkEditor,
  setText,
  setTextAlign,
  toggleBackgroundColor,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleCodeBlock,
  toggleHeading,
  toggleItalic,
  toggleOrderedList,
  toggleStrike,
  toggleTaskList,
  toggleTextColor,
  toggleUnderline,
  unsetLinkEditor
} from '@/components/editor/helpers/editor-commands'
// types
import type { TCommandWithProps, TEditorCommands } from '@/components/editor/types'
type isActiveFunction<T extends TEditorCommands> = (params?: TCommandWithProps<T>) => boolean
type commandFunction<T extends TEditorCommands> = (params?: TCommandWithProps<T>) => void

export type EditorMenuItem<T extends TEditorCommands> = {
  key: T
  name: string
  command: commandFunction<T>
  icon: ComponentType<SVGProps<SVGSVGElement>>
  isActive: isActiveFunction<T>
}

export const TextItem = (editor: Editor): EditorMenuItem<'text'> => ({
  key: 'text',
  name: translateEditor('blocks.text'),
  isActive: () => editor.isActive(CORE_EXTENSIONS.PARAGRAPH),
  command: () => setText(editor),
  icon: TextOutline
})

type SupportedHeadingLevels = Extract<TEditorCommands, 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'>

const HeadingItem = <T extends SupportedHeadingLevels>(
  editor: Editor,
  level: 1 | 2 | 3 | 4 | 5 | 6,
  key: T,
  name: string,
  icon: ComponentType<SVGProps<SVGSVGElement>>
): EditorMenuItem<T> => ({
  key,
  name,
  isActive: () => editor.isActive(CORE_EXTENSIONS.HEADING, { level }),
  command: () => toggleHeading(editor, level),
  icon
})

export const HeadingOneItem = (editor: Editor): EditorMenuItem<'h1'> =>
  HeadingItem(editor, 1, 'h1', translateEditor('blocks.heading1'), H1Outline)

export const HeadingTwoItem = (editor: Editor): EditorMenuItem<'h2'> =>
  HeadingItem(editor, 2, 'h2', translateEditor('blocks.heading2'), H2Outline)

export const HeadingThreeItem = (editor: Editor): EditorMenuItem<'h3'> =>
  HeadingItem(editor, 3, 'h3', translateEditor('blocks.heading3'), H3Outline)

export const HeadingFourItem = (editor: Editor): EditorMenuItem<'h4'> =>
  HeadingItem(editor, 4, 'h4', translateEditor('blocks.heading4'), H4Outline)

export const HeadingFiveItem = (editor: Editor): EditorMenuItem<'h5'> =>
  HeadingItem(editor, 5, 'h5', translateEditor('blocks.heading5'), H5Outline)

export const HeadingSixItem = (editor: Editor): EditorMenuItem<'h6'> =>
  HeadingItem(editor, 6, 'h6', translateEditor('blocks.heading6'), H6Outline)

export const BoldItem = (editor: Editor): EditorMenuItem<'bold'> => ({
  key: 'bold',
  name: translateEditor('marks.bold'),
  isActive: () => editor?.isActive(CORE_EXTENSIONS.BOLD),
  command: () => toggleBold(editor),
  icon: BoldOutline
})

export const ItalicItem = (editor: Editor): EditorMenuItem<'italic'> => ({
  key: 'italic',
  name: translateEditor('marks.italic'),
  isActive: () => editor?.isActive(CORE_EXTENSIONS.ITALIC),
  command: () => toggleItalic(editor),
  icon: ItalicOutline
})

export const UnderLineItem = (editor: Editor): EditorMenuItem<'underline'> => ({
  key: 'underline',
  name: translateEditor('marks.underline'),
  isActive: () => editor?.isActive(CORE_EXTENSIONS.UNDERLINE),
  command: () => toggleUnderline(editor),
  icon: UnderlineOutline
})

export const StrikeThroughItem = (editor: Editor): EditorMenuItem<'strikethrough'> => ({
  key: 'strikethrough',
  name: translateEditor('marks.strikethrough'),
  isActive: () => editor?.isActive(CORE_EXTENSIONS.STRIKETHROUGH),
  command: () => toggleStrike(editor),
  icon: StrikethroughOutline
})

export const BulletListItem = (editor: Editor): EditorMenuItem<'bulleted-list'> => ({
  key: 'bulleted-list',
  name: translateEditor('blocks.bulletedList'),
  isActive: () => editor?.isActive(CORE_EXTENSIONS.BULLET_LIST),
  command: () => toggleBulletList(editor),
  icon: ListOutline
})

export const NumberedListItem = (editor: Editor): EditorMenuItem<'numbered-list'> => ({
  key: 'numbered-list',
  name: translateEditor('blocks.numberedList'),
  isActive: () => editor?.isActive(CORE_EXTENSIONS.ORDERED_LIST),
  command: () => toggleOrderedList(editor),
  icon: NumberedListOutline
})

export const TodoListItem = (editor: Editor): EditorMenuItem<'to-do-list'> => ({
  key: 'to-do-list',
  name: translateEditor('blocks.todoList'),
  isActive: () => editor.isActive(CORE_EXTENSIONS.TASK_ITEM),
  command: () => toggleTaskList(editor),
  icon: CheckSquareOutline
})

export const QuoteItem = (editor: Editor): EditorMenuItem<'quote'> => ({
  key: 'quote',
  name: translateEditor('blocks.quote'),
  isActive: () => editor?.isActive(CORE_EXTENSIONS.BLOCKQUOTE),
  command: () => toggleBlockquote(editor),
  icon: QuoteOutline
})

export const CodeItem = (editor: Editor): EditorMenuItem<'code'> => ({
  key: 'code',
  name: translateEditor('blocks.code'),
  isActive: () => editor?.isActive(CORE_EXTENSIONS.CODE_INLINE) || editor?.isActive(CORE_EXTENSIONS.CODE_BLOCK),
  command: () => toggleCodeBlock(editor),
  icon: CodeOutline
})

export const TableItem = (editor: Editor): EditorMenuItem<'table'> => ({
  key: 'table',
  name: translateEditor('blocks.table'),
  isActive: () => editor?.isActive(CORE_EXTENSIONS.TABLE),
  command: () => insertTableCommand(editor),
  icon: TableOutline
})

export const ImageItem = (editor: Editor): EditorMenuItem<'image'> => ({
  key: 'image',
  name: translateEditor('blocks.image'),
  isActive: () => editor?.isActive(CORE_EXTENSIONS.IMAGE) || editor?.isActive(CORE_EXTENSIONS.CUSTOM_IMAGE),
  command: () => insertImage({ editor, event: 'insert', pos: editor.state.selection.from }),
  icon: ImageOutline
})

export const HorizontalRuleItem = (editor: Editor): EditorMenuItem<'divider'> =>
  ({
    key: 'divider',
    name: translateEditor('blocks.divider'),
    isActive: () => editor?.isActive(CORE_EXTENSIONS.HORIZONTAL_RULE),
    command: () => insertHorizontalRule(editor),
    icon: MinusSquareOutline
  }) as const

export const LinkItem = (editor: Editor): EditorMenuItem<'link'> =>
  ({
    key: 'link',
    name: translateEditor('marks.link'),
    isActive: () => editor?.isActive('link'),

    command: props => {
      if (!props) return
      if (props.url) setLinkEditor(editor, props.url, props.text)
      else unsetLinkEditor(editor)
    },

    icon: LinkOutline
  }) as const

export const TextColorItem = (editor: Editor): EditorMenuItem<'text-color'> => ({
  key: 'text-color',
  name: translateEditor('marks.color'),
  isActive: props => editor.isActive(CORE_EXTENSIONS.CUSTOM_COLOR, { color: props?.color }),
  command: props => {
    if (!props) return
    toggleTextColor(props.color, editor)
  },
  icon: PaletteOutline
})

export const BackgroundColorItem = (editor: Editor): EditorMenuItem<'background-color'> => ({
  key: 'background-color',
  name: translateEditor('marks.backgroundColor'),
  isActive: props => editor.isActive(CORE_EXTENSIONS.CUSTOM_COLOR, { backgroundColor: props?.color }),
  command: props => {
    if (!props) return
    toggleBackgroundColor(props.color, editor)
  },
  icon: PaletteOutline
})

export const TextAlignItem = (editor: Editor): EditorMenuItem<'text-align'> => ({
  key: 'text-align',
  name: translateEditor('marks.textAlign'),
  isActive: props => editor.isActive({ textAlign: props?.alignment }),
  command: props => {
    if (!props) return
    setTextAlign(props.alignment, editor)
  },
  icon: AlignCenterOutline
})

export const getEditorMenuItems = (editor: Editor | null): EditorMenuItem<TEditorCommands>[] => {
  if (!editor) return []

  return [
    TextItem(editor),
    HeadingOneItem(editor),
    HeadingTwoItem(editor),
    HeadingThreeItem(editor),
    HeadingFourItem(editor),
    HeadingFiveItem(editor),
    HeadingSixItem(editor),
    BoldItem(editor),
    ItalicItem(editor),
    UnderLineItem(editor),
    StrikeThroughItem(editor),
    BulletListItem(editor),
    TodoListItem(editor),
    CodeItem(editor),
    NumberedListItem(editor),
    QuoteItem(editor),
    TableItem(editor),
    ImageItem(editor),
    HorizontalRuleItem(editor),
    LinkItem(editor),
    TextColorItem(editor),
    BackgroundColorItem(editor),
    TextAlignItem(editor)
  ] as EditorMenuItem<TEditorCommands>[]
}
