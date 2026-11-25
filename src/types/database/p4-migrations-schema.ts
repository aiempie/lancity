import { z } from 'zod'

/** A row exported from Plane's Postgres database (snake_case Django column names, UUID string keys). */
export const planeDumpRowSchema = z.record(z.string(), z.unknown())
export type PlaneDumpRow = z.infer<typeof planeDumpRowSchema>

/** One Plane table in a dump: the table name is the file name (`issues.json`, `issues.jsonl` or `issues.csv`). */
export const planeDumpSchema = z.record(z.string(), z.array(planeDumpRowSchema))
export type PlaneDump = z.infer<typeof planeDumpSchema>

/** Per-table UUID to auto-increment ID mapping. Persist it to make an import repeatable and to resolve later batches. */
export const idMapSnapshotSchema = z.object({
  tables: z.record(z.string(), z.object({ next: z.number().int().positive(), ids: z.record(z.string(), z.number().int().positive()) }))
})
export type IdMapSnapshot = z.infer<typeof idMapSnapshotSchema>

export const planeImportOptionsSchema = z.object({
  /** Highest Plane Django migration number already applied to the dump. Older dumps get the historical rules. */
  sourceMigration: z.number().int().min(0).default(125),
  /** Mark every copied file asset as uploaded. Only use after the bytes have been copied to R2 and verified. */
  assumeUploaded: z.boolean().default(false),
  /** Asset keys whose R2 object has been verified. */
  uploadedKeys: z.array(z.string()).default([]),
  /** Import API tokens as inactive rows without a workspace (PD-1350). They must be revoked and recreated. */
  includeApiTokens: z.boolean().default(false),
  /** Epoch milliseconds used for generated timestamps and soft deletions. */
  now: z.number().int().positive().optional()
})
export type PlaneImportOptions = z.infer<typeof planeImportOptionsSchema>

export const planeImportReportSchema = z.object({
  tables: z.record(z.string(), z.object({ read: z.number().int(), written: z.number().int(), dropped: z.number().int() })),
  warnings: z.array(z.string()),
  skippedTables: z.array(z.object({ table: z.string(), reason: z.string() })),
  assetCopies: z.array(z.object({ id: z.number().int(), key: z.string() }))
})
export type PlaneImportReport = z.infer<typeof planeImportReportSchema>
