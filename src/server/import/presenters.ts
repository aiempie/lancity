type ImportRow = {
  id: number
  createdAt: Date | null
  updatedAt: Date | null
  completedAt: Date | null
  projectId: number
  initiatedById: number
  source: string
  format: string
  status: string
  fileName: string
  totalRows: number
  processedRows: number
  createdCount: number
  skippedCount: number
  failedCount: number
  errors: unknown
  reason: string
}

/** PD-1402 `Importer.__str__`: `service <project name>`. */
export const formatImporter = (row: { service: string }, project: { name: string }) => `${row.service} <${project.name}>`

const iso = (value: Date | null) => value?.toISOString() ?? null

/** Public view of an import job. The stored file key never leaves the server. */
export function presentImportJob(row: ImportRow, options: { includeErrors?: boolean } = {}) {
  return {
    id: row.id,
    project: row.projectId,
    initiated_by: row.initiatedById,
    source: row.source,
    format: row.format,
    status: row.status,
    file_name: row.fileName,
    total_rows: row.totalRows,
    processed_rows: row.processedRows,
    created_count: row.createdCount,
    skipped_count: row.skippedCount,
    failed_count: row.failedCount,
    reason: row.reason,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
    completed_at: iso(row.completedAt),
    ...(options.includeErrors ? { errors: row.errors } : {})
  }
}
