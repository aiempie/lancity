import { editorAssetIdSchema } from '@/types/editor/schema'

/**
 * Whether an image `src` is a Lancity asset id rather than a URL. Lancity file assets use numeric auto-increment ids
 * (`file_assets.id`); Plane used UUIDs.
 */
export const isValidAssetId = (assetId: string): boolean => editorAssetIdSchema.safeParse(assetId).success
