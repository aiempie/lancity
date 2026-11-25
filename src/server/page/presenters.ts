import type { PageRow } from '@/server/page/queries'

/** PD-1458: Page.__str__ (display label for logs). */
export function formatPage(ownerEmail: string, name: string): string {
  return `${ownerEmail} <${name}>`
}

/** PD-1460: PageLog.__str__. */
export function formatPageLog(pageName: string, entityName: string): string {
  return `${pageName} ${entityName}`
}

/** PD-1461: PageLabel.__str__. */
export function formatPageLabel(pageName: string, labelName: string): string {
  return `${pageName} ${labelName}`
}

/** PD-1462: ProjectPage.__str__. */
export function formatProjectPage(projectName: string, pageName: string): string {
  return `${projectName} ${pageName}`
}

/** PageSerializer / PageDetailSerializer output. The detail adds the HTML and the issues linked from the page. */
export function presentPage(row: PageRow, extra: { issueIds?: number[] } = {}) {
  const { descriptionHtml, descriptionStripped, ...page } = row
  return {
    ...page,
    ...(descriptionHtml === null ? {} : { descriptionHtml, descriptionText: descriptionStripped }),
    ...extra
  }
}
