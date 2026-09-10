// ISO 8601 allows both "2026-12-31T10:30" and "2026-12-31 10:30". A space is not
// the form `new Date()` parses reliably, so it is normalised before parsing.
const SPACE_SEPARATOR = ' ';

/**
 * Tells whether a year/month/day triple is a day that exists.
 *
 * `Date` rolls over instead of refusing: 2026-02-31 becomes 3 March and
 * 2027-02-29 becomes 1 March, both silently. On a report boundary that is three
 * extra days of orders nobody asked for, with no error anywhere. Building the
 * date back from its parts and comparing is what catches the rollover.
 *
 * @param year - Four-digit year.
 * @param month - Month, 1-12.
 * @param day - Day of the month.
 * @returns `true` when the three parts name a real calendar day.
 */
function isRealCalendarDay(year: number, month: number, day: number): boolean {
  // UTC, so the host timezone cannot shift the day out from under the check.
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

/**
 * Parses a date boundary written as `YYYY-MM-DD`, optionally with a time.
 *
 * Dates are read as UTC, which is what `new Date('2026-12-31')` does: a boundary
 * is a filter on `created_at`, and the database stores UTC.
 *
 * @param value - Boundary as it arrived, from a query or a queued payload.
 * @returns The parsed date, or `null` when `value` is not a real date.
 */
export function parseIsoBoundary(value: string): Date | null {
  const [year, month, day] = value
    .slice(0, 10)
    .split('-')
    .map((part) => Number(part));

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !isRealCalendarDay(year, month, day)
  ) {
    return null;
  }

  const parsed = new Date(value.replace(SPACE_SEPARATOR, 'T'));

  // Catches what is left: an impossible time such as 25:00.
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
