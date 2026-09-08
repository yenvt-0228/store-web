export const AppRole = {
  API: 'api',
  WORKER: 'worker',
  ALL: 'all',
} as const;

export type AppRole = (typeof AppRole)[keyof typeof AppRole];

const VALID_ROLES: readonly string[] = Object.values(AppRole);

/**
 * Reads and validates the `APP_ROLE` environment variable, which decides what
 * the current process does:
 *
 * - `api`    serves HTTP only: registers no cron and consumes no queue jobs.
 * - `worker` background work only: cron + jobs, no HTTP port (see `main.worker.ts`).
 * - `all`    both in one process (default, keeps the previous behaviour).
 *
 * @returns The role of the current process; `all` when `APP_ROLE` is unset.
 * @throws {Error} When `APP_ROLE` holds a value outside {@link AppRole}.
 */
export function resolveAppRole(): AppRole {
  const raw = (process.env.APP_ROLE ?? AppRole.ALL).trim().toLowerCase();

  // No silent fallback: a typo such as "workers" falling back to "all" would
  // make both the API and the worker process run the cron jobs, wiping data
  // twice at the same moment.
  if (!VALID_ROLES.includes(raw)) {
    throw new Error(
      `APP_ROLE="${process.env.APP_ROLE}" is not valid — expected one of: ${VALID_ROLES.join(', ')}.`,
    );
  }

  return raw as AppRole;
}

/**
 * Tells whether this process runs cron jobs and consumes queue jobs.
 *
 * @param role - Role to test; resolved from the environment when omitted.
 * @returns `true` for the `worker` and `all` roles, `false` for `api`.
 */
export function runsBackgroundJobs(role: AppRole = resolveAppRole()): boolean {
  return role !== AppRole.API;
}
