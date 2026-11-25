import { stripTags } from '@/server/page/html-processor'

/** Page.get_view_props default (PD-1457). */
export function getViewProps(): { full_width: boolean } {
  return { full_width: false }
}

/** `description_stripped` derived from the HTML: null for empty or missing HTML (Page.save, PageVersion.save). */
export function pageDescriptionStripped(descriptionHtml: string | null | undefined): string | null {
  return descriptionHtml === '' || descriptionHtml === null || descriptionHtml === undefined
    ? null
    : stripTags(descriptionHtml)
}

/** PD-1459: Page.save. Returns the values to write with `descriptionStripped` recomputed when the HTML is set. */
export function savePage<T extends { descriptionHtml?: string | null }>(values: T) {
  return values.descriptionHtml === undefined
    ? values
    : { ...values, descriptionStripped: pageDescriptionStripped(values.descriptionHtml) }
}

/** PD-1463: PageVersion.save has the same rule as Page.save. */
export const savePageVersion = savePage

/** Plane keeps at most this many versions per page; older ones are deleted by the version job. */
export const MAX_PAGE_VERSIONS = 20
/** A version saved by the same user within this window is updated in place (seconds). */
export const PAGE_VERSION_TASK_TIMEOUT = 600
