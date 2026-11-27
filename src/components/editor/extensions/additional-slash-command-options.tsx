// extensions
import type { TSlashCommandAdditionalOption } from '@/components/editor/extensions'
// types
import type { IEditorProps } from '@/components/editor/types'

type Props = Pick<IEditorProps, 'disabledExtensions' | 'flaggedExtensions'>

export const coreEditorAdditionalSlashCommandOptions = (props: Props): TSlashCommandAdditionalOption[] => {
  const {} = props
  const options: TSlashCommandAdditionalOption[] = []
  return options
}
