import { apiActivityLogs } from '@/db/schema/integration'
import { logException } from '@/server/common/exception-logger'
import type { LancityDb } from '@/types/database/schema'
import { apiLogDataSchema, type ApiLogData } from '@/types/instance/p4-maintenance-schema'

/** PD-1198 `log_to_postgres`: persist one external API request log. Returns false (and logs) when the insert fails. */
export async function logToDatabase(db: LancityDb, log: ApiLogData): Promise<boolean> {
  try {
    await db.insert(apiActivityLogs).values({
      tokenIdentifier: log.token_identifier,
      path: log.path,
      method: log.method,
      queryParams: log.query_params ?? null,
      headers: log.headers ?? null,
      body: log.body ?? null,
      responseCode: log.response_code,
      responseBody: log.response_body ?? null,
      ipAddress: log.ip_address ?? null,
      userAgent: log.user_agent ?? null
    })
    return true
  } catch (error) {
    logException(error)
    return false
  }
}

/**
 * PD-1199 `process_logs`. Unknown keys are ignored, as Plane's `**_` kwargs keep jobs queued by an older release valid.
 * An invalid payload is dropped (retrying cannot fix it).
 */
export async function processLogs(db: LancityDb, raw: unknown): Promise<boolean> {
  const parsed = apiLogDataSchema.safeParse(raw)
  if (!parsed.success) {
    logException(new Error('Invalid API log payload'), { warning: true })
    return false
  }
  return logToDatabase(db, parsed.data)
}
