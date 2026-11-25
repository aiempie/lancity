import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { user } from '@/db/schema/auth'
import { instanceJobState } from '@/db/schema/ext-p3-instance'
import { userSecurity } from '@/db/schema/ext-p1-auth'
import { pages } from '@/db/schema/content'
import { issues } from '@/db/schema/issue'
import { cycleIssues, cycles, moduleIssues, modules } from '@/db/schema/planning'
import { projects, workspaceMembers, workspaces } from '@/db/schema/workspace'
import { getMetricsPushIntervalMinutes, logJson, type InfraEnv } from '@/server/common/env'
import { getOtlpHttpMetricsUrl } from '@/server/common/otlp-endpoints'
import { currentInstance } from '@/server/instance/permissions'
import type { LancityDb } from '@/types/database/schema'

export const WORKSPACE_METRICS_LIMIT = 1000
const FLUSH_TIMEOUT_MILLIS = 30_000
const LAST_PUSH_KEY = 'telemetry_last_push'

type Attributes = Record<string, string>
type Gauge = { name: string; description: string; points: { value: number; attributes: Attributes }[] }

/** Telemetry is off unless the operator sets `TELEMETRY_ENABLED=1` and the instance row also allows it. */
export const isTelemetryRuntimeEnabled = (env: Record<string, unknown>) => env.TELEMETRY_ENABLED === '1'

/**
 * PD-1559 `_create_otlp_metric_exporter`: Workers cannot open gRPC connections, so metrics go out as OTLP/HTTP JSON
 * to `OTLP_ENDPOINT/v1/metrics` (the `OTLP_METRICS_PROTOCOL=http` branch of Plane).
 */
export function createOtlpMetricExporter(env: Record<string, unknown>) {
  const url = getOtlpHttpMetricsUrl({ OTLP_ENDPOINT: typeof env.OTLP_ENDPOINT === 'string' ? env.OTLP_ENDPOINT : undefined })
  return {
    url,
    async export(body: unknown): Promise<boolean> {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FLUSH_TIMEOUT_MILLIS)
      })
      return response.ok
    }
  }
}

const attributeList = (attributes: Attributes) => Object.entries(attributes).map(([key, value]) => ({ key, value: { stringValue: value } }))

/** One observable gauge as OTLP JSON (Plane `meter.create_observable_gauge` + callbacks). */
function otlpGauge(gauge: Gauge, timeUnixNano: string) {
  return {
    name: gauge.name,
    description: gauge.description,
    gauge: {
      dataPoints: gauge.points.map(point => ({ asInt: String(point.value), timeUnixNano, attributes: attributeList(point.attributes) }))
    }
  }
}

const total = async (query: Promise<{ n: number }[]>) => (await query)[0]?.n ?? 0
const n = sql<number>`count(*)`

/**
 * PD-1560 `_collect_and_push_metrics`. Counts rows, builds the instance gauges (PD-1561..1569) and the per-workspace
 * gauges of the first 1000 workspaces (PD-1570..1576), then exports them. Returns false when nothing was sent
 * (no instance, telemetry off on the instance) or the export failed. Never throws, so the next run retries.
 */
