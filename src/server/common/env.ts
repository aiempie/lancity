// Loaded dynamically (no top-level await) so modules that import this file can also load under Node (unit tests), where
// 'cloudflare:workers' does not exist. getEnv() and runInBackground() need the Workers runtime.
let workers: typeof import('cloudflare:workers') | null = null
void import('cloudflare:workers').then(
  module => void (workers = module),
  () => undefined
)

/** Bindings and secrets shared by background jobs, mail and storage helpers. */
export type InfraEnv = {
  DB: D1Database
  ASSET_BUCKET?: R2Bucket
  JOBS_QUEUE?: Queue<unknown>
  GMAIL_USER?: string
  GMAIL_APP_PASSWORD?: string
  MAIL_FROM?: string
  BETTER_AUTH_URL?: string
  [key: string]: unknown
}

/** Return the Cloudflare env binding of the current Worker invocation. */
export function getEnv(): InfraEnv {
  if (!workers) throw new Error('getEnv() needs the Cloudflare Workers runtime; pass the env explicitly')
  return workers.env as unknown as InfraEnv
}

/** Keep the Worker alive until the promise settles. Errors are logged, never thrown. */
export function runInBackground(task: Promise<unknown>, label = 'background task'): void {
  if (!workers) {
    void task.catch(() => undefined)
    return
  }
  workers.waitUntil(
    task.catch(error => {
      console.error(JSON.stringify({ level: 'error', label, message: error instanceof Error ? error.message : String(error) }))
    })
  )
}

/** Read a retention window in days. Unset, invalid or negative values fall back to the default (Plane `_retention_days`). */
export function retentionDays(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback
  const days = Number(raw)
  return Number.isInteger(days) && days >= 0 ? days : fallback
}

/** Read the metrics push interval in minutes, 1..10,000,000, default 360 (Plane `_get_metrics_push_interval_minutes`). */
export function getMetricsPushIntervalMinutes(raw: unknown): number {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 && value <= 10_000_000 ? value : 360
}

/** Write one structured JSON log line (replaces Plane's JSON Celery loggers). */
export function logJson(level: 'info' | 'warn' | 'error', label: string, data: Record<string, unknown> = {}): void {
  console[level === 'info' ? 'log' : level](JSON.stringify({ level, label, ...data }))
}
