import { PluginKey } from '@tiptap/pm/state'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { Suggestion, type SuggestionOptions } from '@tiptap/suggestion'
import { CORE_EXTENSIONS } from '@/components/editor/constants/extension'
import { renderMentionsDropdown } from '@/components/editor/extensions/mentions/utils'
import type { TIssueEmbedConfig, TMentionHandler, TWorkItemEmbedSuggestion } from '@/components/editor/types'
// local imports
import { WorkItemEmbedExtensionConfig } from './extension-config'
import type { TWorkItemEmbedAttributes } from './types'
import { EWorkItemEmbedAttributeNames } from './types'

type Props = Pick<TIssueEmbedConfig, 'widgetCallback' | 'searchCallback'>

declare module '@tiptap/core' {
  interface Storage {
    [CORE_EXTENSIONS.WORK_ITEM_EMBED]: { pickerOpen: boolean }
  }
}

/** Lancity: the picker opened by the "Work item" slash command. It is a suggestion that only reacts to that command. */
export const WORK_ITEM_EMBED_PICKER_CHAR = '[['
const pickerKey = new PluginKey('work-item-embed-picker')

export function WorkItemEmbedExtension(props: Props) {
  return WorkItemEmbedExtensionConfig.extend({
    addStorage() {
      return { pickerOpen: false }
    },

    addProseMirrorPlugins() {
      const { searchCallback } = props
      if (!searchCallback) return []
      const storage = this.storage
      const render = renderMentionsDropdown({
        searchCallback: searchCallback as TMentionHandler['searchCallback'],
        extensionKey: CORE_EXTENSIONS.WORK_ITEM_EMBED
      })
      return [
        Suggestion<TWorkItemEmbedSuggestion, TWorkItemEmbedSuggestion>({
          editor: this.editor,
          pluginKey: pickerKey,
          char: WORK_ITEM_EMBED_PICKER_CHAR,
          allowSpaces: true,
          // Typing the characters does nothing: only the slash command opens the picker.
          allow: () => storage.pickerOpen,
          items: () => [],
          command: ({ editor, range, props: item }) => {
            storage.pickerOpen = false
            const attrs: TWorkItemEmbedAttributes = {
              [EWorkItemEmbedAttributeNames.ID]: crypto.randomUUID(),
              [EWorkItemEmbedAttributeNames.ENTITY_IDENTIFIER]: item.entity_identifier,
              [EWorkItemEmbedAttributeNames.PROJECT_IDENTIFIER]: item.project_identifier,
              [EWorkItemEmbedAttributeNames.WORKSPACE_IDENTIFIER]: item.workspace_identifier,
              [EWorkItemEmbedAttributeNames.ENTITY_NAME]: 'issue'
            }
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent({ type: CORE_EXTENSIONS.WORK_ITEM_EMBED, attrs })
              .run()
          },
          render: () => {
            const dropdown = render?.() as ReturnType<NonNullable<SuggestionOptions['render']>>
            return {
              ...dropdown,
              onExit: exitProps => {
                storage.pickerOpen = false
                dropdown.onExit?.(exitProps)
              }
            }
          }
        })
      ]
    },

    addNodeView() {
      return ReactNodeViewRenderer((issueProps: NodeViewProps) => {
        const attrs = issueProps.node.attrs as TWorkItemEmbedAttributes
        return (
          <NodeViewWrapper key={attrs[EWorkItemEmbedAttributeNames.ID]}>
            {props.widgetCallback({
              issueId: attrs[EWorkItemEmbedAttributeNames.ENTITY_IDENTIFIER] ?? '',
              projectId: attrs[EWorkItemEmbedAttributeNames.PROJECT_IDENTIFIER],
              workspaceSlug: attrs[EWorkItemEmbedAttributeNames.WORKSPACE_IDENTIFIER]
            })}
          </NodeViewWrapper>
        )
      })
    }
  })
}

/** Lancity: open the work item picker in place of the slash command text. */
export function openWorkItemEmbedPicker(editor: import('@tiptap/core').Editor, range: import('@tiptap/core').Range) {
  editor.storage[CORE_EXTENSIONS.WORK_ITEM_EMBED].pickerOpen = true
  editor.chain().focus().deleteRange(range).insertContent(WORK_ITEM_EMBED_PICKER_CHAR).run()
}
