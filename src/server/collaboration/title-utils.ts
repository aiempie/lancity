import { stripTags } from '@/server/page/html-processor'

/** PD-2118: plain text of a title fragment. Plane removes every tag with DOMPurify and trims the result. */
export function extractTextFromHTML(html: string): string {
  return stripTags(html).trim()
}
