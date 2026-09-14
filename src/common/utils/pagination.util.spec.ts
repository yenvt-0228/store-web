import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
  toPageWindow,
} from './pagination.util';

describe('toPageWindow', () => {
  it('computes the offset from the page and the size', () => {
    expect(toPageWindow(3, 20)).toEqual({ page: 3, limit: 20, skip: 40 });
  });

  it('falls back to the defaults on proto3 zero values', () => {
    // proto3 has no null: an unset int32 arrives as 0, and `take: 0` returns
    // nothing at all.
    expect(toPageWindow(0, 0)).toEqual({
      page: DEFAULT_PAGE,
      limit: DEFAULT_LIMIT,
      skip: 0,
    });
  });

  it('falls back to the defaults when nothing was sent', () => {
    expect(toPageWindow()).toEqual({
      page: DEFAULT_PAGE,
      limit: DEFAULT_LIMIT,
      skip: 0,
    });
  });

  it('refuses a negative or fractional page rather than inventing an offset', () => {
    expect(toPageWindow(-4, 10).skip).toBe(0);
    expect(toPageWindow(2.7, 10)).toEqual({ page: 2, limit: 10, skip: 10 });
  });

  it('caps the page size, so a transport without validation is not the way around @Max', () => {
    expect(toPageWindow(1, 5_000).limit).toBe(MAX_LIMIT);
  });
});
