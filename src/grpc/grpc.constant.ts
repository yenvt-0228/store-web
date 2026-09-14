import { join } from 'node:path';

/**
 * Whether the gRPC server is wired at all.
 *
 * Read from the environment, not injected: it decides what a module registers,
 * which happens before any provider exists — the same rule `kafkaEnabled()`
 * follows.
 *
 * @returns `true` when `GRPC_ENABLED` is exactly `"true"`.
 */
export function grpcEnabled(): boolean {
  return process.env.GRPC_ENABLED === 'true';
}

// Every .proto in this project declares this package.
export const GRPC_PACKAGE = 'store.v1';

// Bound on all interfaces so a container can reach it; see the README on why
// this port must never be published to the internet.
export const GRPC_DEFAULT_URL = '0.0.0.0:50051';

// `__dirname`, not `process.cwd()`: at runtime this file lives in dist/grpc, and
// nest-cli copies the .proto files next to it. Resolving from the working
// directory would work with `npm start` and break under a process manager that
// starts the app from somewhere else.
const PROTO_DIR = join(__dirname, 'proto');

export const GRPC_PROTO_PATHS = [
  join(PROTO_DIR, 'order.proto'),
  join(PROTO_DIR, 'product.proto'),
  join(PROTO_DIR, 'auth.proto'),
  join(PROTO_DIR, 'report.proto'),
];

export const GRPC_LOADER_OPTIONS = {
  // false: `order_code` in the proto arrives as `orderCode` in TypeScript.
  // snake_case is the protobuf convention and camelCase is the TypeScript one,
  // and this is the seam where they meet.
  keepCase: false,
  // int64 does not fit in a JS number. None of these messages carry one today,
  // but the day one appears the failure would be a silently rounded id.
  longs: String,
  enums: String,
  // proto3 has no null: an unset string arrives as "", an unset number as 0.
  // Without this they arrive as undefined instead, which is a third state
  // nothing downstream expects.
  defaults: true,
  oneofs: true,
};

// Metadata key carrying the shared secret between internal services.
export const GRPC_INTERNAL_KEY = 'x-internal-key';

// How often `WatchReport` re-reads the job, and when it gives up on a job that
// never reaches a terminal state — a stream nobody closes is a leaked
// connection plus a timer.
export const REPORT_WATCH_POLL_MS = 1_000;
export const REPORT_WATCH_TIMEOUT_MS = 5 * 60 * 1_000;
