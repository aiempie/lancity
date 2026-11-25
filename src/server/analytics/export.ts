import { eq, sql, type SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { linkto } from '@/data/linkto'
import * as schema from '@/db/schema'
import { analyticExports } from '@/db/schema/ext-p3-analytics'
import { workspaces } from '@/db/schema/workspace'
import { buildGraphPlot, type Distribution, type PlotRow } from '@/server/analytics/analytics-plot'
import { issuesWhere, userDisplayName } from '@/server/analytics/queries'
import type { InfraEnv } from '@/server/common/env'
import { logException } from '@/server/common/exception-logger'
import { baseHost } from '@/server/common/host'
import { renderEmail, type MailContent } from '@/server/common/mail-templates'
import { sanitizeCsvRow } from '@/server/export/csv-utils'
import { issueFilters, type FilterParams } from '@/server/issue/filter'
import type { AnalyticCsvEmailJob, AnalyticExportJob } from '@/types/reporting/p3-analytics-schema'
import type { LancityDb } from '@/types/database/schema'

/** Plane `row_mapping`: CSV headers of the axes (`state_id` is added, Plane has no header for it). */
export const ROW_MAPPING: Record<string, string> = {
  state__name: 'State',
  state_id: 'State',
  state__group: 'State Group',
  labels__id: 'Label',
  assignees__id: 'Assignee Name',
  start_date: 'Start Date',
  target_date: 'Due Date',
  completed_at: 'Completed At',
  created_at: 'Created At',
  issue_count: 'Issue Count',
  priority: 'Priority',
  estimate: 'Estimate',
  issue_cycle__cycle_id: 'Cycle',
  issue_module__module_id: 'Module'
}

const ASSIGNEE_ID = 'assignees__id'
const LABEL_ID = 'labels__id'
const STATE_ID = 'state_id'
const CYCLE_ID = 'issue_cycle__cycle_id'
const MODULE_ID = 'issue_module__module_id'

export type DetailRow = Record<string, unknown>
/** Lookup rows used to turn ids into names, one list per axis type (empty when the axis is not used). */
export type PlotDetails = {
  assignee: DetailRow[]
  label: DetailRow[]
  state: DetailRow[]
  cycle: DetailRow[]
  module: DetailRow[]
}
export const emptyDetails = (): PlotDetails => ({ assignee: [], label: [], state: [], cycle: [], module: [] })

/** PD-1075 `get_assignee_details`: every assignee of the issues (Plane only lists those with an avatar). */
export function getAssigneeDetails(db: LancityDb, where: SQL) {
  return db.all<DetailRow>(
    sql`select ia.assignee_id as assignees__id, u.image as assignees__avatar_url, ${userDisplayName('u')} as assignees__display_name,
        u.name as assignees__first_name, '' as assignees__last_name
      from issues join issue_assignees ia on ia.issue_id = issues.id and ia.deleted_at is null
        join "user" u on u.id = ia.assignee_id
      where ${where} group by ia.assignee_id order by ia.assignee_id`
  )
}

/** PD-1076 `get_label_details`. */
export function getLabelDetails(db: LancityDb, where: SQL) {
  return db.all<DetailRow>(
    sql`select il.label_id as labels__id, l.color as labels__color, l.name as labels__name
      from issues join issue_labels il on il.issue_id = issues.id and il.deleted_at is null
        join labels l on l.id = il.label_id
      where ${where} group by il.label_id order by il.label_id`
  )
}

/** PD-1077 `get_state_details`. */
export function getStateDetails(db: LancityDb, where: SQL) {
  return db.all<DetailRow>(
    sql`select issues.state_id as state_id, st.name as state__name, st.color as state__color
      from issues left join states st on st.id = issues.state_id
      where ${where} group by issues.state_id order by issues.state_id`
  )
}

/** PD-1078 `get_module_details`. */
export function getModuleDetails(db: LancityDb, where: SQL) {
  return db.all<DetailRow>(
    sql`select mi.module_id as issue_module__module_id, m.name as issue_module__module__name
      from issues join module_issues mi on mi.issue_id = issues.id and mi.deleted_at is null
        join modules m on m.id = mi.module_id
      where ${where} group by mi.module_id order by mi.module_id`
  )
}

/** PD-1079 `get_cycle_details`. */
export function getCycleDetails(db: LancityDb, where: SQL) {
  return db.all<DetailRow>(
    sql`select ci.cycle_id as issue_cycle__cycle_id, c.name as issue_cycle__cycle__name
      from issues join cycle_issues ci on ci.issue_id = issues.id and ci.deleted_at is null
        join cycles c on c.id = ci.cycle_id
      where ${where} group by ci.cycle_id order by ci.cycle_id`
  )
}

/** The lookups an export or analytics response needs for its x axis and segment. */
export async function loadPlotDetails(
  db: LancityDb,
  where: SQL,
  xAxis: string,
  segment?: string | false | null
): Promise<PlotDetails> {
  const uses = (field: string) => xAxis === field || segment === field
  const [assignee, label, state, cycle, module] = await Promise.all([
    uses(ASSIGNEE_ID) ? getAssigneeDetails(db, where) : [],
    uses(LABEL_ID) ? getLabelDetails(db, where) : [],
    uses(STATE_ID) ? getStateDetails(db, where) : [],
    uses(CYCLE_ID) ? getCycleDetails(db, where) : [],
    uses(MODULE_ID) ? getModuleDetails(db, where) : []
  ])
  return { assignee, label, state, cycle, module }
}

/** PD-1080 `generate_csv_from_rows`: every cell quoted, rows ended by CRLF, formula prefixes neutralised. */
export function generateCsvFromRows(rows: readonly (readonly unknown[])[]): string {
  return rows
    .map(
      row =>
        sanitizeCsvRow(row)
          .map(cell => `"${String(cell ?? '').replaceAll('"', '""')}"`)
          .join(',') + '\r\n'
    )
    .join('')
}

const same = (a: unknown, b: unknown) => String(a) === String(b)
const findRow = (rows: DetailRow[], key: string, value: unknown) => rows.find(row => same(row[key], value))

/** The name Plane shows instead of an id for the axes that have lookups, or undefined to keep the id. */
function nameOf(field: string, value: unknown, details: PlotDetails): string | undefined {
  switch (field) {
    case ASSIGNEE_ID: {
      const row = findRow(details.assignee, ASSIGNEE_ID, value)
      return row ? `${row.assignees__first_name} ${row.assignees__last_name}`.trim() : undefined
    }
    case LABEL_ID:
      return findRow(details.label, LABEL_ID, value)?.labels__name as string | undefined
    case STATE_ID:
      return findRow(details.state, STATE_ID, value)?.state__name as string | undefined
    case CYCLE_ID:
      return findRow(details.cycle, CYCLE_ID, value)?.issue_cycle__cycle__name as string | undefined
    case MODULE_ID:
      return findRow(details.module, MODULE_ID, value)?.issue_module__module__name as string | undefined
    default:
      return undefined
  }
}

/** PD-1081 `generate_segmented_rows`: one column per segment value. Plane resolves module segments against the label list by mistake, here modules use their own lookup. */
export function generateSegmentedRows(
  distribution: Distribution,
  xAxis: string,
  yAxis: string,
  segment: string,
  key: 'count' | 'estimate',
  details: PlotDetails
): unknown[][] {
  const segmentZero = [...new Set(Object.values(distribution).flatMap(list => list.map(item => item.segment ?? null)))]
  const rowZero: unknown[] = [ROW_MAPPING[xAxis] ?? 'X-Axis', ROW_MAPPING[yAxis] ?? 'Y-Axis', ...segmentZero]
  const rows: unknown[][] = []
  for (const [item, data] of Object.entries(distribution)) {
    const total = data.reduce((sum, obj) => sum + (obj[key] ?? 0), 0)
    const row: unknown[] = [nameOf(xAxis, item, details) ?? item, total]
    for (const value of segmentZero) {
      const match = data.find(entry => (entry.segment ?? null) === value)
      row.push(match ? match[key] : '0')
    }
    rows.push(row)
  }
  for (let index = 0; index < segmentZero.length; index++) {
    const name = nameOf(segment, segmentZero[index], details)
    if (name !== undefined) rowZero[index + 2] = name
  }
  return [rowZero, ...rows]
}

/** PD-1082 `generate_non_segmented_rows`. */
export function generateNonSegmentedRows(
  distribution: Distribution,
  xAxis: string,
  yAxis: string,
  details: PlotDetails
): unknown[][] {
  const rows = Object.entries(distribution).map(([item, data]) => [
    nameOf(xAxis, item, details) ?? item,
    (data[0] as PlotRow)[yAxis === 'issue_count' ? 'count' : 'estimate']
  ])
  return [[ROW_MAPPING[xAxis] ?? 'X-Axis', ROW_MAPPING[yAxis] ?? 'Y-Axis'], ...rows]
}

/** Object key of an export file in R2. Only the owner may download it. */
export const analyticExportKey = (row: { workspaceId: number; userId: number; id: number }) =>
  `analytics-exports/${row.workspaceId}/${row.userId}/${row.id}.csv`

/** Issue filter parameters of an export body: strings and lists of strings, numbers as text, the rest dropped. */
export function filterParamsOf(data: Record<string, unknown>): FilterParams {
  const params: FilterParams = {}
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') params[key] = value
    else if (typeof value === 'number') params[key] = String(value)
    else if (Array.isArray(value))
      params[key] = value.filter(item => typeof item === 'string' || typeof item === 'number').map(String)
  }
  return params
}

