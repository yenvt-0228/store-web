import { parseIsoBoundary } from './date.util';

/** A timestamp filter in the shape Prisma takes. */
export interface DateRange {
  gte?: Date;
  lte?: Date;
  lt?: Date;
}

// ISO 8601 allows both "2026-12-31T10:30" and "2026-12-31 10:30", and the DTOs
// accept both. Looking for a "T" alone would read the second one as a bare date
// and push the boundary a full day forward.
const TIME_PART = /[T ]\d{2}:\d{2}/;

function hasTime(value: string): boolean {
  return TIME_PART.test(value);
}

/**
 * Parses one boundary of a range.
 *
 * @param value - Boundary as it arrived, from a query or a queued payload.
 * @param field - Field name, used in the error message.
 * @returns The parsed date.
 * @throws {Error} When `value` does not name a real calendar date.
 */
export function parseBoundary(value: string, field: string): Date {
  const parsed = parseIsoBoundary(value);

  if (!parsed) {
    throw new Error(`Filter "${field}" is not a valid date: "${value}".`);
  }

  return parsed;
}

/**
 * Builds a `createdAt` filter from a request's `from`/`to` pair.
 *
 * The subtlety is the upper bound, and it is why this lives in one place rather
 * than in every caller: a date-only "to" ("2026-12-31") parses to midnight, so
 * `lte` would drop every order placed during that last day. Turning it into
 * "before midnight of the next day" covers the whole day. When the caller did
 * supply a time they meant that exact instant, so `lte` is kept.
 *
 * @param from - Lower bound, optional.
 * @param to - Upper bound, optional.
 * @param fields - Field names, used only in error messages.
 * @returns The filter, or `undefined` when neither bound was supplied.
 * @throws {Error} When either bound is not a real calendar date.
 */
export function toDateRange(
  from?: string,
  to?: string,
  fields: { from: string; to: string } = { from: 'from', to: 'to' },
): DateRange | undefined {
  if (!from && !to) {
    return undefined;
  }

  const range: DateRange = {};

  if (from) {
    range.gte = parseBoundary(from, fields.from);
  }

  if (to) {
    const upper = parseBoundary(to, fields.to);

    if (hasTime(to)) {
      range.lte = upper;
    } else {
      upper.setUTCDate(upper.getUTCDate() + 1);
      range.lt = upper;
    }
  }

  return range;
}
