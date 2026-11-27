// constants
import type { CORE_EXTENSIONS } from '@/components/editor/constants/extension'

export type TAdditionalEditorAsset = never

export type TEditorImageAsset = {
  href: string
  id: string
  name: string
  src: string
  type: CORE_EXTENSIONS.IMAGE | CORE_EXTENSIONS.CUSTOM_IMAGE
}

export type TEditorAsset = TEditorImageAsset | TAdditionalEditorAsset
