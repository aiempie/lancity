/** Job type and R2 layout of PDF exports. */
export const PDF_JOB = { export: 'pdf.export', cleanup: 'pdf.cleanup' } as const

/** Exports are kept one day. Keys start with the owner id, so a user can only reach their own files. */
export const PDF_PREFIX = 'pdf-exports/'
export const PDF_RETENTION_MS = 24 * 60 * 60 * 1000
export const pdfKey = (userId: number, token: string) => `${PDF_PREFIX}${userId}/${token}.pdf`
export const pdfErrorKey = (userId: number, token: string) => `${PDF_PREFIX}${userId}/${token}.error.json`
