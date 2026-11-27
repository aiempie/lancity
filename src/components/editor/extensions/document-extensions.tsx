import type { HocuspocusProvider } from '@hocuspocus/provider'
import type { AnyExtension } from '@tiptap/core'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { SlashCommands } from '@/components/editor/extensions'
import type { TSlashCommandAdditionalOption } from '@/components/editor/extensions'
import { CheckSquareOffsetOutline } from '@/components/editor/icons'
import { translateEditor } from '@/components/editor/i18n'
// types
import type { IEditorProps, TExtensions, TUserDetails } from '@/components/editor/types'
import { WorkItemEmbedExtensionConfig } from './work-item-embed/extension-config'
import { WorkItemEmbedExtension, openWorkItemEmbedPicker } from './work-item-embed/extension'

export type TDocumentEditorAdditionalExtensionsProps = Pick<
  IEditorProps,
  'disabledExtensions' | 'flaggedExtensions' | 'fileHandler' | 'extendedEditorProps'
> & {
  isEditable: boolean
  provider?: HocuspocusProvider
  userDetails: TUserDetails
}

export type TDocumentEditorAdditionalExtensionsRegistry = {
  isEnabled: (disabledExtensions: TExtensions[], flaggedExtensions: TExtensions[]) => boolean
  getExtension: (props: TDocumentEditorAdditionalExtensionsProps) => AnyExtension
  /** Lancity: only for live documents (the extension reads the provider's awareness). */
  needsProvider?: boolean
}

/** Lancity: embedding is on when the app gives an embed handler and does not disable `issue-embed`. */
const issueEmbedHandler = ({ disabledExtensions, extendedEditorProps }: TDocumentEditorAdditionalExtensionsProps) =>
  disabledExtensions.includes('issue-embed') ? undefined : extendedEditorProps?.embedHandler?.issue

const workItemSlashCommand = (): TSlashCommandAdditionalOption => ({
  commandKey: 'issue-embed',
  key: 'issue-embed',
  // Read when the menu opens: the extension is built before the editor registers its translations.
  get title() {
    return translateEditor('slashCommands.workItem.title')
  },
  get description() {
    return translateEditor('slashCommands.workItem.description')
  },
  searchTerms: ['work', 'item', 'issue', 'embed'],
  icon: <CheckSquareOffsetOutline className='size-3.5' />,
  command: ({ editor, range }) => openWorkItemEmbedPicker(editor, range),
  section: 'general',
  pushAfter: 'callout'
})

/** Lancity: carets of the other people on the page (Plane CE ships the flag without an extension). */
const collaborationCaret = ({ provider, userDetails }: TDocumentEditorAdditionalExtensionsProps) =>
  CollaborationCaret.configure({
    provider,
    user: { id: userDetails.id, name: userDetails.name, color: userDetails.color }
  })

const extensionRegistry: TDocumentEditorAdditionalExtensionsRegistry[] = [
  {
    isEnabled: disabledExtensions => !disabledExtensions.includes('slash-commands'),
    getExtension: props =>
      SlashCommands({
        disabledExtensions: props.disabledExtensions,
        flaggedExtensions: props.flaggedExtensions,
        additionalOptions: issueEmbedHandler(props)?.searchCallback ? [workItemSlashCommand()] : []
      })
  },
  {
    isEnabled: disabledExtensions => !disabledExtensions.includes('collaboration-cursor'),
    getExtension: props => collaborationCaret(props),
    needsProvider: true
  },
  {
    // Lancity: the node is always in the schema. Without it the collaboration binding deletes the embeds of a page
    // from the shared document; without a handler they are kept but not shown.
    isEnabled: () => true,
    getExtension: props => {
      const handler = issueEmbedHandler(props)
      return handler ? WorkItemEmbedExtension(handler) : WorkItemEmbedExtensionConfig
    }
  }
]

export function DocumentEditorAdditionalExtensions(props: TDocumentEditorAdditionalExtensionsProps) {
  const { disabledExtensions, flaggedExtensions } = props

  const documentExtensions = extensionRegistry
    .filter(config => config.isEnabled(disabledExtensions, flaggedExtensions))
    .filter(config => !config.needsProvider || Boolean(props.provider))
    .map(config => config.getExtension(props))

  return documentExtensions
}
