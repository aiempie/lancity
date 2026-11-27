import { ReactNodeViewRenderer } from '@tiptap/react'
// types
import type { TMentionHandler } from '@/components/editor/types'
// extension config
import { CustomMentionExtensionConfig } from './extension-config'
// node view
import type { MentionNodeViewProps } from './mention-node-view'
import { MentionNodeView } from './mention-node-view'
// utils
import { renderMentionsDropdown } from './utils'

export function CustomMentionExtension(props: TMentionHandler) {
  const { searchCallback, renderComponent, getMentionedEntityDetails } = props
  return CustomMentionExtensionConfig.extend({
    addOptions(this) {
      return {
        ...this.parent!(),
        renderComponent,
        getMentionedEntityDetails
      }
    },

    addNodeView() {
      return ReactNodeViewRenderer(nodeViewProps => (
        <MentionNodeView {...nodeViewProps} node={nodeViewProps.node as MentionNodeViewProps['node']} />
      ))
    }
  }).configure({
    suggestion: {
      render: renderMentionsDropdown({
        searchCallback
      }),
      allowSpaces: true
    }
  })
}