export type ExportDeps = {
  send?: (
    mail: { to: string; subject: string; html: string; text: string },
    env: InfraEnv
  ) => Promise<{ sent: boolean }>
}

/** The "Your Export is ready" email (Plane `emails/exports/analytics.html`), with a download link or the CSV inline. */
export function exportEmail(input: { slug: string; link?: string; csv?: string }): MailContent {
  const mail = renderEmail({
    subject: 'Your Export is ready',
    heading: 'Your export is ready',
    paragraphs: [`The analytics export of the workspace ${input.slug} is ready.`],
    action: input.link ? { label: 'Download CSV', url: input.link } : undefined
  })
  // Without storage the file travels in the plain text part (the mail helper has no attachments).
  return input.csv ? { ...mail, text: `${mail.text}\n\n${input.csv}` } : mail
}

/**
 * PD-1074 `send_export_email`: tell the user the export is ready. The CSV is stored in R2 and linked
 * (Plane attaches it); without an `ASSET_BUCKET` binding it is placed in the text of the email instead.
 */
export async function sendExportEmail(
  env: InfraEnv,
  input: { email: string; slug: string; exportId: number; stored: boolean; csv: string },
  deps: ExportDeps = {}
): Promise<boolean> {
  let link: string | undefined
  if (input.stored) {
    try {
      link = `${baseHost(env)}${linkto.apiV1}/workspaces/${input.slug}/export-analytics/${input.exportId}/download`
    } catch {
      link = undefined
    }
  }
  const mail = exportEmail({ slug: input.slug, link, csv: input.stored ? undefined : input.csv })
  const send = deps.send ?? (await import('@/server/common/mail')).sendMail
  return (await send({ to: input.email, subject: mail.subject, html: mail.html, text: mail.text }, env)).sent
}

