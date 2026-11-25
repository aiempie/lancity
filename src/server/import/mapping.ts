import { CsvFormatter, JsonFormatter, XlsxFormatter, normalizeHeader, type ExportRecord } from '@/server/export/formatters'
import { MAX_IMPORT_ROWS, type ImportFormat } from '@/types/reporting/p3-export-schema'
import type { CreateIssueInput } from '@/types/issue/schema'

export class ImportParseError extends Error {}

/** Format of an upload from its file name. The content type of an upload is not trusted. */
export function importFormatOf(fileName: string): ImportFormat | null {
  const extension = fileName.toLowerCase().split('.').pop()
  return extension === 'csv' || extension === 'json' || extension === 'xlsx' ? extension : null
}

/**
 * Decode an upload into records with snake_case keys, so a Plane export (`Start Date`), a CSV written by this
 * app (`start_date`) and a hand-made file all map the same way. Throws `ImportParseError` on a malformed file.
 */
export async function decodeImportFile(format: ImportFormat, bytes: Uint8Array): Promise<ExportRecord[]> {
  let records: unknown[]
  try {
    if (format === 'json') records = await new JsonFormatter().decode(bytes)
    else if (format === 'csv') records = await new CsvFormatter().decode(bytes)
    else records = await new XlsxFormatter().decode(bytes)
  } catch (error) {
    throw new ImportParseError(`The file is not a valid ${format.toUpperCase()}: ${error instanceof Error ? error.message : 'unreadable'}`)
  }
  if (records.length > MAX_IMPORT_ROWS) throw new ImportParseError(`An import holds at most ${MAX_IMPORT_ROWS} rows`)
  return records.map(record => {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) throw new ImportParseError('Every row must be an object')
    return Object.fromEntries(Object.entries(record).map(([key, value]) => [normalizeHeader(key), value]))
  })
}

export type ImportLookups = {
  /** Lower-cased state name to id. */
  states: Map<string, number>
  labels: Map<string, number>
  /** Lower-cased email, username or name to user id. Ambiguous names map to null. */
  members: Map<string, number | null>
  projectIdentifier: string
}

export type MappedRow = {
  input?: CreateIssueInput
  /** Sequence number of the parent issue, resolved by the caller. */
  parentSequence?: number
  error?: string
  warnings: string[]
}

const PRIORITIES = new Set(['urgent', 'high', 'medium', 'low', 'none'])
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)
const first = (record: ExportRecord, keys: string[]) => keys.map(key => record[key]).find(value => value !== undefined && value !== null && value !== '')
const text = (value: unknown) => (value === undefined || value === null ? '' : String(value).trim())

/** A list cell: a real array (JSON, JSON text in CSV) or text separated by commas, semicolons or lines. */
export function listCell(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return []
  const items = Array.isArray(value) ? value : String(value).split(/[,;\n]/)
  return items.map(item => text(item)).filter(Boolean)
}

/** `YYYY-MM-DD` from an ISO date, a Plane export date (`Mon, 02 Jan 2006`) or a spreadsheet serial number. */
export function parseImportDate(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number') {
    if (value < 20000 || value > 80000) return undefined
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000).toISOString().slice(0, 10)
  }
  const raw = text(value)
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/)
  const plane = raw.match(/^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})/)
  let year: number, month: number, day: number
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (plane && MONTHS.includes(plane[2].toLowerCase())) [year, month, day] = [Number(plane[3]), MONTHS.indexOf(plane[2].toLowerCase()) + 1, Number(plane[1])]
  else return undefined
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : undefined
}

/** Port of the field mapping an issue import needs: Plane export columns and plain spreadsheet columns. */
export function mapImportRow(record: ExportRecord, lookups: ImportLookups, externalSource: string, externalId: string): MappedRow {
  const warnings: string[] = []
  const name = text(first(record, ['name', 'title', 'summary']))
  if (!name) return { error: 'Name is required', warnings }
  if (name.length > 255) return { error: 'Name is longer than 255 characters', warnings }
  const priority = (text(record.priority) || 'none').toLowerCase()
  if (!PRIORITIES.has(priority)) return { error: `Priority "${priority}" is not valid`, warnings }
  const startDate = parseImportDate(record.start_date)
  const targetDate = parseImportDate(record.target_date)
  if (startDate === undefined) return { error: 'Start date is not a valid date', warnings }
  if (targetDate === undefined) return { error: 'Target date is not a valid date', warnings }
  if (startDate && targetDate && startDate > targetDate) return { error: 'Start date cannot exceed target date', warnings }
  const stateName = text(first(record, ['state', 'state_name']))
  const stateId = stateName ? lookups.states.get(stateName.toLowerCase()) : undefined
  if (stateName && stateId === undefined) warnings.push(`State "${stateName}" not found, the default state is used`)
  const labelIds: number[] = []
  for (const label of listCell(first(record, ['labels', 'label']))) {
    const id = lookups.labels.get(label.toLowerCase())
    if (id === undefined) warnings.push(`Label "${label}" not found`)
    else labelIds.push(id)
  }
  const assigneeIds: number[] = []
  for (const member of listCell(first(record, ['assignees', 'assignee']))) {
    const id = lookups.members.get(member.toLowerCase())
    if (id === undefined) warnings.push(`Assignee "${member}" is not a member of the project`)
    else if (id === null) warnings.push(`Assignee "${member}" matches several members`)
    else assigneeIds.push(id)
  }
  const descriptionHtml = text(record.description_html)
  const description = text(first(record, ['description', 'description_stripped']))
  let parentSequence: number | undefined
  const parent = text(record.parent)
  if (parent) {
    const match = parent.match(/^(?:(.+)-)?(\d+)$/)
    if (match && (!match[1] || match[1].toLowerCase() === lookups.projectIdentifier.toLowerCase())) parentSequence = Number(match[2])
    else warnings.push(`Parent "${parent}" is not an issue of this project`)
  }
  return {
    parentSequence,
    warnings,
    input: {
      name,
      priority: priority as CreateIssueInput['priority'],
      ...(stateId === undefined ? {} : { stateId }),
      ...(startDate ? { startDate } : {}),
      ...(targetDate ? { targetDate } : {}),
      ...(labelIds.length ? { labelIds: [...new Set(labelIds)] } : {}),
      ...(assigneeIds.length ? { assigneeIds: [...new Set(assigneeIds)] } : {}),
      ...(descriptionHtml
        ? { descriptionHtml }
        : description
          ? { descriptionHtml: description.split(/\r?\n/).filter(Boolean).map(line => `<p>${escapeHtml(line)}</p>`).join('') }
          : {}),
      externalSource,
      externalId
    }
  }
}
