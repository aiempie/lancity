/**
 * Timezone helpers on top of `Intl` (Plane `timezone_converter.py`, which used pytz).
 * Instants are `Date` objects. A date carrying a zone is formatted as ISO 8601 with its UTC offset.
 */
import { eq } from 'drizzle-orm'
import { projects } from '@/db/schema/workspace'
import { notFoundError } from '@/server/common/errors'
import type { LancityDb } from '@/types/database/schema'

const formatters = new Map<string, Intl.DateTimeFormat>()

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

/** Throws `RangeError` for an unknown zone (pytz `UnknownTimeZoneError`). */
export function assertTimeZone(timeZone: string): void {
  zoneFormatter(timeZone)
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (east is positive). */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts: Record<string, number> = {}
  for (const part of zoneFormatter(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return wall - Math.floor(instant.getTime() / 1000) * 1000
}

/** Wall clock time in `timeZone` to the matching instant (pytz `localize` + `astimezone(utc)`). */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  const firstOffset = zoneOffsetMs(new Date(wallAsUtc), timeZone)
  let instant = wallAsUtc - firstOffset
  const secondOffset = zoneOffsetMs(new Date(instant), timeZone)
  if (secondOffset !== firstOffset) instant = wallAsUtc - secondOffset
  return new Date(instant)
}

/** ISO 8601 text of `instant` in `timeZone`, e.g. `2026-03-01T09:30:00+07:00`. */
export function formatInTimeZone(instant: Date, timeZone: string): string {
  const offset = zoneOffsetMs(instant, timeZone)
  const local = new Date(Math.floor(instant.getTime() / 1000) * 1000 + offset)
  const minutes = Math.abs(offset) / 60000
  const sign = offset < 0 ? '-' : '+'
  const pad = (value: number) => String(value).padStart(2, '0')
  const base = local.toISOString().slice(0, 19)
  const millis = String(instant.getTime() % 1000).padStart(3, '0')
  return `${base}${millis === '000' ? '' : `.${millis}`}${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

type DateLike = Date | string | number | null | undefined

/**
 * Plane `user_timezone_converter`: render the named datetime fields in the user's timezone.
 * Accepts one record or a list and returns copies (the Python version mutates in place).
 */
export function userTimezoneConverter<T extends Record<string, unknown>>(rows: T, fields: string[], timeZone: string): T
export function userTimezoneConverter<T extends Record<string, unknown>>(rows: Iterable<T>, fields: string[], timeZone: string): T[]
export function userTimezoneConverter<T extends Record<string, unknown>>(rows: T | Iterable<T>, fields: string[], timeZone: string) {
  assertTimeZone(timeZone)
  const convert = (row: T): T => {
    const copy: Record<string, unknown> = { ...row }
    for (const field of fields) {
      const value = copy[field] as DateLike
      if (value === null || value === undefined || value === '') continue
      const instant = value instanceof Date ? value : new Date(value)
      if (!Number.isNaN(instant.getTime())) copy[field] = formatInTimeZone(instant, timeZone)
    }
    return copy as T
  }
  if (Symbol.iterator in rows && typeof (rows as Iterable<T>)[Symbol.iterator] === 'function') return Array.from(rows as Iterable<T>, convert)
  return convert(rows as T)
}

function parseDay(date: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const result = match ? ([Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number]) : null
  if (!result || Number.isNaN(new Date(Date.UTC(result[0], result[1] - 1, result[2])).getTime())) {
    throw new Error(`time data '${date}' does not match format '%Y-%m-%d'`)
  }
  return result
}

/**
 * Pure part of Plane `convert_to_utc`.
 * Start date: local midnight plus one second; when that falls on today's local date the current instant is
 * returned. End date: the last minute (23:59) of the local day. Both are returned as UTC instants.
 */
export function convertDateToUtc(date: string, projectTimezone: string, isStartDate = false, now = new Date()): Date {
  if (!date || !projectTimezone) throw new Error('Both date and timezone must be provided.')
  const [year, month, day] = parseDay(date)
  if (isStartDate) {
    const start = zonedTimeToUtc(year, month, day, 0, 0, 1, projectTimezone)
    const localToday = localDateText(now, projectTimezone)
    return localDateText(start, projectTimezone) === localToday ? now : start
  }
  return zonedTimeToUtc(year, month, day, 23, 59, 0, projectTimezone)
}

function localDateText(instant: Date, timeZone: string): string {
  return formatInTimeZone(instant, timeZone).slice(0, 10)
}

async function projectTimezone(db: LancityDb, projectId: number): Promise<string> {
  const [project] = await db.select({ timezone: projects.timezone }).from(projects).where(eq(projects.id, projectId)).limit(1)
  if (!project) throw notFoundError('Project matching query does not exist.')
  return project.timezone
}

/** Plane `convert_to_utc`: load the project's timezone, then convert a `YYYY-MM-DD` date to a UTC instant. */
export async function convertToUtc(db: LancityDb, date: string, projectId: number, isStartDate = false): Promise<Date> {
  return convertDateToUtc(date, await projectTimezone(db, projectId), isStartDate)
}

/** Plane `project_day_start`: midnight of `YYYY-MM-DD` in `timeZone`. */
export function projectDayStart(day: string, timeZone: string): Date {
  const [year, month, date] = parseDay(day)
  return zonedTimeToUtc(year, month, date, 0, 0, 0, timeZone)
}

/**
 * Plane `snooze_day_start`: midnight in the project's timezone for a bare `YYYY-MM-DD` value, otherwise null.
 * Parsed as-is a bare date is UTC midnight, which would be floored to the previous day behind UTC.
 */
export async function snoozeDayStart(db: LancityDb, value: unknown, projectId: number): Promise<Date | null> {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  try {
    parseDay(value)
  } catch {
    return null
  }
  return projectDayStart(value, await projectTimezone(db, projectId))
}

/** Plane `convert_utc_to_project_timezone`: ISO 8601 text of `utcDatetime` in the project's timezone. */
export async function convertUtcToProjectTimezone(db: LancityDb, utcDatetime: Date | string | number, projectId: number): Promise<string> {
  const timeZone = await projectTimezone(db, projectId)
  if (!timeZone) throw new Error('Project timezone must be provided.')
  return formatInTimeZone(new Date(utcDatetime), timeZone)
}
