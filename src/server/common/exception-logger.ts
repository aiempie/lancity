/**
 * Log an unexpected exception as one JSON line (Plane `log_exception`).
 * Never imports Cloudflare modules so it can be used from tests and any runtime.
 * Pass `warning: true` for expected refusals that carry no useful stack.
 */
export function logException(error: unknown, options: { warning?: boolean; context?: Record<string, unknown> } = {}): void {
  const err = error instanceof Error ? error : new Error(String(error))
  const line = JSON.stringify({
    level: options.warning ? 'warn' : 'error',
    label: 'exception',
    message: err.message,
    name: err.name,
    ...(options.warning ? {} : { stack: err.stack }),
    ...options.context
  })
  if (options.warning) console.warn(line)
  else console.error(line)
}
