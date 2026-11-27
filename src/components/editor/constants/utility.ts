// plane imports
import { CORE_EXTENSIONS } from '@/components/editor/constants/extension'
// plane editor imports
import type { ExtensionFileSetStorageKey } from '@/components/editor/types/storage'

export type NodeFileMapType = Partial<
  Record<
    CORE_EXTENSIONS.IMAGE | CORE_EXTENSIONS.CUSTOM_IMAGE,
    {
      fileSetName: ExtensionFileSetStorageKey
    }
  >
>

export const NODE_FILE_MAP: NodeFileMapType = {
  [CORE_EXTENSIONS.IMAGE]: {
    fileSetName: 'deletedImageSet'
  },
  [CORE_EXTENSIONS.CUSTOM_IMAGE]: {
    fileSetName: 'deletedImageSet'
  }
}