const database = (env: InfraEnv) => drizzle(env.DB, { schema }) as unknown as LancityDb

/** Save the CSV in R2 (when bound), mark the export completed and email the user once. */
async function finishExport(
  db: LancityDb,
  env: InfraEnv,
  row: { id: number; workspaceId: number; userId: number; email: string; emailedAt: Date | null },
  slug: string,
  csv: string,
  deps: ExportDeps
) {
  const objectKey = analyticExportKey(row)
  const stored = Boolean(env.ASSET_BUCKET)
  if (env.ASSET_BUCKET)
    await env.ASSET_BUCKET.put(objectKey, csv, { httpMetadata: { contentType: 'text/csv; charset=utf-8' } })
  await db
    .update(analyticExports)
    .set({ status: 'completed', objectKey: stored ? objectKey : null, error: null, completedAt: new Date() })
    .where(eq(analyticExports.id, row.id))
  if (row.emailedAt) return
  const sent = await sendExportEmail(env, { email: row.email, slug, exportId: row.id, stored, csv }, deps)
  if (sent) await db.update(analyticExports).set({ emailedAt: new Date() }).where(eq(analyticExports.id, row.id))
}

/**
 * PD-1083 `analytic_export_task`: builds the distribution of the saved request with the filters of the user's own
 * projects, writes the CSV and emails it. Like Plane it never retries: a failure is logged and the row is marked
 * `failed`. A redelivered message does nothing once the email went out.
 */
