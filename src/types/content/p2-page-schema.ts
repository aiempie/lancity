import { z } from 'zod'
import { contentIdSchema } from '@/types/content/schema'
import { jsonValueSchema } from '@/types/database/schema'

/** Largest accepted HTML (characters) and base64 binary payloads. The validator re-checks the 10 MB byte limit. */
const MAX_HTML_CHARS = 11_000_000
const MAX_BASE64_CHARS = 14_000_000

/** Accept Plane style snake_case keys (`description_html`) next to camelCase keys. */
export function camelizeKeys(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()),
      item
    ])
  )
}

const jsonObjectSchema = jsonValueSchema.refine(value => typeof value === 'object' && !Array.isArray(value), {
  message: 'Expected a JSON object'
})
const accessSchema = z.literal([0, 1])

const richFields = {
  descriptionHtml: z.string().max(MAX_HTML_CHARS).optional(),
  descriptionJson: jsonObjectSchema.nullable().optional(),
  color: z.string().max(255).optional(),
  parent: contentIdSchema.nullable().optional(),
  labels: z.array(contentIdSchema).max(100).optional(),
  viewProps: jsonObjectSchema.optional(),
  logoProps: jsonObjectSchema.optional()
}
const textOrHtml = (value: { descriptionText?: string; descriptionHtml?: string }) =>
  value.descriptionText === undefined || value.descriptionHtml === undefined

/** Plane `PageSerializer` create body. `descriptionText` keeps the earlier plain-text API working. */
export const pageCreateBodySchema = z.preprocess(
  camelizeKeys,
  z
    .object({
      name: z.string().trim().max(255).default(''),
      access: accessSchema.default(0),
      descriptionText: z.string().max(200000).optional(),
      descriptionBinary: z.string().max(MAX_BASE64_CHARS).nullable().optional(),
      ...richFields
    })
    .strict()
    .refine(textOrHtml, { message: 'Send descriptionText or descriptionHtml, not both' })
)
export type PageCreateBody = z.output<typeof pageCreateBodySchema>

/** Plane `PageDetailSerializer` partial update body (binary state only changes through the description endpoint). */
export const pageUpdateBodySchema = z.preprocess(
  camelizeKeys,
  z
    .object({
      name: z.string().trim().max(255).optional(),
      access: accessSchema.optional(),
      descriptionText: z.string().max(200000).optional(),
      ...richFields
    })
    .strict()
    .refine(value => Object.keys(value).length > 0, { message: 'At least one field is required' })
    .refine(textOrHtml, { message: 'Send descriptionText or descriptionHtml, not both' })
)
export type PageUpdateBody = z.output<typeof pageUpdateBodySchema>

/** Plane `PageBinaryUpdateSerializer`: base64 Yjs state plus the derived HTML and JSON. All fields are optional. */
export const pageDescriptionBodySchema = z.preprocess(
  camelizeKeys,
  z
    .object({
      descriptionBinary: z.string().max(MAX_BASE64_CHARS).optional(),
      descriptionHtml: z.string().max(MAX_HTML_CHARS).optional(),
      descriptionJson: jsonObjectSchema.nullable().optional()
    })
    .strict()
)
export type PageDescriptionBody = z.output<typeof pageDescriptionBodySchema>

/** Keys that route a PATCH on the description path to the binary/HTML update instead of the plain-text one. */
export const PAGE_DESCRIPTION_KEYS = ['descriptionBinary', 'descriptionHtml', 'descriptionJson'] as const

export const pageAccessBodySchema = z.object({ access: accessSchema }).strict()

export const pageListQuerySchema = z.object({
  order_by: z.string().max(40).optional(),
  search: z.string().trim().max(80).optional(),
  track_visit: z.enum(['true', 'false']).optional()
})
export type PageListQuery = z.output<typeof pageListQuerySchema>

/** Job payloads. Only ids travel through the Queue; handlers read the page from D1 (messages are limited to 128 KB). */
export const pageTransactionJobSchema = z.object({ pageId: contentIdSchema }).strict()
export const pageVersionJobSchema = z.object({ pageId: contentIdSchema, userId: contentIdSchema }).strict()
export type PageTransactionJob = z.output<typeof pageTransactionJobSchema>
export type PageVersionJob = z.output<typeof pageVersionJobSchema>
