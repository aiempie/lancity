import { translateEditor } from '@/components/editor/i18n'
import {
  ChatOutline,
  CodeOutline,
  H1Outline,
  H2Outline,
  H3Outline,
  H4Outline,
  H5Outline,
  H6Outline,
  ImageOutline,
  ListOutline,
  MinusSquareOutline,
  NumberedListOutline,
  QuoteOutline,
  ReactionOutline,
  TableEditorOutline,
  TextOutline,
  ToDoOutline
} from '@/components/editor/icons'
// constants
import { COLORS_LIST } from '@/components/editor/constants/common'
// helpers
import {
  insertTableCommand,
  toggleBlockquote,
  toggleBulletList,
  toggleOrderedList,
  toggleTaskList,
  toggleHeading,
  toggleTextColor,
  toggleBackgroundColor,
  insertImage,
  insertCallout,
  setText,
  openEmojiPicker
} from '@/components/editor/helpers/editor-commands'
// plane editor extensions
import { coreEditorAdditionalSlashCommandOptions } from '@/components/editor/extensions/additional-slash-command-options'
// types
import type { CommandProps, ISlashCommandItem, TSlashCommandSectionKeys } from '@/components/editor/types'
// local types
import type { TExtensionProps, TSlashCommandAdditionalOption } from './root'

export type TSlashCommandSection = {
  key: TSlashCommandSectionKeys
  title?: string
  items: ISlashCommandItem[]
}

