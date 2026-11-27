import { generateHTML, generateJSON } from '@tiptap/html'
// local imports
import { createDocumentCodecs } from './document-codecs'

// browser codecs; the server entry (`@plane/editor/server`) builds the same helpers on happy-dom
export const {
  TITLE_EDITOR_EXTENSIONS,
  applyUpdates,
  convertBinaryDataToBase64String,
  convertBase64StringToBinaryData,
  getBinaryDataFromRichTextEditorHTMLString,
  generateTitleProsemirrorJson,
  getBinaryDataFromDocumentEditorHTMLString,
  getAllDocumentFormatsFromRichTextEditorBinaryData,
  getAllDocumentFormatsFromDocumentEditorBinaryData,
  convertHTMLDocumentToAllFormats,
  extractTextFromHTML
} = createDocumentCodecs({ generateHTML, generateJSON })
