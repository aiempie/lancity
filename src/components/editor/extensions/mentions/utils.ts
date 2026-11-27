import { ReactRenderer } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import type { SuggestionOptions } from '@tiptap/suggestion'
// constants
import { CORE_EXTENSIONS } from '@/components/editor/constants/extension'
// helpers
import { updateFloatingUIFloaterPosition } from '@/components/editor/helpers/floating-ui'
import type { CommandListInstance } from '@/components/editor/helpers/tippy'
import { DROPDOWN_NAVIGATION_KEYS } from '@/components/editor/helpers/tippy'
// types
import type { TMentionHandler } from '@/components/editor/types'
// local components
import type { MentionsListDropdownProps } from './mentions-list-dropdown'
import { MentionsListDropdown } from './mentions-list-dropdown'

export const renderMentionsDropdown =
  (
    args: Pick<TMentionHandler, 'searchCallback'> & {
      /** Lancity: the dropbar key, for suggestions that reuse this dropdown (work item embeds). */
      extensionKey?: CORE_EXTENSIONS.MENTION | CORE_EXTENSIONS.WORK_ITEM_EMBED
    }
  ): SuggestionOptions['render'] =>
  () => {
    const { searchCallback, extensionKey = CORE_EXTENSIONS.MENTION } = args
    let component: ReactRenderer<CommandListInstance, MentionsListDropdownProps> | null = null
    let cleanup: () => void = () => {}
    let editorRef: Editor | null = null

    const handleClose = (editor?: Editor) => {
      component?.destroy()
      component = null
      ;(editor || editorRef)?.commands.removeActiveDropbarExtension(extensionKey)
      cleanup()
    }

    return {
      onStart: props => {
        if (!searchCallback) return
        editorRef = props.editor
        component = new ReactRenderer<CommandListInstance, MentionsListDropdownProps>(MentionsListDropdown, {
          props: {
            ...props,
            searchCallback,
            onClose: () => handleClose(props.editor)
          } satisfies MentionsListDropdownProps,
          editor: props.editor,
          className: 'fixed z-[100]'
        })
        if (!props.clientRect) return
        props.editor.commands.addActiveDropbarExtension(extensionKey)
        const element = component.element as HTMLElement
        cleanup = updateFloatingUIFloaterPosition(props.editor, element).cleanup
      },
      onUpdate: props => {
        if (!component || !component.element) return
        component.updateProps(props)
        if (!props.clientRect) return
        cleanup()
        cleanup = updateFloatingUIFloaterPosition(props.editor, component.element as HTMLElement).cleanup
      },
      onKeyDown: ({ event }) => {
        if ([...DROPDOWN_NAVIGATION_KEYS, 'Escape'].includes(event.key)) {
          event.preventDefault()
          event.stopPropagation()
        }

        if (event.key === 'Escape') {
          handleClose()
          return true
        }

        return component?.ref?.onKeyDown({ event }) ?? false
      },
      onExit: ({ editor }) => {
        component?.element.remove()
        handleClose(editor)
      }
    }
  }
