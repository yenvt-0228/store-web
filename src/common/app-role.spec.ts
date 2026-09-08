import { AppRole, resolveAppRole, runsBackgroundJobs } from './app-role';

describe('app-role', () => {
  const original = process.env.APP_ROLE;

  afterEach(() => {
    if (original === undefined) delete process.env.APP_ROLE;
    else process.env.APP_ROLE = original;
  });

  it('defaults to all when APP_ROLE is unset, keeping the previous behaviour', () => {
    delete process.env.APP_ROLE;
    expect(resolveAppRole()).toBe(AppRole.ALL);
    expect(runsBackgroundJobs()).toBe(true);
  });

  it('ignores surrounding whitespace and letter case', () => {
    process.env.APP_ROLE = '  WORKER ';
    expect(resolveAppRole()).toBe(AppRole.WORKER);
  });

  it('throws on an unknown value instead of silently falling back to all', () => {
    process.env.APP_ROLE = 'workers';
    expect(() => resolveAppRole()).toThrow(/APP_ROLE="workers"/);
  });

  it('runs no background work only for the api role', () => {
    expect(runsBackgroundJobs(AppRole.API)).toBe(false);
    expect(runsBackgroundJobs(AppRole.WORKER)).toBe(true);
    expect(runsBackgroundJobs(AppRole.ALL)).toBe(true);
  });
});
