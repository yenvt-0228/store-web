/**
 * One place where "page 2, 10 per page" becomes "skip 10, take 10".
 *
 * Every caller that pages needs the same three numbers, and every caller that
 * computes them itself is a chance to get the off-by-one wrong or to forget the
 * upper bound. HTTP gets them from `PaginationDto`; gRPC has no class-validator
 * in front of it and gets them from here directly.
 */

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 10;
// Same ceiling `PaginationDto` enforces with @Max: a transport without
// validation must not be the way around it.
export const MAX_LIMIT = 100;

export interface PageWindow {
  page: number;
  limit: number;
  skip: number;
}

/**
 * Resolves a page window from whatever the caller sent.
 *
 * Anything that is not a whole number of at least 1 falls back to the default:
 * `undefined` from an optional query param, and `0` from proto3 — which has no
 * null, so an unset int32 arrives as zero and `take: 0` would return nothing.
 *
 * @param page - Requested page, 1-based.
 * @param limit - Requested page size.
 * @returns The page, the size capped at {@link MAX_LIMIT}, and the offset.
 */
export function toPageWindow(
  page?: number | null,
  limit?: number | null,
): PageWindow {
  const resolvedPage = positiveOr(page, DEFAULT_PAGE);
  const resolvedLimit = Math.min(positiveOr(limit, DEFAULT_LIMIT), MAX_LIMIT);

  return {
    page: resolvedPage,
    limit: resolvedLimit,
    skip: (resolvedPage - 1) * resolvedLimit,
  };
}

function positiveOr(
  value: number | null | undefined,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback;
}
