import { z } from 'zod'

/** Page sizes of Plane `PdfExportRequestBody`. */
export const pdfPageSizes = ['A4', 'A3', 'A2', 'LETTER', 'LEGAL', 'TABLOID'] as const
export type PdfPageSize = (typeof pdfPageSizes)[number]
export const pdfOrientations = ['portrait', 'landscape'] as const
export type PdfOrientation = (typeof pdfOrientations)[number]

/** Body of `POST .../pages/:pageId/pdf-export`. Slug, project and page come from the URL, not from the body. */
export const pdfExportBodySchema = z.object({
  title: z.string().max(255).optional(),
  author: z.string().max(255).optional(),
  subject: z.string().max(255).optional(),
  pageSize: z.enum(pdfPageSizes).optional(),
  pageOrientation: z.enum(pdfOrientations).optional(),
  fileName: z.string().max(200).optional(),
  noAssets: z.boolean().optional(),
  /** Run as a background job and store the file in R2 instead of answering with the PDF. */
  async: z.boolean().optional()
})
export type PdfExportBody = z.output<typeof pdfExportBodySchema>

/** Options handed to the renderer (Plane `PDFExportOptions`). */
export type PdfRenderOptions = {
  title?: string
  author?: string
  subject?: string
  pageSize?: PdfPageSize
  pageOrientation?: PdfOrientation
  noAssets?: boolean
}

export type TipTapMark = { type: string; attrs?: Record<string, unknown> }
export type TipTapNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: TipTapNode[]
  text?: string
  marks?: TipTapMark[]
}
export type TipTapDocument = { type: 'doc'; content?: TipTapNode[] }

export type PdfUserMention = { id: string; display_name: string; avatar_url?: string }

/** Entity references resolved before rendering (Plane `PDFExportMetadata`). */
export type PdfExportMetadata = {
  userMentions?: PdfUserMention[]
  /** Asset id to `data:` URI. */
  resolvedImageUrls?: Record<string, string>
  noAssets?: boolean
}

/** Payload of the `pdf.export` job. Ids only; the job reloads the page. */
export const pdfExportJobSchema = z.object({
  token: z.string().min(16).max(64),
  workspaceId: z.number().int().positive(),
  pageId: z.number().int().positive(),
  userId: z.number().int().positive(),
  fileName: z.string().max(200).optional(),
  options: pdfExportBodySchema.omit({ async: true, fileName: true }).default({})
})
export type PdfExportJob = z.output<typeof pdfExportJobSchema>

export const pdfTokenSchema = z.string().regex(/^[0-9a-f-]{36}$/)
