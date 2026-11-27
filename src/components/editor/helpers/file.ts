import { translateEditor } from '@/components/editor/i18n'

export enum EFileError {
  INVALID_FILE_TYPE = 'INVALID_FILE_TYPE',
  FILE_SIZE_TOO_LARGE = 'FILE_SIZE_TOO_LARGE',
  NO_FILE_SELECTED = 'NO_FILE_SELECTED'
}

type TArgs = {
  acceptedMimeTypes: string[]
  file: File
  maxFileSize: number
  onError: (error: EFileError, message: string) => void
}

export const isFileValid = (args: TArgs): boolean => {
  const { acceptedMimeTypes, file, maxFileSize, onError } = args

  if (!file) {
    onError(EFileError.NO_FILE_SELECTED, translateEditor('image.noFile'))
    return false
  }

  if (!acceptedMimeTypes.includes(file.type)) {
    onError(EFileError.INVALID_FILE_TYPE, translateEditor('image.invalidType'))
    return false
  }

  if (file.size > maxFileSize) {
    onError(EFileError.FILE_SIZE_TOO_LARGE, translateEditor('image.tooLarge', { size: maxFileSize / 1024 / 1024 }))
    return false
  }

  return true
}
