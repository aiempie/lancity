'use client'

import { useMemo, useState } from 'react'
import type { TFileHandler } from '@/components/editor'
import { createEditorFileHandler, type EditorFileHandlerOptions } from '@/lib/editor/file-handler'
import type { TEditorAssetScope } from '@/types/editor/schema'

/**
 * `fileHandler` for an editor whose images go to R2 through the project asset API, with the upload progress the
 * editor shows on each image. The editor keeps the handler it mounted with: when the scope changes (another page or
 * project), mount a new editor, for example with a `key`.
 */
export function useEditorFileHandler(
  scope: TEditorAssetScope & Pick<EditorFileHandlerOptions, 'maxFileSize'>
): TFileHandler {
  const { workspaceSlug, projectId, entityType, entityId, maxFileSize } = scope
  const [assetsUploadStatus, setAssetsUploadStatus] = useState<Record<string, number>>({})
  const methods = useMemo(
    () =>
      createEditorFileHandler({
        workspaceSlug,
        projectId,
        entityType,
        entityId,
        maxFileSize,
        onProgress: (blockId, percent) =>
          setAssetsUploadStatus(previous => {
            const next = { ...previous }
            if (percent === undefined) delete next[blockId]
            else next[blockId] = percent
            return next
          })
      }),
    [workspaceSlug, projectId, entityType, entityId, maxFileSize]
  )
  return useMemo(() => ({ ...methods, assetsUploadStatus }), [methods, assetsUploadStatus])
}
