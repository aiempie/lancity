import { z } from 'zod'

const nestedJsonSchema = z.json()

// Drizzle maps a top-level null to SQL NULL. Column nullability is handled by drizzle-zod.
export const jsonValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(nestedJsonSchema),
  z.record(z.string(), nestedJsonSchema)
])

export type JsonValue = z.infer<typeof jsonValueSchema>

export type LancityDb = import('drizzle-orm/d1').DrizzleD1Database<typeof import('@/db/schema')> & {
  $client: D1Database
}
