import { JobsOptions } from 'bullmq';

const RETRY_BACKOFF_MS = 2000;

const ONE_DAY_SECONDS = 24 * 60 * 60;

// Shared defaults for every background job. Three attempts covers the common
// transient failures (SMTP rate limit, storage hiccup) without keeping a broken
// job in the queue forever.
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: RETRY_BACKOFF_MS },
  removeOnComplete: 100,
  removeOnFail: 500,
};

// Reports are polled by the client after the job finishes, so the finished job
// has to outlive the request that created it. Dropping it immediately would
// throw away the object key the client still needs.
export const REPORT_JOB_OPTIONS: JobsOptions = {
  ...DEFAULT_JOB_OPTIONS,
  removeOnComplete: { age: ONE_DAY_SECONDS, count: 200 },
  removeOnFail: { age: ONE_DAY_SECONDS, count: 200 },
};
