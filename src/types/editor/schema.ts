import { z } from 'zod'

// Types that the editor shares with the rest of Plane (`@plane/types`, `@plane/constants`, Blocks logo), kept with
// their Plane field names because the editor and the stored documents use them as is.

export enum EPageAccess {
  PUBLIC = 0,
  PRIVATE = 1
}

export type TLogoProps = {
  in_use: 'emoji' | 'icon'
  emoji?: {
    value?: string
    url?: string
  }
  icon?: {
    name?: string
    color?: string
    background_color?: string
  }
}

/** Blocks name of `TLogoProps`. */
export type Logo = TLogoProps

export type TPage = {
  access: EPageAccess | undefined
  archived_at: string | null | undefined
  color: string | undefined
  created_at: Date | undefined
  created_by: string | undefined
  description_json: object | undefined
  description_html: string | undefined
  id: string | undefined
  is_favorite: boolean
  is_locked: boolean
  label_ids: string[] | undefined
  name: string | undefined
  owned_by: string | undefined
  project_ids?: string[] | undefined
  updated_at: Date | undefined
  updated_by: string | undefined
  workspace: string | undefined
  logo_props: TLogoProps | undefined
  deleted_at: Date | undefined
}

export type TDocumentPayload = {
  description_binary: string
  description_html: string
  description_json: object
}

export type TSearchEntities = 'user_mention' | 'issue' | 'project' | 'cycle' | 'module' | 'page'

export enum EFileAssetType {
  COMMENT_DESCRIPTION = 'COMMENT_DESCRIPTION',
  ISSUE_ATTACHMENT = 'ISSUE_ATTACHMENT',
  ISSUE_DESCRIPTION = 'ISSUE_DESCRIPTION',
  DRAFT_ISSUE_DESCRIPTION = 'DRAFT_ISSUE_DESCRIPTION',
  PAGE_DESCRIPTION = 'PAGE_DESCRIPTION',
  PROJECT_COVER = 'PROJECT_COVER',
  USER_AVATAR = 'USER_AVATAR',
  USER_COVER = 'USER_COVER',
  WORKSPACE_LOGO = 'WORKSPACE_LOGO',
  TEAM_SPACE_DESCRIPTION = 'TEAM_SPACE_DESCRIPTION',
  INITIATIVE_DESCRIPTION = 'INITIATIVE_DESCRIPTION',
  PROJECT_DESCRIPTION = 'PROJECT_DESCRIPTION',
  TEAM_SPACE_COMMENT_DESCRIPTION = 'TEAM_SPACE_COMMENT_DESCRIPTION'
}

export type TEditorAssetType =
  | EFileAssetType.COMMENT_DESCRIPTION
  | EFileAssetType.ISSUE_DESCRIPTION
  | EFileAssetType.DRAFT_ISSUE_DESCRIPTION
  | EFileAssetType.PAGE_DESCRIPTION
  | EFileAssetType.TEAM_SPACE_DESCRIPTION
  | EFileAssetType.INITIATIVE_DESCRIPTION
  | EFileAssetType.PROJECT_DESCRIPTION
  | EFileAssetType.TEAM_SPACE_COMMENT_DESCRIPTION

export type TDuplicateAssetData = {
  entity_id: string
  entity_type: EFileAssetType
  project_id?: string
  asset_ids: string[]
}

/** asset_id -> new_asset_id */
export type TDuplicateAssetResponse = Record<string, string>

/**
 * An image `src` that refers to a Lancity asset rather than a URL: the numeric `file_assets.id` as a string. Stored
 * document content is untrusted, so every handler checks it before building a URL.
 */
export const editorAssetIdSchema = z.string().regex(/^[1-9]\d*$/)

/** Where the images of one editor are stored: the project asset routes of the API, bound to one entity. */
export type TEditorAssetScope = {
  workspaceSlug: string
  projectId: number
  entityType: TEditorAssetType
  /** Id of the page, issue or comment the images belong to. Leave empty for an entity that does not exist yet. */
  entityId?: number
}

/** `POST …/entity-assets`: the registered asset and where to send its bytes (Lancity's presigned POST). */
export const editorAssetUploadSchema = z.object({
  asset_id: z.number().int().positive(),
  upload_data: z.object({
    url: z.string().startsWith('/'),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string())
  })
})

export const editorAssetCheckSchema = z.object({ exists: z.boolean() })
export const editorAssetDuplicateSchema = z.object({ asset_id: z.number().int().positive() })

/** Upload progress of an image block: 0 to 100, `undefined` once the upload is over. */
export type TEditorUploadProgress = (blockId: string, percent: number | undefined) => void
