// extensions
import type { ImageExtensionStorage } from '@/components/editor/extensions/image'

export type ExtensionFileSetStorageKey = Extract<keyof ImageExtensionStorage, 'deletedImageSet'>
