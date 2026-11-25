import { formatInTimeZone, projectDayStart } from '@/server/common/timezone-converter'

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Port of `IntakeIssue.save` (PD-1405) together with `snooze_day_start` (PD-0015). A snooze is day granular: it wakes
 * at 00:00 of that day in the project's timezone. A bare `YYYY-MM-DD` names the day directly; a datetime is first
 * moved into the project timezone to find its day.
 */
export function resolveSnoozedTill(value: string | null | undefined, projectTimezone: string): Date | null {
  if (!value) return null
  if (BARE_DATE.test(value)) return projectDayStart(value, projectTimezone)
  const instant = new Date(value)
  return projectDayStart(formatInTimeZone(instant, projectTimezone).slice(0, 10), projectTimezone)
}

/** Names the `intake.activity.created` tracker writes as old and new value (PD-1176). */
export const INTAKE_STATUS_LABEL: Record<number, string> = {
  [-2]: 'Pending',
  [-1]: 'Rejected',
  0: 'Snoozed',
  1: 'Accepted',
  2: 'Duplicate'
}