export async function analyticExportTask(
  env: InfraEnv,
  payload: AnalyticExportJob,
  deps: ExportDeps = {}
): Promise<void> {
  const db = database(env)
  const [row] = await db.select().from(analyticExports).where(eq(analyticExports.id, payload.exportId)).limit(1)
  if (!row || row.emailedAt) return
  try {
    await db.update(analyticExports).set({ status: 'processing' }).where(eq(analyticExports.id, row.id))
    const [workspace] = await db
      .select({ slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, row.workspaceId))
      .limit(1)
    if (!workspace) throw new Error('Workspace not found')
    const data = row.params
    const xAxis = String(data.x_axis ?? '')
    const yAxis = String(data.y_axis ?? '')
    const segment = typeof data.segment === 'string' && data.segment ? data.segment : false
    const where = issuesWhere(
      { workspaceId: row.workspaceId, userId: row.userId },
      issueFilters(filterParamsOf(data), 'POST')
    )
    const distribution = await buildGraphPlot(db, where, xAxis, yAxis, segment)
    const key = yAxis === 'issue_count' ? 'count' : 'estimate'
    const details = await loadPlotDetails(db, where, xAxis, segment)
    const rows = segment
      ? generateSegmentedRows(distribution, xAxis, yAxis, segment, key, details)
      : generateNonSegmentedRows(distribution, xAxis, yAxis, details)
    await finishExport(db, env, row, workspace.slug, generateCsvFromRows(rows), deps)
    console.info(
      JSON.stringify({
        level: 'info',
        label: 'analytics.export',
        message: 'Email sent successfully.',
        exportId: row.id
      })
    )
  } catch (error) {
    logException(error, { context: { job: 'analytics.export_plot', exportId: row.id } })
    await db
      .update(analyticExports)
      .set({ status: 'failed', error: error instanceof Error ? error.message.slice(0, 500) : 'Export failed' })
      .where(eq(analyticExports.id, row.id))
  }
}

/**
 * PD-1084 `export_analytics_to_csv_email`: a CSV from `data` (one row per item, the cells picked by `keys`, headers
 * first) delivered like an analytics export. The payload carries the owner (`userId`, `workspaceId`) for the download.
 */
export async function exportAnalyticsToCsvEmail(
  env: InfraEnv,
  payload: AnalyticCsvEmailJob,
  deps: ExportDeps = {}
): Promise<void> {
  const db = database(env)
  try {
    const rows = [payload.headers, ...payload.data.map(item => payload.keys.map(key => item[key] ?? ''))]
    const [created] = await db
      .insert(analyticExports)
      .values({
        workspaceId: payload.workspaceId,
        userId: payload.userId,
        email: payload.email,
        params: {},
        status: 'processing'
      })
      .returning()
    await finishExport(db, env, created, payload.slug, generateCsvFromRows(rows), deps)
  } catch (error) {
    logException(error, { context: { job: 'analytics.export_csv_email' } })
  }
}
