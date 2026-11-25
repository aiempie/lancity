import { getDb } from '@/db/client'
import { enqueueJob, registerJobHandler, registerScheduled } from '@/server/common/jobs'
import { getEnv } from '@/server/common/env'
import { pushInstanceMetrics } from '@/server/instance/telemetry'

export const PUSH_INSTANCE_METRICS = 'instance.push_metrics'

/** Queue an immediate telemetry push (still gated by `TELEMETRY_ENABLED` and the instance setting). */
export function queueInstanceMetricsPush(): Promise<void> {
  return enqueueJob(getEnv(), { type: PUSH_INSTANCE_METRICS })
}

export function register(): void {
  registerJobHandler(PUSH_INSTANCE_METRICS, async (_payload, env) => {
    await pushInstanceMetrics(getDb(env.DB), env)
  })
  // Fires on the 5-minute trigger and returns at once unless TELEMETRY_ENABLED=1 and the push interval has elapsed.
  registerScheduled(
    '*/5 * * * *',
    async env => {
      await pushInstanceMetrics(getDb(env.DB), env)
    },
    PUSH_INSTANCE_METRICS
  )
}
