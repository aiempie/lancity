/**
 * PD-2077, PD-2078: Hocuspocus logger extension. Lines are single-line JSON, which Workers Logs collects. This does not
 * use `common/env.ts` so the collaboration modules load outside the Workers runtime (tests).
 */
export function liveLog(event: string, data: Record<string, unknown> = {}, level: 'info' | 'warn' | 'error' = 'info'): void {
  console[level === 'info' ? 'log' : level](JSON.stringify({ level, label: `live.${event}`, ...data }))
}