export async function collectAndPushMetrics(db: LancityDb, env: InfraEnv, now = new Date()): Promise<boolean> {
  const instance = await currentInstance(db)
  if (!instance || !instance.isTelemetryEnabled) return false
  try {
    const pageVisible = sql`not (coalesce(${userSecurity.isBot}, 0) = 1 and ${pages.access} = 1)`
    const [userCount, workspaceCount, projectCount, issueCount, moduleCount, cycleCount, cycleIssueCount, moduleIssueCount, pageCount] =
      await Promise.all([
        total(
          db
            .select({ n })
            .from(user)
            .leftJoin(userSecurity, eq(userSecurity.userId, user.id))
            .where(sql`coalesce(${userSecurity.isBot}, 0) = 0`)
        ),
        total(db.select({ n }).from(workspaces).where(isNull(workspaces.deletedAt))),
        total(db.select({ n }).from(projects).where(isNull(projects.deletedAt))),
        total(db.select({ n }).from(issues).where(isNull(issues.deletedAt))),
        total(db.select({ n }).from(modules).where(isNull(modules.deletedAt))),
        total(db.select({ n }).from(cycles).where(isNull(cycles.deletedAt))),
        total(db.select({ n }).from(cycleIssues).where(isNull(cycleIssues.deletedAt))),
        total(db.select({ n }).from(moduleIssues).where(isNull(moduleIssues.deletedAt))),
        total(
          db
            .select({ n })
            .from(pages)
            .leftJoin(userSecurity, eq(userSecurity.userId, pages.ownedById))
            .where(and(isNull(pages.deletedAt), pageVisible))
        )
      ])

    // Plane derives the domain from WEB_URL; Lancity uses BETTER_AUTH_URL.
    let domain = ''
    try {
      domain = env.BETTER_AUTH_URL ? new URL(env.BETTER_AUTH_URL).host : ''
    } catch {
      // A malformed URL leaves the domain empty.
    }
    const instanceId = String(instance.instanceId || '')
    const instanceAttrs: Attributes = {
      instance_id: instanceId,
      instance_name: String(instance.instanceName || ''),
      current_version: String(instance.currentVersion || ''),
      latest_version: String(instance.latestVersion || ''),
      edition: String(instance.edition || ''),
      domain,
      is_verified: String(instance.isVerified).toLowerCase(),
      is_setup_done: String(instance.isSetupDone).toLowerCase()
    }
    const single = (name: string, description: string, value: number): Gauge => ({
      name,
      description,
      points: [{ value, attributes: instanceAttrs }]
    })
    const gauges: Gauge[] = [
      single('plane_instance_users_total', 'Total number of users in the Plane instance', userCount),
      single('plane_instance_workspaces_total', 'Total number of workspaces', workspaceCount),
      single('plane_instance_projects_total', 'Total number of projects across all workspaces', projectCount),
      single('plane_instance_issues_total', 'Total number of issues across all projects', issueCount),
      single('plane_instance_modules_total', 'Total number of modules', moduleCount),
      single('plane_instance_cycles_total', 'Total number of cycles', cycleCount),
      single('plane_instance_cycle_issues_total', 'Total number of issues in cycles', cycleIssueCount),
      single('plane_instance_module_issues_total', 'Total number of issues in modules', moduleIssueCount),
      single('plane_instance_pages_total', 'Total number of pages', pageCount)
    ]

    // Workspace metrics: a deterministic slice, with one grouped count per table instead of one query per workspace.
    const slice = await db
      .select({ id: workspaces.id, slug: workspaces.slug })
      .from(workspaces)
      .where(isNull(workspaces.deletedAt))
      .orderBy(asc(workspaces.createdAt), asc(workspaces.id))
      .limit(WORKSPACE_METRICS_LIMIT)
    const ids = slice.map(workspace => workspace.id)
    const grouped = async (rows: Promise<{ id: number; n: number }[]>) => new Map((await rows).map(row => [row.id, row.n]))
    const [projectCounts, issueCounts, moduleCounts, cycleCounts, memberCounts, pageCounts] = ids.length
      ? await Promise.all([
          grouped(db.select({ id: projects.workspaceId, n }).from(projects).where(and(inArray(projects.workspaceId, ids), isNull(projects.deletedAt))).groupBy(projects.workspaceId)),
          grouped(db.select({ id: issues.workspaceId, n }).from(issues).where(and(inArray(issues.workspaceId, ids), isNull(issues.deletedAt))).groupBy(issues.workspaceId)),
          grouped(db.select({ id: modules.workspaceId, n }).from(modules).where(and(inArray(modules.workspaceId, ids), isNull(modules.deletedAt))).groupBy(modules.workspaceId)),
          grouped(db.select({ id: cycles.workspaceId, n }).from(cycles).where(and(inArray(cycles.workspaceId, ids), isNull(cycles.deletedAt))).groupBy(cycles.workspaceId)),
          grouped(db.select({ id: workspaceMembers.workspaceId, n }).from(workspaceMembers).where(and(inArray(workspaceMembers.workspaceId, ids), isNull(workspaceMembers.deletedAt))).groupBy(workspaceMembers.workspaceId)),
          grouped(
            db
              .select({ id: pages.workspaceId, n })
              .from(pages)
              .leftJoin(userSecurity, eq(userSecurity.userId, pages.ownedById))
              .where(and(inArray(pages.workspaceId, ids), isNull(pages.deletedAt), pageVisible))
              .groupBy(pages.workspaceId)
          )
        ])
      : [new Map(), new Map(), new Map(), new Map(), new Map(), new Map()]
    // PD-1570 `_ws_attrs`
    const wsAttrs = (workspace: { id: number; slug: string }): Attributes => ({
      workspace_id: String(workspace.id),
      workspace_slug: String(workspace.slug),
      instance_id: instanceId
    })
    const perWorkspace = (name: string, description: string, counts: Map<number, number>): Gauge => ({
      name,
      description,
      points: slice.map(workspace => ({ value: counts.get(workspace.id) ?? 0, attributes: wsAttrs(workspace) }))
    })
    gauges.push(
      perWorkspace('plane_workspace_projects_total', 'Number of projects per workspace', projectCounts),
      perWorkspace('plane_workspace_issues_total', 'Number of issues per workspace', issueCounts),
      perWorkspace('plane_workspace_modules_total', 'Number of modules per workspace', moduleCounts),
      perWorkspace('plane_workspace_cycles_total', 'Number of cycles per workspace', cycleCounts),
      perWorkspace('plane_workspace_members_total', 'Number of members per workspace', memberCounts),
      perWorkspace('plane_workspace_pages_total', 'Number of pages per workspace', pageCounts)
    )

    const timeUnixNano = `${now.getTime()}000000`
    const exporter = createOtlpMetricExporter(env)
    const ok = await exporter.export({
      resourceMetrics: [
        {
          resource: {
            attributes: attributeList({
              'service.name': typeof env.SERVICE_NAME === 'string' ? env.SERVICE_NAME : 'lancity-api',
              instance_id: instanceId,
              'plane.instance.type': 'self-hosted'
            })
          },
          scopeMetrics: [{ scope: { name: 'lancity.instance.telemetry' }, metrics: gauges.map(gauge => otlpGauge(gauge, timeUnixNano)) }]
        }
      ]
    })
    logJson(ok ? 'info' : 'warn', 'instance.telemetry', { endpoint: exporter.url, instance_id: instanceId, exported: ok })
    return ok
  } catch (error) {
    logJson('error', 'instance.telemetry', { message: error instanceof Error ? error.message : String(error) })
    return false
  }
}

/**
 * PD-1577 `push_instance_metrics`: run by the 5-minute cron, but only pushes when `TELEMETRY_ENABLED=1` and the push
 * interval (`METRICS_PUSH_INTERVAL_MINUTES`, default 360) has passed since the last successful push.
 */
export async function pushInstanceMetrics(db: LancityDb, env: InfraEnv, now = new Date()): Promise<boolean> {
  if (!isTelemetryRuntimeEnabled(env)) return false
  const intervalMs = getMetricsPushIntervalMinutes(env.METRICS_PUSH_INTERVAL_MINUTES) * 60_000
  const [state] = await db.select({ value: instanceJobState.value }).from(instanceJobState).where(eq(instanceJobState.key, LAST_PUSH_KEY)).limit(1)
  if (state && now.getTime() - Number(state.value) < intervalMs) return false
  if (!(await collectAndPushMetrics(db, env, now))) return false
  await db
    .insert(instanceJobState)
    .values({ key: LAST_PUSH_KEY, value: String(now.getTime()) })
    .onConflictDoUpdate({ target: instanceJobState.key, set: { value: String(now.getTime()) } })
  return true
}