export const getSlashCommandFilteredSections =
  (args: TExtensionProps) =>
  ({ query }: { query: string }): TSlashCommandSection[] => {
    const { additionalOptions: externalAdditionalOptions, disabledExtensions, flaggedExtensions } = args
    const SLASH_COMMAND_SECTIONS: TSlashCommandSection[] = [
      {
        key: 'general',
        items: [
          {
            commandKey: 'text',
            key: 'text',
            title: translateEditor('slashCommands.text.title'),
            description: translateEditor('slashCommands.text.description'),
            searchTerms: ['p', 'paragraph'],
            icon: <TextOutline className='size-3.5' />,
            command: ({ editor, range }) => setText(editor, range)
          },
          {
            commandKey: 'h1',
            key: 'h1',
            title: translateEditor('slashCommands.h1.title'),
            description: translateEditor('slashCommands.h1.description'),
            searchTerms: ['title', 'big', 'large'],
            icon: <H1Outline className='size-3.5' />,
            command: ({ editor, range }) => toggleHeading(editor, 1, range)
          },
          {
            commandKey: 'h2',
            key: 'h2',
            title: translateEditor('slashCommands.h2.title'),
            description: translateEditor('slashCommands.h2.description'),
            searchTerms: ['subtitle', 'medium'],
            icon: <H2Outline className='size-3.5' />,
            command: ({ editor, range }) => toggleHeading(editor, 2, range)
          },
          {
            commandKey: 'h3',
            key: 'h3',
            title: translateEditor('slashCommands.h3.title'),
            description: translateEditor('slashCommands.h3.description'),
            searchTerms: ['subtitle', 'small'],
            icon: <H3Outline className='size-3.5' />,
            command: ({ editor, range }) => toggleHeading(editor, 3, range)
          },
          {
            commandKey: 'h4',
            key: 'h4',
            title: translateEditor('slashCommands.h4.title'),
            description: translateEditor('slashCommands.h4.description'),
            searchTerms: ['subtitle', 'small'],
            icon: <H4Outline className='size-3.5' />,
            command: ({ editor, range }) => toggleHeading(editor, 4, range)
          },
          {
            commandKey: 'h5',
            key: 'h5',
            title: translateEditor('slashCommands.h5.title'),
            description: translateEditor('slashCommands.h5.description'),
            searchTerms: ['subtitle', 'small'],
            icon: <H5Outline className='size-3.5' />,
            command: ({ editor, range }) => toggleHeading(editor, 5, range)
          },
          {
            commandKey: 'h6',
            key: 'h6',
            title: translateEditor('slashCommands.h6.title'),
            description: translateEditor('slashCommands.h6.description'),
            searchTerms: ['subtitle', 'small'],
            icon: <H6Outline className='size-3.5' />,
            command: ({ editor, range }) => toggleHeading(editor, 6, range)
          },

          {
            commandKey: 'numbered-list',
            key: 'numbered-list',
            title: translateEditor('slashCommands.numberedList.title'),
            description: translateEditor('slashCommands.numberedList.description'),
            searchTerms: ['ordered'],
            icon: <NumberedListOutline className='size-3.5' />,
            command: ({ editor, range }) => toggleOrderedList(editor, range)
          },
          {
            commandKey: 'bulleted-list',
            key: 'bulleted-list',
            title: translateEditor('slashCommands.bulletedList.title'),
            description: translateEditor('slashCommands.bulletedList.description'),
            searchTerms: ['unordered', 'point'],
            icon: <ListOutline className='size-3.5' />,
            command: ({ editor, range }) => toggleBulletList(editor, range)
          },
          {
            commandKey: 'to-do-list',
            key: 'to-do-list',
            title: translateEditor('slashCommands.todoList.title'),
            description: translateEditor('slashCommands.todoList.description'),
            searchTerms: ['todo', 'task', 'list', 'check', 'checkbox'],
            icon: <ToDoOutline className='size-3.5' />,
            command: ({ editor, range }) => toggleTaskList(editor, range)
          },
          {
            commandKey: 'table',
            key: 'table',
            title: translateEditor('slashCommands.table.title'),
            description: translateEditor('slashCommands.table.description'),
            searchTerms: ['table', 'cell', 'db', 'data', 'tabular'],
            icon: <TableEditorOutline className='size-3.5' />,
            command: ({ editor, range }) => insertTableCommand(editor, range)
          },
          {
            commandKey: 'quote',
            key: 'quote',
            title: translateEditor('slashCommands.quote.title'),
            description: translateEditor('slashCommands.quote.description'),
            searchTerms: ['blockquote'],
            icon: <QuoteOutline className='size-3.5' />,
            command: ({ editor, range }) => toggleBlockquote(editor, range)
          },
          {
            commandKey: 'code',
            key: 'code',
            title: translateEditor('slashCommands.code.title'),
            description: translateEditor('slashCommands.code.description'),
            searchTerms: ['codeblock'],
            icon: <CodeOutline className='size-3.5' />,
            command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
          },
          {
            commandKey: 'callout',
            key: 'callout',
            title: translateEditor('slashCommands.callout.title'),
            icon: <ChatOutline className='size-3.5' />,
            description: translateEditor('slashCommands.callout.description'),
            searchTerms: ['callout', 'comment', 'message', 'info', 'alert'],
            command: ({ editor, range }: CommandProps) => insertCallout(editor, range)
          },
          {
            commandKey: 'divider',
            key: 'divider',
            title: translateEditor('slashCommands.divider.title'),
            description: translateEditor('slashCommands.divider.description'),
            searchTerms: ['line', 'divider', 'horizontal', 'rule', 'separate'],
            icon: <MinusSquareOutline className='size-3.5' />,
            command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run()
          },
          {
            commandKey: 'emoji',
            key: 'emoji',
            title: translateEditor('slashCommands.emoji.title'),
            description: translateEditor('slashCommands.emoji.description'),
            searchTerms: ['emoji', 'icons', 'reaction', 'emoticon', 'emotags'],
            icon: <ReactionOutline className='size-3.5' />,
            command: ({ editor, range }) => {
              openEmojiPicker(editor, range)
            }
          }
        ]
      },
      {
        key: 'text-colors',
        title: translateEditor('slashCommands.sections.colors'),
        items: [
          {
            commandKey: 'text-color',
            key: 'text-color-default',
            title: translateEditor('slashCommands.defaultTextColor'),
            description: translateEditor('slashCommands.changeTextColor'),
            searchTerms: ['color', 'text', 'default'],
            icon: <TextOutline className='size-3.5 text-fg-primary' />,
            command: ({ editor, range }) => toggleTextColor(undefined, editor, range)
          },
          ...COLORS_LIST.map(
            color =>
              ({
                commandKey: 'text-color',
                key: `text-color-${color.key}`,
                title: color.label,
                description: translateEditor('slashCommands.changeTextColor'),
                searchTerms: ['color', 'text', color.label],

                icon: (
                  <TextOutline
                    className='size-3.5'
                    style={{
                      color: color.textColor
                    }}
                  />
                ),

                command: ({ editor, range }) => toggleTextColor(color.key, editor, range)
              }) as ISlashCommandItem
          )
        ]
      },
      {
        key: 'background-colors',
        title: translateEditor('slashCommands.sections.backgroundColors'),
        items: [
          {
            commandKey: 'background-color',
            key: 'background-color-default',
            title: translateEditor('slashCommands.defaultBackground'),
            description: translateEditor('slashCommands.changeBackgroundColor'),
            searchTerms: ['color', 'bg', 'background', 'default'],
            icon: <TextOutline className='size-3.5' />,
            iconContainerStyle: {
              borderRadius: '4px',
              backgroundColor: 'var(--background-color-surface-1)',
              border: '1px solid var(--border-color-strong)'
            },
            command: ({ editor, range }) => toggleTextColor(undefined, editor, range)
          },
          ...COLORS_LIST.map(
            color =>
              ({
                commandKey: 'background-color',
                key: `background-color-${color.key}`,
                title: color.label,
                description: translateEditor('slashCommands.changeBackgroundColor'),
                searchTerms: ['color', 'bg', 'background', color.label],
                icon: <TextOutline className='size-3.5' />,

                iconContainerStyle: {
                  borderRadius: '4px',
                  backgroundColor: color.backgroundColor
                },

                command: ({ editor, range }) => toggleBackgroundColor(color.key, editor, range)
              }) as ISlashCommandItem
          )
        ]
      }
    ]

    const internalAdditionalOptions: TSlashCommandAdditionalOption[] = []
    if (!disabledExtensions?.includes('image')) {
      internalAdditionalOptions.push({
        commandKey: 'image',
        key: 'image',
        title: translateEditor('slashCommands.image.title'),
        icon: <ImageOutline className='size-3.5' />,
        description: translateEditor('slashCommands.image.description'),
        searchTerms: ['img', 'photo', 'picture', 'media', 'upload'],
        command: ({ editor, range }: CommandProps) => insertImage({ editor, event: 'insert', range }),
        section: 'general',
        pushAfter: 'code'
      })
    }

    ;[
      ...internalAdditionalOptions,
      ...(externalAdditionalOptions ?? []),
      ...coreEditorAdditionalSlashCommandOptions({
        disabledExtensions,
        flaggedExtensions
      })
    ]?.forEach(item => {
      const sectionToPushTo = SLASH_COMMAND_SECTIONS.find(s => s.key === item.section) ?? SLASH_COMMAND_SECTIONS[0]
      const itemIndexToPushAfter = sectionToPushTo.items.findIndex(i => i.commandKey === item.pushAfter)
      if (itemIndexToPushAfter !== -1) {
        sectionToPushTo.items.splice(itemIndexToPushAfter + 1, 0, item)
      } else {
        sectionToPushTo.items.push(item)
      }
    })

    const filteredSlashSections = SLASH_COMMAND_SECTIONS.map(section => ({
      ...section,
      items: section.items.filter(item => {
        if (typeof query !== 'string') return

        const lowercaseQuery = query.toLowerCase()
        return (
          item.title.toLowerCase().includes(lowercaseQuery) ||
          item.description.toLowerCase().includes(lowercaseQuery) ||
          item.searchTerms.some(t => t.includes(lowercaseQuery))
        )
      })
    }))

    return filteredSlashSections.filter(s => s.items.length !== 0)
  }
